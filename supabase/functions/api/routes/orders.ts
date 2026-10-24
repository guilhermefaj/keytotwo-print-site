import { rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { dispatchSoon } from '../../_shared/email.ts'
import { applySession, loadSession, setStatus } from '../../_shared/fulfillment.ts'
import { HttpError, isUuid, json, readJsonObject } from '../../_shared/http.ts'
import { isStripeError, livemode, stripe, stripeErrorLabel } from '../../_shared/stripe.ts'
import { reasonOf, settle } from './outcome.ts'

// Pedidos e reembolsos no admin (2026-10-24, Fase 3): a lista e a ficha de cada pedido, o reembolso do pedido inteiro
// pela Stripe e o "conferir com a Stripe" do pedido que ficou aberto aqui. O banco confere o admin em cada chamada; a
// ação só vai para o histórico depois que a Stripe aceitou (reembolso) ou que a sessão foi conferida.

const PAGE_SIZE = 50
const FILTERS = ['all', 'paid', 'pending', 'abandoned', 'refunded', 'disputed', 'courtesy']

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Pedido não encontrado.')

interface OrderStripe {
  outcome: string
  ref: string | null
  kind: 'purchase' | 'courtesy' | null
  status: string | null
  livemode: boolean | null
  user_id: string | null
  checkout_session_id: string | null
  payment_intent_id: string | null
  amount_total: number | null
  currency: string | null
}

function orderParam(params: Record<string, string>): string {
  if (!isUuid(params.id)) throw notFound()
  return params.id
}

async function orderStripe(adminId: string, orderId: string): Promise<OrderStripe> {
  const order = await rpcRow<OrderStripe>('admin_order_stripe', { p_user_id: adminId, p_order_id: orderId })
  settle(order.outcome, { not_found: notFound })
  // Pedido do outro modo (teste com a chave de produção, ou o contrário): a Stripe deste ambiente não o conhece.
  if (order.livemode !== livemode()) {
    throw new HttpError(409, 'ORDER_NOT_REFUNDABLE', 'Este pedido é de outro modo da Stripe (teste ou produção) e não se mexe daqui.')
  }
  return order
}

// GET /admin/orders?q=&filter=all|paid|pending|abandoned|refunded|disputed|courtesy&page=1: 50 por página, os do modo
// da chave da Stripe, o mais novo primeiro. q acha pelo código do pedido ou por parte do e-mail.
export async function adminOrders(req: Request, url: URL): Promise<Response> {
  const user = await requireAdminSession(req)
  const query = (url.searchParams.get('q') ?? '').trim()
  const filter = url.searchParams.get('filter') ?? 'all'
  const page = Number(url.searchParams.get('page') ?? '1')
  if (query.length > 200 || !FILTERS.includes(filter) || !Number.isInteger(page) || page < 1 || page > 20_000) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Busca inválida.')
  }
  const result = await rpcRow<{ outcome: string; result: Record<string, unknown> | null }>('admin_list_orders', {
    p_user_id: user.id, p_query: query || null, p_filter: filter, p_livemode: livemode(), p_offset: (page - 1) * PAGE_SIZE,
  })
  settle(result.outcome)
  return json({ ...result.result, page })
}

// GET /admin/orders/:id: a ficha (valores, pessoa, itens, linha do tempo, jogos, downloads, e-mails e histórico).
export async function adminOrder(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const result = await rpcRow<{ outcome: string; result: Record<string, unknown> | null }>('admin_get_order', { p_user_id: user.id, p_order_id: orderParam(params) })
  settle(result.outcome, { not_found: notFound })
  return json(result.result)
}

