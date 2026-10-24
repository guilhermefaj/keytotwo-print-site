import type Stripe from 'stripe'
import { RpcError } from '../_shared/admin.ts'
import { dispatchSoon } from '../_shared/email.ts'
import { ConfigError, env } from '../_shared/env.ts'
import { applySession, idOf, loadSession, orderIdFromSession, type OrderOutcome, setStatus } from '../_shared/fulfillment.ts'
import { errorLabel, errorResponse, HttpError, isUuid, json, postOnly } from '../_shared/http.ts'
import { cryptoProvider, isStripeError, stripe, stripeErrorLabel } from '../_shared/stripe.ts'

// Erros de contrato que um reenvio da Stripe não resolve: 200 com log (docs/api-contract.md 9).
const FINAL_ERRORS = new Set(['KT001', 'KT002', 'KT004', 'KT005', 'KT007', 'KT012', '23505', 'EMAIL_NOT_CONFIRMED'])

const ignored: OrderOutcome = { outcome: 'ignored' }

// Contestações e reembolsos trazem o PaymentIntent: o pedido vem do metadata dele, com recurso à sessão.
async function orderIdFromPaymentIntent(paymentIntent: string | Stripe.PaymentIntent | null): Promise<string | null> {
  const id = idOf(paymentIntent)
  if (!id) return null
  const intent = await stripe().paymentIntents.retrieve(id)
  if (isUuid(intent.metadata?.order_id)) return intent.metadata.order_id
  const sessions = await stripe().checkout.sessions.list({ payment_intent: id, limit: 1 })
  return sessions.data[0] ? orderIdFromSession(sessions.data[0]) : null
}

// Um evento → no máximo uma RPC. null = evento de sessão ou cobrança que não é nossa.
async function processEvent(event: Stripe.Event): Promise<OrderOutcome | null> {
  const ref = { id: event.id, type: event.type }
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const orderId = orderIdFromSession(event.data.object)
      if (!orderId) return null
      const { session, items } = await loadSession(event.data.object.id)
      return await applySession(orderId, session, items, 'webhook', ref) ?? ignored
    }
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const orderId = orderIdFromSession(event.data.object)
      if (!orderId) return null
      return await setStatus(orderId, event.type === 'checkout.session.expired' ? 'expired' : 'failed', 'webhook', {}, ref)
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object
      const orderId = await orderIdFromPaymentIntent(dispute.payment_intent)
      if (!orderId) return null
      return await setStatus(orderId, 'disputed', 'webhook', { p_reason: dispute.reason }, ref)
    }
    case 'charge.dispute.closed': {
      const dispute = event.data.object
      const target = dispute.status === 'lost' ? 'dispute_lost' : dispute.status === 'won' || dispute.status === 'warning_closed' ? 'paid' : null
      if (!target) return ignored
      const orderId = await orderIdFromPaymentIntent(dispute.payment_intent)
      if (!orderId) return null
      return await setStatus(orderId, target, 'webhook', { p_reason: `dispute_${dispute.status}` }, ref)
    }
    case 'charge.refunded': {
      const charge = event.data.object
      // Reembolso parcial fica fora das RPCs (D5): só pelo suporte.
      if (!charge.refunded) return ignored
      const orderId = await orderIdFromPaymentIntent(charge.payment_intent)
      if (!orderId) return null
      return await setStatus(orderId, 'refunded', 'webhook', { p_reason: 'manual_refund' }, ref)
    }
    default:
      return ignored
  }
}

function codeOf(error: unknown): string | null {
  if (error instanceof RpcError || error instanceof HttpError) return error.code
  return null
}

export async function handleStripeWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') return postOnly()
  const signature = req.headers.get('Stripe-Signature')
  const payload = await req.text()
  let event: Stripe.Event
  try {
    if (!signature) throw new Error('sem assinatura')
    event = await stripe().webhooks.constructEventAsync(payload, signature, env.stripeWebhookSecret(), undefined, cryptoProvider)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`stripe-webhook: configuração (${error.message})`)
      return errorResponse(500, 'INTERNAL_ERROR', 'Erro interno.')
    }
    // Assinatura inválida: nada é alterado.
    return errorResponse(400, 'INVALID_SIGNATURE', 'Assinatura inválida.')
  }

  try {
    const result = await processEvent(event)
    if (!result) {
      console.log(`stripe-webhook: ${event.type} ${event.id} sem pedido nosso`)
      return json({ received: true, outcome: 'not_ours' })
    }
    // Evento que só vale depois de outro (ex.: contestação antes da liberação): a Stripe reenvia.
    if (result.outcome === 'deferred') return json({ received: false, outcome: 'deferred' }, 500)
    // Entrega por e-mail depois do commit, em segundo plano; se falhar, a agenda reenvia.
    if (result.send_delivery) dispatchSoon('stripe-webhook: entrega', result.outbox_id)
    return json({ received: true, outcome: result.outcome })
  } catch (error) {
    const code = codeOf(error)
    if (code && FINAL_ERRORS.has(code)) {
      console.error(`stripe-webhook: ${event.type} ${event.id} recusado pelo banco (${code}); conferência manual`)
      return json({ received: true, outcome: 'rejected', code })
    }
    // KT003, KT010, KT011, rede, banco ou Stripe: transitório ou defeito corrigível; a Stripe reenvia.
    const label = isStripeError(error) ? stripeErrorLabel(error) : errorLabel(error)
    console.error(`stripe-webhook: ${event.type} ${event.id} falhou (${label})`)
    return json({ received: false }, 500)
  }
}
