import type Stripe from 'stripe'
import { rpcRow } from './admin.ts'
import { stripe } from './stripe.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Source = 'webhook' | 'return_page'

export interface EventRef {
  id: string
  type: string
}

// Retorno de fulfill_order e set_order_status (data-contract 6.4 e 6.5).
export interface OrderOutcome {
  outcome: string
  order_id?: string | null
  order_status?: string | null
  outbox_id?: string | null
  send_delivery?: boolean | null
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

// Pedido nosso: client_reference_id com UUID. Sessões criadas fora da api não têm.
export function orderIdFromSession(session: { client_reference_id: string | null }): string | null {
  return isUuid(session.client_reference_id) ? session.client_reference_id : null
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id ?? null)

// Estado atual da sessão na Stripe, com o código promocional expandido e todos os itens.
export async function loadSession(sessionId: string): Promise<{ session: Stripe.Checkout.Session; items: Stripe.LineItem[] }> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['discounts.promotion_code'] })
  const items: Stripe.LineItem[] = []
  for await (const item of stripe().checkout.sessions.listLineItems(sessionId, { limit: 100 })) items.push(item)
  return { session, items }
}

function promotionCode(session: Stripe.Checkout.Session): string | null {
  for (const discount of session.discounts ?? []) {
    const promo = discount.promotion_code
    if (promo && typeof promo === 'object' && typeof promo.code === 'string') return promo.code
  }
  return null
}

// Valores cobrados pela Stripe: subtotal (preço cheio), desconto do cupom e total.
function amounts(session: Stripe.Checkout.Session) {
  return {
    p_amount_subtotal: session.amount_subtotal,
    p_amount_discount: session.total_details?.amount_discount ?? 0,
    p_amount_total: session.amount_total,
    p_currency: session.currency,
    p_promotion_code: promotionCode(session),
  }
}

export function pendingPaymentArgs(session: Stripe.Checkout.Session): Record<string, unknown> {
  return { ...amounts(session), p_payment_intent_id: idOf(session.payment_intent) }
}

// Liberação idempotente (webhook e página de confirmação chamam a mesma RPC).
export async function fulfill(session: Stripe.Checkout.Session, items: Stripe.LineItem[], source: Source, event?: EventRef): Promise<OrderOutcome> {
  return await rpcRow<OrderOutcome>('fulfill_order', {
    p_order_id: orderIdFromSession(session),
    p_checkout_session_id: session.id,
    p_payment_status: session.payment_status,
    ...amounts(session),
    p_payment_intent_id: idOf(session.payment_intent),
    p_customer_id: idOf(session.customer),
    p_livemode: session.livemode,
    // Preço unitário CHEIO por item; o desconto do cupom vai no pedido.
    p_items: items.map((item) => ({
      stripe_price_id: item.price?.id ?? null,
      quantity: item.quantity,
      unit_amount: item.price?.unit_amount ?? null,
      currency: item.currency,
    })),
    p_source: source,
    p_stripe_event_id: event?.id ?? null,
    p_event_type: event?.type ?? null,
  })
}

export async function setStatus(orderId: string, newStatus: string, source: Source, extra: Record<string, unknown> = {}, event?: EventRef): Promise<OrderOutcome> {
  return await rpcRow<OrderOutcome>('set_order_status', {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_source: source,
    p_stripe_event_id: event?.id ?? null,
    p_event_type: event?.type ?? null,
    ...extra,
  })
}
