// Usuários no admin (2026-10-23, Fase 4): os formatos de /admin/users e /admin/users/:id e os nomes que a tela mostra.

export type UserFilter = 'all' | 'buyers' | 'newsletter' | 'blocked' | 'admins'

export interface UserSummary {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  confirmed: boolean
  blocked: boolean
  admin: boolean
  providers: (string | null)[]
  newsletter: boolean
  purchases: number
  games: number
}
export interface UserList { total: number; offset: number; limit: number; page: number; users: UserSummary[] }

export interface LibraryEntry {
  entitlement_id: string
  status: 'active' | 'revoked'
  revoke_reason: string | null
  granted_at: string
  revoked_at: string | null
  product: { code: string; name: string | null; kind: string }
  order: { id: string; ref: string; kind: 'purchase' | 'courtesy' }
  games: { code: string; name: string | null }[]
}
export interface UserOrder {
  id: string
  ref: string
  kind: 'purchase' | 'courtesy'
  status: string
  created_at: string
  paid_at: string | null
  refunded_at: string | null
  amount_total: number | null
  amount_discount: number | null
  currency: string | null
  promotion_code: string | null
  livemode: boolean
  deliverable: boolean
  items: { code: string; name: string | null; unit_amount: number | null }[]
}
export interface UserDetail {
  account: {
    id: string
    email: string
    created_at: string
    confirmed_at: string | null
    last_sign_in_at: string | null
    providers: (string | null)[]
    name: string | null
    blocked: boolean
    banned_until: string | null
    admin: boolean
    self: boolean
    stripe_customer_id: string | null
  }
  newsletter: { opted_in: boolean; opted_in_at: string | null; history: { action: 'granted' | 'revoked'; source: string; occurred_at: string }[] }
  library: LibraryEntry[]
  orders: UserOrder[]
  emails: { kind: string; status: string; skip_reason: string | null; created_at: string; sent_at: string | null; order_ref: string | null }[]
  suppressions: { reason: string; source: string; occurred_at: string }[]
  downloads: { count: number; last_at: string | null }
  history: { action: string; created_at: string; by: string | null; details: Record<string, unknown> | null }[]
  giftable: { code: string; name: string | null; kind: string; owned: boolean }[]
}

// Acompanhamento (GET /admin/follow-up): cada lista com o total e até 100 pessoas.
export interface FollowUpList<T> { total: number; items: T[] }
export interface FollowUp {
  cart: FollowUpList<{ user_id: string; email: string; since: string; last_added: string; items: string[]; reminded: boolean }>
  no_download: FollowUpList<{ user_id: string; email: string; order_id: string; order_ref: string; order_kind: 'purchase' | 'courtesy'; paid_at: string; items: string[] }>
  delivery: FollowUpList<{ user_id: string; email: string; order_id: string | null; order_ref: string | null; problem: 'failed' | 'suppressed'; reason: string | null; at: string }>
  unconfirmed: FollowUpList<{ user_id: string; email: string; created_at: string }>
}

const label = (labels: Record<string, string>, value: string | null | undefined) => (value && Object.hasOwn(labels, value) ? labels[value] : value ?? '')

const PROVIDERS: Record<string, string> = { email: 'Código por e-mail', google: 'Google' }
export const providersLabel = (providers: (string | null)[]) =>
  [...new Set(providers.filter((value): value is string => Boolean(value)))].map(value => label(PROVIDERS, value)).join(' e ') || '—'

const ORDER_STATUS: Record<string, string> = {
  open: 'Aberto, sem pagamento', pending_payment: 'Pagamento em andamento', paid: 'Pago', failed: 'Pagamento falhou',
  expired: 'Expirou', disputed: 'Em contestação', dispute_lost: 'Contestação perdida', refunded: 'Reembolsado',
}
export const orderStatusLabel = (order: Pick<UserOrder, 'kind' | 'status'>) => (order.kind === 'courtesy' && order.status === 'paid' ? 'Presente' : label(ORDER_STATUS, order.status))

const REVOKE_REASONS: Record<string, string> = { refund: 'reembolso', dispute: 'contestação do pagamento', manual: 'retirado pela equipe', account_deleted: 'conta excluída' }
export const revokeReasonLabel = (reason: string | null) => label(REVOKE_REASONS, reason) || 'retirado'

const EMAIL_KINDS: Record<string, string> = { delivery: 'Entrega', gift: 'Presente', refund: 'Aviso de reembolso', admin_alert: 'Alerta do admin', cart_reminder: 'Lembrete da sacola', cart_reminder_2: 'Sacola, 2º toque', post_purchase: 'Depois da compra' }
const EMAIL_STATUS: Record<string, string> = { queued: 'Na fila', sending: 'Enviando', sent: 'Enviado', failed: 'Falhou', skipped: 'Não enviado', canceled: 'Cancelado' }
const SKIP_REASONS: Record<string, string> = {
  no_opt_in: 'sem aceite das novidades', suppressed: 'endereço bloqueado', already_purchased: 'já comprou', cart_changed: 'a sacola mudou',
  cart_empty: 'a sacola esvaziou', order_not_paid: 'pedido não pago', entitlement_revoked: 'jogo retirado', email_not_confirmed: 'e-mail não confirmado',
}
export const emailKindLabel = (kind: string) => label(EMAIL_KINDS, kind)
export const emailStatusLabel = (status: string, reason: string | null) => `${label(EMAIL_STATUS, status)}${reason ? ` (${label(SKIP_REASONS, reason)})` : ''}`

const SUPPRESSIONS: Record<string, string> = { hard_bounce: 'o endereço não existe (devolução permanente)', complaint: 'marcou um e-mail como spam', unsubscribe_all: 'pediu para não receber nada' }
export const suppressionLabel = (reason: string) => label(SUPPRESSIONS, reason)

const CONSENT_SOURCES: Record<string, string> = {
  signup_prompt: 'no convite da conta nova', cart: 'na sacola', free_games: 'nos gratuitos', account: 'em Minha conta',
  support: 'pela equipe', unsubscribe_link: 'pelo link do e-mail', brevo_webhook: 'pela Brevo', ses_events: 'pelo aviso de spam da AWS', plunk_webhook: 'pelo rodapé de um e-mail do Plunk',
}
export const consentLabel = (entry: { action: string; source: string }) => `${entry.action === 'granted' ? 'Aceitou' : 'Saiu'} ${label(CONSENT_SOURCES, entry.source)}`

const ACTIONS: Record<string, string> = {
  user_gift: 'Deu um jogo de presente', user_revoke: 'Retirou um jogo', user_resend: 'Reenviou o e-mail de acesso',
  user_newsletter_off: 'Tirou das novidades', user_block: 'Bloqueou o login', user_unblock: 'Desbloqueou o login', user_export: 'Exportou os dados',
  user_admin_grant: 'Tornou admin', user_admin_revoke: 'Tirou o admin',
  order_refund: 'Reembolsou o pedido', order_reconcile: 'Conferiu o pedido com a Stripe', alert_resolve: 'Resolveu um alerta',
}
export const actionLabel = (action: string) => label(ACTIONS, action)

// Painel da Stripe do cliente, no modo dos pedidos da pessoa (teste ou produção).
export const stripeCustomerUrl = (customer: string, livemode: boolean) => `https://dashboard.stripe.com/${livemode ? '' : 'test/'}customers/${encodeURIComponent(customer)}`
