import type Stripe from 'stripe'
import { rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { runInBackground } from '../../_shared/background.ts'
import { dispatchEmails } from '../../_shared/email.ts'
import { fulfill, loadSession, orderIdFromSession, pendingPaymentArgs, setStatus } from '../../_shared/fulfillment.ts'
import { HttpError, json } from '../../_shared/http.ts'
import { isStripeError, stripeErrorLabel } from '../../_shared/stripe.ts'

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/

interface OrderStatus {
  outcome: 'ok' | 'not_found'
  status: string | null
  items: { code: string; name: string | null }[] | null
  relation: 'owner' | 'other' | null
}

const paid = (session: Stripe.Checkout.Session) => session.status === 'complete' && session.payment_status !== 'unpaid'

// Estado mostrado na confirmação (docs/api-contract.md 6.6).
function stateOf(orderStatus: string | null, session: Stripe.Checkout.Session): string {
  switch (orderStatus) {
    case 'paid':
    case 'pending_payment':
    case 'failed':
    case 'expired':
      return orderStatus
    case 'open':
      if (paid(session)) return 'processing'
      return session.status === 'expired' ? 'expired' : 'failed'
    default:
      return 'not_found'
  }
}

async function tryApply(step: string, apply: () => Promise<unknown>): Promise<void> {
  try {
    await apply()
  } catch (error) {
    // A página não falha por isso: o webhook libera; o estado vira processing.
    const label = isStripeError(error) ? stripeErrorLabel(error) : error instanceof Error ? error.message : 'erro'
    console.error(`order-status: ${step} falhou (${label})`)
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

  // Mesma liberação idempotente do webhook (p_source = 'return_page').
  if (paid(session)) {
    await tryApply('fulfill_order', async () => {
      const result = await fulfill(session, items, 'return_page')
      // Quem liberou (aqui ou no webhook) despacha a entrega depois do commit.
      const outboxId = result.outbox_id
      if (result.send_delivery && outboxId) runInBackground('order-status: entrega', () => dispatchEmails({ outboxId }))
    })
  }
  else if (session.status === 'complete') await tryApply('pending_payment', () => setStatus(orderId, 'pending_payment', 'return_page', pendingPaymentArgs(session)))
  else if (session.status === 'expired') await tryApply('expired', () => setStatus(orderId, 'expired', 'return_page'))

  const status = await rpcRow<OrderStatus>('get_order_status', { p_order_id: orderId, p_user_id: user.id })
  if (status.outcome !== 'ok') return json({ state: 'not_found' })
  const state = stateOf(status.status, session)
  const body: Record<string, unknown> = { state }
  if (state === 'paid') body.next = status.relation === 'owner' ? 'open_library' : 'other_account'
  if (status.relation === 'owner' && status.items) body.items = status.items
  return json(body)
}
