// Pedidos no admin (2026-10-24, Fase 3): os formatos de /admin/orders e /admin/orders/:id e os nomes que a tela mostra.
import { orderStatusLabel } from './users'

export type OrderFilter = 'all' | 'paid' | 'pending' | 'abandoned' | 'refunded' | 'disputed' | 'courtesy'

export interface OrderSummary {
  id: string
  ref: string
  kind: 'purchase' | 'courtesy'
  status: string
  email: string | null
  user_id: string | null
  created_at: string
  paid_at: string | null
  amount_total: number | null
  currency: string | null
  promotion_code: string | null
  items: string[]
}
export interface OrderList { total: number; offset: number; limit: number; page: number; orders: OrderSummary[] }

export interface OrderDetail {
  order: {
    id: string
    ref: string
    kind: 'purchase' | 'courtesy'
    status: string
    created_at: string
    paid_at: string | null
    refunded_at: string | null
    checkout_expires_at: string | null
    amount_subtotal: number | null
    amount_discount: number | null
    amount_total: number | null
    currency: string | null
    promotion_code: string | null
    livemode: boolean
    terms_version: string | null
    terms_accepted_at: string | null
    stripe_checkout_session_id: string | null
    stripe_payment_intent_id: string | null
    deliverable: boolean
    refundable: boolean
    reconcilable: boolean
  }
  person: { id: string | null; email: string | null; order_email: string | null; exists: boolean; stripe_customer_id: string | null }
  items: { code: string; name: string | null; kind: string; unit_amount: number | null; currency: string | null }[]
  events: { from_status: string | null; to_status: string; source: string; reason: string | null; created_at: string }[]
  entitlements: {
    id: string
    status: 'active' | 'revoked'
    revoke_reason: string | null
    granted_at: string
    revoked_at: string | null
    product: { code: string; name: string | null; kind: string }
    games: { code: string; name: string | null }[]
  }[]
  downloads: { count: number; last_at: string | null }
  emails: { kind: string; status: string; skip_reason: string | null; created_at: string; sent_at: string | null }[]
  history: { action: string; created_at: string; by: string | null; details: Record<string, unknown> | null }[]
}

// De onde veio cada passo do pedido (order_events.source).
const SOURCES: Record<string, string> = {
  checkout: 'na sacola', webhook: 'pelo aviso da Stripe', return_page: 'na página de confirmação',
  reconcile: 'conferido com a Stripe', admin: 'pela equipe', system: 'pelo sistema',
}
export const eventLabel = (event: OrderDetail['events'][number]) =>
  `${orderStatusLabel({ kind: 'purchase', status: event.to_status })}, ${SOURCES[event.source] ?? event.source}`

// Painel da Stripe do pagamento, no modo do pedido (teste ou produção).
export const stripePaymentUrl = (paymentIntent: string, livemode: boolean) =>
  `https://dashboard.stripe.com/${livemode ? '' : 'test/'}payments/${encodeURIComponent(paymentIntent)}`