// POST /admin/orders/:id/refund { reason, confirm_ref }: reembolsa o pedido inteiro na Stripe (só pago, de compra, com
// cobrança). A chave de idempotência é do pedido: repetir não reembolsa de novo. Com a Stripe de acordo, o pedido vira
// reembolsado na hora (origem admin), os jogos saem e o aviso por e-mail vai para a fila; o webhook que chega depois
// não muda mais nada.
export async function adminRefundOrder(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const orderId = orderParam(params)
  const body = await readJsonObject(req)
  const reason = reasonOf(body)
  const order = await orderStripe(user.id, orderId)
  const confirm = typeof body.confirm_ref === 'string' ? body.confirm_ref.trim().replace(/^#/, '').toUpperCase() : ''
  if (confirm !== order.ref) throw new HttpError(400, 'INVALID_REQUEST', 'Digite o código do pedido para confirmar o reembolso.')
  if (order.kind !== 'purchase' || order.status !== 'paid' || !order.payment_intent_id || !order.amount_total) {
    throw new HttpError(409, 'ORDER_NOT_REFUNDABLE', order.kind === 'courtesy'
      ? 'Presente não tem pagamento para devolver.'
      : order.status === 'refunded' ? 'Este pedido já foi reembolsado.' : 'Só um pedido pago e com cobrança pode ser reembolsado.')
  }

  let refund
  try {
    refund = await stripe().refunds.create(
      { payment_intent: order.payment_intent_id, reason: 'requested_by_customer', metadata: { order_id: orderId, source: 'admin' } },
      { idempotencyKey: `refund:${orderId}` },
    )
  } catch (error) {
    if (!isStripeError(error)) throw error
    console.error(`admin: reembolso na Stripe falhou (${stripeErrorLabel(error)})`)
    if (error.code === 'charge_already_refunded') {
      throw new HttpError(409, 'ORDER_NOT_REFUNDABLE', 'A Stripe diz que este pagamento já foi reembolsado. O pedido atualiza quando o aviso dela chegar.')
    }
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', error.statusCode === 403
      ? 'A chave da Stripe não tem permissão para reembolsar. Libere a escrita de Reembolsos na chave restrita.'
      : 'A Stripe recusou o reembolso agora. Nada mudou; tente de novo ou faça pelo painel da Stripe.')
  }
  if (refund.status === 'failed' || refund.status === 'canceled') {
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'A Stripe não concluiu o reembolso. Confira o pagamento no painel da Stripe.')
  }

  await setStatus(orderId, 'refunded', 'admin', { p_reason: 'admin_refund' })
  const logged = await rpcRow<{ outcome: string; outbox_id: string | null }>('admin_log_order_action', {
    p_user_id: user.id, p_order_id: orderId, p_action: 'order_refund', p_reason: reason,
    p_details: { refund_id: refund.id, amount: refund.amount, currency: refund.currency },
  })
  settle(logged.outcome, { not_found: notFound })
  dispatchSoon('admin: aviso de reembolso', logged.outbox_id)
  return json({ refunded: true, refund_status: refund.status, email_queued: Boolean(logged.outbox_id) })
}

// POST /admin/orders/:id/reconcile { reason }: busca a sessão na Stripe e aplica o que ela diz, com a mesma regra do
// webhook (origem reconcile): paga libera os jogos e manda o acesso; completa sem pagamento fica pendente; expirada
// expira. Sessão ainda aberta não muda nada.
export async function adminReconcileOrder(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const orderId = orderParam(params)
  const reason = reasonOf(await readJsonObject(req))
  const order = await orderStripe(user.id, orderId)
  if (order.kind !== 'purchase' || !order.checkout_session_id || !['open', 'pending_payment', 'expired'].includes(order.status ?? '')) {
    throw new HttpError(409, 'ORDER_NOT_RECONCILABLE', 'Só um pedido aberto, em andamento ou expirado, com sessão na Stripe, pode ser conferido.')
  }
  let applied
  try {
    const { session, items } = await loadSession(order.checkout_session_id)
    applied = await applySession(orderId, session, items, 'reconcile')
  } catch (error) {
    if (!isStripeError(error)) throw error
    console.error(`admin: conferir a sessão falhou (${stripeErrorLabel(error)})`)
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Não deu para falar com a Stripe agora. Tente de novo em instantes.')
  }
  if (!applied) throw new HttpError(409, 'ORDER_NOT_RECONCILABLE', 'A sessão ainda está aberta na Stripe: a pessoa não terminou de pagar.')
  const status = applied.order_status ?? order.status
  settle((await rpcRow<{ outcome: string }>('admin_log_order_action', {
    p_user_id: user.id, p_order_id: orderId, p_action: 'order_reconcile', p_reason: reason,
    p_details: { outcome: applied.outcome, status },
  })).outcome, { not_found: notFound })
  if (applied.send_delivery) dispatchSoon('admin: entrega depois de conferir', applied.outbox_id)
  return json({ outcome: applied.outcome, status })
}
