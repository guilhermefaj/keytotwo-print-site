import type Stripe from 'stripe'
import { rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { dispatchSoon } from '../../_shared/email.ts'
import { applySession, loadSession, orderIdFromSession, sessionPaid } from '../../_shared/fulfillment.ts'
import { errorLabel, HttpError, json } from '../../_shared/http.ts'
import { isStripeError, stripeErrorLabel } from '../../_shared/stripe.ts'

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/

interface OrderStatus {
  outcome: 'ok' | 'not_found'
  status: string | null
  items: { code: string; name: string | null }[] | null
  relation: 'owner' | 'other' | null
}

// Estado mostrado na confirmação (docs/api-contract.md 6.6).
function stateOf(orderStatus: string | null, session: Stripe.Checkout.Session): string {
  switch (orderStatus) {
    case 'paid':
    case 'pending_payment':
    case 'failed':
    case 'expired':
      return orderStatus
    case 'open':
      if (sessionPaid(session)) return 'processing'
      return session.status === 'expired' ? 'expired' : 'failed'
    default:
      return 'not_found'
  }
}

// GET /order-status?session_id=cs_...: a URL não prova pagamento; a Stripe e o banco decidem.
export async function orderStatus(req: Request, url: URL): Promise<Response> {
  const user = await requireSessionUser(req)
  const sessionId = url.searchParams.get('session_id') ?? ''
  if (!SESSION_ID.test(sessionId)) throw new HttpError(400, 'INVALID_REQUEST', 'Sessão de pagamento inválida.')

  let loaded: Awaited<ReturnType<typeof loadSession>>
  try {
    loaded = await loadSession(sessionId)
  } catch (error) {
    if (!isStripeError(error)) throw error
    if (error.statusCode === 404) return json({ state: 'not_found' })
    console.error(`order-status: Stripe falhou (${stripeErrorLabel(error)})`)
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Não foi possível consultar o pagamento. Tente de novo em instantes.')
  }
  const { session, items } = loaded
  const orderId = orderIdFromSession(session)
  if (!orderId) return json({ state: 'not_found' })

  // Mesma regra e mesma liberação idempotente do webhook (p_source = 'return_page'). Quem liberou (aqui ou no webhook)
  // despacha a entrega depois do commit. Se falhar, a página não falha: o webhook libera e o estado vira processing.
  try {
    const result = await applySession(orderId, session, items, 'return_page')
    if (result?.send_delivery) dispatchSoon('order-status: entrega', result.outbox_id)
  } catch (error) {
    console.error(`order-status: estado da sessão não aplicado (${isStripeError(error) ? stripeErrorLabel(error) : errorLabel(error)})`)
  }

  const status = await rpcRow<OrderStatus>('get_order_status', { p_order_id: orderId, p_user_id: user.id })
  if (status.outcome !== 'ok') return json({ state: 'not_found' })
  const state = stateOf(status.status, session)
  const body: Record<string, unknown> = { state }
  if (state === 'paid') body.next = status.relation === 'owner' ? 'open_library' : 'other_account'
  if (status.relation === 'owner' && status.items) body.items = status.items
  return json(body)
}
