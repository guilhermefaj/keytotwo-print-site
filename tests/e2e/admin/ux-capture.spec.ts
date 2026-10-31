import { expect, test, type Page, type Route } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { authStorageKey, session, user } from './session'

// Revisão de UX do admin (2026-10-31, docs/admin-ux-2026-10-31.md), com os dados de uma loja pequena de verdade:
// - as capturas de cada página em 1440x900 e 390x844, a página inteira e sem animação, só com ADMIN_CAPTURE=1:
//     ADMIN_CAPTURE=1 npx playwright test tests/e2e/admin/ux-capture.spec.ts --project=admin --reporter=line
//   (as telas vão para .maestri/design-review/admin/<nome>-<largura>.png);
// - os testes das melhorias da revisão (no fim do arquivo), que rodam sempre.
// O Auth, a API, o site e o bucket do blog são simulados (formatos dos outros specs do admin e de admin/src/*.ts);
// nenhuma chamada sai da máquina. Erros do console, chamadas sem simulação e rolagem lateral aparecem na saída.
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const OUT = '.maestri/design-review/admin'
const SIZES = [[1440, 900], [390, 844]] as const
const MEDIA = 'https://keytotwo-blog.s3.us-east-005.backblazeb2.com'
const BLOG_VERSION = 'b7'.repeat(16)
const CATALOG_VERSION = 'c4'.repeat(16)
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`
const brl = 'brl'

// ---------------------------------------------------------------- catálogo
type Code = 'P001' | 'J001' | 'J002' | 'J003' | 'J004' | 'J005'
const PRODUCTS: Record<Code, { name: string; kind: 'bundle' | 'single'; slug: string; price: number; list?: number }> = {
  P001: { name: 'Coleção KeyToTwo: Fundadores', kind: 'bundle', slug: 'colecao-fundadores', price: 2990, list: 3990 },
  J001: { name: 'Rabisque e Adivinhe', kind: 'single', slug: 'rabisque-e-adivinhe', price: 990 },
  J002: { name: 'O Sumiço de Rapadura', kind: 'single', slug: 'o-sumico-de-rapadura', price: 1290 },
  J003: { name: 'Tabuleiro da Sorte', kind: 'single', slug: 'tabuleiro-da-sorte', price: 990 },
  J004: { name: 'A Rota da Fornalha', kind: 'single', slug: 'a-rota-da-fornalha', price: 1290 },
  J005: { name: 'Retrospectiva a Dois', kind: 'single', slug: 'retrospectiva-a-dois', price: 990 },
}
const PACK: Code[] = ['J001', 'J003', 'J002', 'J004', 'J005']
const GAME_NAMES: Record<string, string> = { ...Object.fromEntries(PACK.map(code => [code, PRODUCTS[code].name])), F001: 'Hora dos Artistas', F002: 'Pote de Planos' }
const gamesOf = (code: Code) => (code === 'P001' ? PACK : [code]).map(game => ({ code: game, name: GAME_NAMES[game] }))

// ---------------------------------------------------------------- pessoas
interface Person {
  id: string; email: string; name: string | null; created_at: string; last_sign_in_at: string | null; confirmed: boolean; blocked: boolean
  admin: boolean; providers: string[]; newsletter_at: string | null; source?: string
}
const person = (n: number, email: string, name: string | null, created_at: string, last_sign_in_at: string | null, extra: Partial<Person> = {}): Person => ({
  id: uuid('5e3a7c10', n), email, name, created_at, last_sign_in_at, confirmed: true, blocked: false, admin: false, providers: ['google'], newsletter_at: null, ...extra,
})
const ME_EMAIL = 'admin@keytotwo.com.br'
const MARIANA = person(1, 'mariana.costa@gmail.com', 'Mariana Costa', '2026-10-10T21:02:00Z', '2026-10-30T22:41:00Z', { newsletter_at: '2026-10-10T21:03:00Z', source: 'signup_prompt' })
const RAFAEL = person(2, 'rafael.lima@outlook.com', 'Rafael Lima', '2026-09-18T23:10:00Z', '2026-10-30T14:02:00Z', { providers: ['email'] })
const JULIA = person(3, 'julia.rocha@gmail.com', 'Júlia Rocha', '2026-10-20T19:35:00Z', '2026-10-22T12:58:00Z', { newsletter_at: '2026-10-20T19:36:00Z', source: 'cart' })
const BRUNO = person(4, 'bruno.alves@yahoo.com.br', null, '2026-10-18T02:20:00Z', '2026-10-18T02:21:00Z', { providers: ['email'], blocked: true })
const CAMILA = person(5, 'camila.ferreira@gmail.com', 'Camila Ferreira', '2026-10-31T18:30:00Z', '2026-10-31T18:31:00Z', { newsletter_at: '2026-10-31T18:32:00Z', source: 'cart' })
const LETICIA = person(6, 'leticia.moura@gmial.com', null, '2026-10-24T20:00:00Z', '2026-10-24T20:01:00Z', { providers: ['email'], newsletter_at: '2026-10-24T20:01:30Z', source: 'free_games' })
const PEDRO = person(7, 'pedro.henrique.s@gmail.com', 'Pedro Henrique', '2026-08-28T21:50:00Z', '2026-10-27T01:12:00Z')
const ANA = person(8, 'anabeatriz.reis@outlook.com', 'Ana Beatriz Reis', '2026-10-29T19:55:00Z', '2026-10-29T20:00:00Z', { providers: ['email', 'google'], newsletter_at: '2026-10-29T19:56:00Z', source: 'signup_prompt' })
const THIAGO = person(9, 'thiago.nunes@hotmail.com', 'Thiago Nunes', '2026-10-24T16:10:00Z', '2026-10-31T20:05:00Z', { providers: ['email'] })
const FERNANDA = person(10, 'fernanda.dias@gmail.com', 'Fernanda Dias', '2026-09-25T00:30:00Z', '2026-10-26T22:40:00Z', { newsletter_at: '2026-09-25T00:31:00Z', source: 'account' })
const PAULA = person(11, 'paula.vieira@gmail.com', null, '2026-10-29T11:20:00Z', null, { providers: ['email'], confirmed: false })
const JOAO = person(12, 'joaopedro.alm@icloud.com', null, '2026-10-30T23:48:00Z', null, { providers: ['email'], confirmed: false })
const ME: Person = { ...person(13, ME_EMAIL, 'Equipe KeyToTwo', '2026-08-01T12:00:00Z', '2026-10-31T19:40:00Z'), id: 'qa-admin', admin: true }
const LARISSA = person(14, 'larissa@keytotwo.com.br', 'Larissa Mendes', '2026-08-03T14:00:00Z', '2026-10-31T13:22:00Z', { admin: true })
const PEOPLE = [CAMILA, THIAGO, JOAO, ANA, PAULA, MARIANA, JULIA, LETICIA, BRUNO, FERNANDA, RAFAEL, PEDRO, LARISSA, ME]

// ---------------------------------------------------------------- parceiros
const DUDA = { id: uuid('9a27e0f0', 1), slug: 'duda-ribeiro', name: 'Duda Ribeiro' }
const CASAL = { id: uuid('9a27e0f0', 2), slug: 'casal-de-dados', name: 'Casal de Dados' }

// ---------------------------------------------------------------- pedidos
type Origin = { partner?: typeof DUDA; source?: 'code' | 'link'; landed_at?: string; path?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string } | null
type Email = { kind: string; status: string; skip_reason: string | null; created_at: string; sent_at: string | null }
type History = { action: string; created_at: string; by: string | null; details: Record<string, unknown> }
interface Order {
  id: string; ref: string; kind: 'purchase' | 'courtesy'; status: string; person: Person; created_at: string; paid_at: string | null; refunded_at: string | null
  items: Code[]; discount: number; code: string | null; origin: Origin; downloads: number; last_download: string | null; emails?: Email[]; history?: History[]
}
const order = (n: number, ref: string, who: Person, status: string, created_at: string, items: Code[], extra: Partial<Order> = {}): Order => ({
  id: uuid('0dd3e510', n), ref, kind: 'purchase', status, person: who, created_at, items, discount: 0, code: null, origin: null, downloads: 0, last_download: null, refunded_at: null,
  paid_at: ['paid', 'refunded', 'disputed', 'dispute_lost'].includes(status) ? new Date(Date.parse(created_at) + 70_000).toISOString() : null, ...extra,
})
const later = (value: string, seconds: number) => new Date(Date.parse(value) + seconds * 1000).toISOString()
const DISPUTED_AT = '2026-10-30T11:02:00Z'
const ORDERS: Order[] = [
  order(1, 'A3F9C21E', MARIANA, 'paid', '2026-10-28T23:12:00Z', ['P001'], {
    origin: { utm_source: 'instagram', utm_medium: 'stories', utm_campaign: 'lancamento', landed_at: '2026-10-28T23:05:00Z', path: '/loja' }, downloads: 4, last_download: '2026-10-29T20:15:00Z',
    emails: [{ kind: 'delivery', status: 'sent', skip_reason: null, created_at: '2026-10-28T23:13:10Z', sent_at: '2026-10-28T23:13:14Z' },
      { kind: 'delivery', status: 'sent', skip_reason: null, created_at: '2026-10-29T19:50:00Z', sent_at: '2026-10-29T19:50:06Z' },
      { kind: 'post_purchase', status: 'sent', skip_reason: null, created_at: '2026-10-30T23:13:00Z', sent_at: '2026-10-30T23:13:05Z' }],
    history: [{ action: 'user_resend', created_at: '2026-10-29T19:50:00Z', by: 'larissa@keytotwo.com.br', details: { order_ref: 'A3F9C21E', reason: 'Disse que o e-mail não chegou' } }],
  }),
  order(2, '7B2D04AA', RAFAEL, 'paid', '2026-10-30T14:05:00Z', ['J002'], {
    emails: [{ kind: 'delivery', status: 'failed', skip_reason: null, created_at: '2026-10-30T14:06:10Z', sent_at: null }],
  }),
  order(3, 'C81E5F03', JULIA, 'refunded', '2026-10-20T19:40:00Z', ['P001'], {
    refunded_at: '2026-10-22T13:10:00Z', origin: { partner: DUDA, source: 'link', landed_at: '2026-10-20T19:31:00Z', path: '/' },
    history: [{ action: 'order_refund', created_at: '2026-10-22T13:10:00Z', by: 'larissa@keytotwo.com.br', details: { reason: 'Pediu por e-mail: comprou achando que vinha impresso' } }],
  }),
  order(4, '0D4E9B71', BRUNO, 'disputed', '2026-10-18T02:33:00Z', ['J004'], { downloads: 7, last_download: '2026-10-18T03:10:00Z' }),
  order(5, 'E6A1C8F2', CAMILA, 'pending_payment', '2026-10-31T18:50:00Z', ['P001'], { discount: 299, code: 'PRIMEIRA10' }),
  order(6, '5F3B2D90', LETICIA, 'paid', '2026-10-25T12:00:00Z', ['J005'], {
    kind: 'courtesy', paid_at: '2026-10-25T12:00:00Z',
    history: [{ action: 'user_gift', created_at: '2026-10-25T12:00:00Z', by: ME_EMAIL, details: { product: 'Retrospectiva a Dois', reason: 'Sorteio do Instagram de outubro' } }],
  }),
  order(7, '9A7C6E14', PEDRO, 'paid', '2026-10-27T01:15:00Z', ['J001', 'J003'], { origin: { partner: CASAL, source: 'link', landed_at: '2026-10-27T01:02:00Z', path: '/jogos/rabisque-e-adivinhe', utm_source: 'youtube' } }),
  order(8, '2C5D8B47', ANA, 'paid', '2026-10-29T20:02:00Z', ['P001'], { discount: 1495, code: 'LANCAMENTO50', origin: { utm_source: 'tiktok', utm_campaign: 'lancamento' }, downloads: 2, last_download: '2026-10-29T20:20:00Z' }),
  order(9, 'B4E0F6A2', THIAGO, 'expired', '2026-10-24T16:20:00Z', ['J002'], {
    emails: [{ kind: 'cart_reminder', status: 'skipped', skip_reason: 'no_opt_in', created_at: '2026-10-25T16:20:00Z', sent_at: null }],
  }),
  order(10, '6E9F1A3C', FERNANDA, 'paid', '2026-10-26T22:47:00Z', ['P001'], { discount: 299, code: 'DUDA10', origin: { partner: DUDA, source: 'code' }, downloads: 3, last_download: '2026-10-28T21:00:00Z' }),
  order(11, '8D2A7C5B', THIAGO, 'open', '2026-10-31T20:10:00Z', ['J002', 'J005']),
  order(12, 'F1B3E8D6', MARIANA, 'paid', '2026-10-10T21:30:00Z', ['J001'], { discount: 99, code: 'PRIMEIRA10', downloads: 2, last_download: '2026-10-11T22:04:00Z' }),
  order(13, '3E8C0B9D', CAMILA, 'failed', '2026-10-31T18:41:00Z', ['P001'], { discount: 299, code: 'PRIMEIRA10' }),
  order(14, 'D7E2A9C4', RAFAEL, 'paid', '2026-09-18T23:20:00Z', ['J001'], { origin: { partner: DUDA, source: 'link', landed_at: '2026-09-18T23:08:00Z', path: '/' }, downloads: 1, last_download: '2026-09-18T23:25:00Z' }),
  order(15, '4A8B1F6E', FERNANDA, 'paid', '2026-09-25T00:40:00Z', ['J003'], { discount: 99, code: 'DUDA10', origin: { partner: DUDA, source: 'code' }, downloads: 2, last_download: '2026-09-27T20:00:00Z' }),
  order(16, 'C3D9E1F7', PEDRO, 'paid', '2026-08-28T22:05:00Z', ['J005'], { origin: { partner: DUDA, source: 'link', landed_at: '2026-08-28T21:40:00Z', path: '/' }, downloads: 1, last_download: '2026-08-28T22:30:00Z' }),
].sort((a, b) => b.created_at.localeCompare(a.created_at))
const PAID = ORDERS.find(item => item.ref === 'A3F9C21E')!
const REFUNDED = ORDERS.find(item => item.ref === 'C81E5F03')!

const subtotal = (item: Order) => item.items.reduce((sum, code) => sum + PRODUCTS[code].price, 0)
const total = (item: Order) => (item.kind === 'courtesy' ? 0 : subtotal(item) - item.discount)
const paidPurchase = (item: Order) => item.kind === 'purchase' && item.status === 'paid'
const entitlementId = (item: Order, index: number) => `e0e0e0e0-0000-4000-8000-${item.ref.toLowerCase()}000${index}`
// Os jogos que o pedido liberou: retirados no reembolso e na contestação.
function entitlements(item: Order) {
  if (!item.paid_at) return []
  const revoked = item.status === 'refunded' ? { reason: 'refund', at: item.refunded_at } : item.status === 'disputed' ? { reason: 'dispute', at: DISPUTED_AT } : null
  return item.items.map((code, index) => ({
    id: entitlementId(item, index), status: revoked ? 'revoked' : 'active', revoke_reason: revoked?.reason ?? null, granted_at: item.paid_at!, revoked_at: revoked?.at ?? null,
    product: { code, name: PRODUCTS[code].name, kind: PRODUCTS[code].kind }, games: gamesOf(code),
  }))
}
function emails(item: Order): Email[] {
  if (item.emails) return item.emails
  if (!item.paid_at) return []
  const first = later(item.paid_at, 10)
  const list: Email[] = [{ kind: item.kind === 'courtesy' ? 'gift' : 'delivery', status: 'sent', skip_reason: null, created_at: first, sent_at: later(first, 4) }]
  if (item.refunded_at) list.push({ kind: 'refund', status: 'sent', skip_reason: null, created_at: item.refunded_at, sent_at: later(item.refunded_at, 6) })
  return list
}
function events(item: Order) {
  const at = (seconds: number) => later(item.created_at, seconds)
  switch (item.status) {
    case 'open': return []
    case 'pending_payment': return [{ from_status: 'open', to_status: 'pending_payment', source: 'webhook', reason: null, created_at: at(40) }]
    case 'failed': return [{ from_status: 'open', to_status: 'failed', source: 'webhook', reason: 'card_declined', created_at: at(55) }]
    case 'expired': return [{ from_status: 'open', to_status: 'expired', source: 'system', reason: null, created_at: at(24 * 3600) }]
    default: {
      if (item.kind === 'courtesy') return [{ from_status: null, to_status: 'paid', source: 'admin', reason: 'gift', created_at: item.created_at }]
      const paid = { from_status: 'open', to_status: 'paid', source: 'webhook', reason: null, created_at: item.paid_at! }
      if (item.status === 'refunded') return [paid, { from_status: 'paid', to_status: 'refunded', source: 'admin', reason: 'admin_refund', created_at: item.refunded_at! }]
      if (item.status === 'disputed') return [paid, { from_status: 'paid', to_status: 'disputed', source: 'webhook', reason: 'fraudulent', created_at: DISPUTED_AT }]
      return [paid]
    }
  }
}
const customerId = (who: Person) => `cus_R${who.id.slice(-2)}Qm7XkT2pLa`
const summaryOf = (item: Order) => ({
  id: item.id, ref: item.ref, kind: item.kind, status: item.status, email: item.person.email, user_id: item.person.id, created_at: item.created_at, paid_at: item.paid_at,
  amount_total: total(item), currency: brl, promotion_code: item.code, items: item.items.map(code => PRODUCTS[code].name),
})
function orderDetail(item: Order) {
  const charged = item.kind === 'purchase' && Boolean(item.paid_at)
  return {
    order: {
      id: item.id, ref: item.ref, kind: item.kind, status: item.status, created_at: item.created_at, paid_at: item.paid_at, refunded_at: item.refunded_at,
      checkout_expires_at: ['open', 'pending_payment'].includes(item.status) ? later(item.created_at, 24 * 3600) : null,
      amount_subtotal: item.kind === 'courtesy' ? 0 : subtotal(item), amount_discount: item.discount, amount_total: total(item), currency: brl, promotion_code: item.code, livemode: true,
      terms_version: item.kind === 'purchase' ? 'termos-2026-10-22' : null, terms_accepted_at: item.kind === 'purchase' ? later(item.created_at, -20) : null,
      stripe_checkout_session_id: item.kind === 'purchase' ? `cs_live_a1${item.ref}Zk3` : null, stripe_payment_intent_id: charged ? `pi_3Q${item.ref}xJ2a` : null,
      deliverable: item.status === 'paid', refundable: paidPurchase(item), reconcilable: ['open', 'pending_payment'].includes(item.status),
    },
    person: { id: item.person.id, email: item.person.email, order_email: item.person.email, exists: true, stripe_customer_id: charged ? customerId(item.person) : null },
    origin: item.origin,
    items: item.items.map(code => ({ code, name: PRODUCTS[code].name, kind: PRODUCTS[code].kind, unit_amount: PRODUCTS[code].price, currency: brl })),
    events: events(item),
    entitlements: entitlements(item),
    downloads: { count: item.downloads, last_at: item.last_download },
    emails: emails(item),
    history: item.history ?? [],
  }
}

function orderFilter(item: Order, filter: string) {
  if (filter === 'paid') return paidPurchase(item)
  if (filter === 'pending') return ['open', 'pending_payment'].includes(item.status)
  if (filter === 'abandoned') return ['expired', 'failed'].includes(item.status)
  if (filter === 'refunded') return item.status === 'refunded'
  if (filter === 'disputed') return item.status.startsWith('dispute')
  if (filter === 'courtesy') return item.kind === 'courtesy'
  return true
}

// ---------------------------------------------------------------- contas
const ordersOf = (who: Person) => ORDERS.filter(item => item.person === who)
const libraryOf = (who: Person) => ordersOf(who).flatMap(item => entitlements(item).map(entry => ({
  entitlement_id: entry.id, status: entry.status, revoke_reason: entry.revoke_reason, granted_at: entry.granted_at, revoked_at: entry.revoked_at,
  product: entry.product, order: { id: item.id, ref: item.ref, kind: item.kind }, games: entry.games,
})))
const ownedGames = (who: Person) => new Set(libraryOf(who).filter(entry => entry.status === 'active').flatMap(entry => entry.games.map(game => game.code)))
function userSummary(who: Person) {
  return {
    id: who.id, email: who.email, created_at: who.created_at, last_sign_in_at: who.last_sign_in_at, confirmed: who.confirmed, blocked: who.blocked, admin: who.admin,
    providers: who.providers, newsletter: Boolean(who.newsletter_at), purchases: ordersOf(who).filter(item => item.kind === 'purchase' && item.paid_at).length, games: ownedGames(who).size,
  }
}
const SUPPRESSIONS: Record<string, { reason: string; source: string; occurred_at: string }[]> = {
  [LETICIA.id]: [{ reason: 'hard_bounce', source: 'ses_events', occurred_at: '2026-10-25T12:00:20Z' }],
}
const USER_HISTORY: Record<string, History[]> = {
  [BRUNO.id]: [{ action: 'user_block', created_at: '2026-10-30T11:20:00Z', by: ME_EMAIL, details: { reason: 'Contestou o pagamento depois de baixar 7 vezes' } }],
  [LARISSA.id]: [{ action: 'user_admin_grant', created_at: '2026-08-03T14:05:00Z', by: ME_EMAIL, details: { reason: 'Cuida do blog e do atendimento' } }],
}
function userDetail(who: Person) {
  const mine = ordersOf(who)
  const owned = ownedGames(who)
  const downloads = mine.filter(item => item.last_download).sort((a, b) => b.last_download!.localeCompare(a.last_download!))
  const extraEmails = who === MARIANA ? [{ kind: 'cart_reminder', status: 'skipped', skip_reason: 'already_purchased', created_at: '2026-10-28T23:40:00Z', sent_at: null, order_ref: null }] : []
  return {
    account: {
      id: who.id, email: who.email, created_at: who.created_at, confirmed_at: who.confirmed ? later(who.created_at, 60) : null, last_sign_in_at: who.last_sign_in_at,
      providers: who.providers, name: who.name, blocked: who.blocked, banned_until: who.blocked ? '2126-10-30T11:20:00Z' : null, admin: who.admin, self: who === ME,
      stripe_customer_id: mine.some(item => item.kind === 'purchase' && item.paid_at) ? customerId(who) : null,
    },
    newsletter: {
      opted_in: Boolean(who.newsletter_at), opted_in_at: who.newsletter_at,
      history: who.newsletter_at ? [{ action: 'granted', source: who.source ?? 'signup_prompt', occurred_at: who.newsletter_at }] : [],
    },
    library: libraryOf(who),
    orders: mine.map(item => ({
      id: item.id, ref: item.ref, kind: item.kind, status: item.status, created_at: item.created_at, paid_at: item.paid_at, refunded_at: item.refunded_at,
      amount_total: total(item), amount_discount: item.discount, currency: brl, promotion_code: item.code, livemode: true, deliverable: item.status === 'paid',
      items: item.items.map(code => ({ code, name: PRODUCTS[code].name, unit_amount: PRODUCTS[code].price })),
    })),
    emails: [...mine.flatMap(item => emails(item).map(email => ({ ...email, order_ref: item.ref }))), ...extraEmails].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    suppressions: SUPPRESSIONS[who.id] ?? [],
    downloads: { count: mine.reduce((sum, item) => sum + item.downloads, 0), last_at: downloads[0]?.last_download ?? null },
    history: [...(USER_HISTORY[who.id] ?? []), ...mine.flatMap(item => (item.history ?? []).map(entry => ({ ...entry, details: { ...entry.details, order_ref: item.ref } })))]
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    giftable: (Object.keys(PRODUCTS) as Code[]).map(code => ({ code, name: PRODUCTS[code].name, kind: PRODUCTS[code].kind, owned: gamesOf(code).every(game => owned.has(game.code)) })),
  }
}
function userFilter(who: Person, filter: string) {
  if (filter === 'buyers') return userSummary(who).purchases > 0
  if (filter === 'newsletter') return Boolean(who.newsletter_at)
  if (filter === 'blocked') return who.blocked
  if (filter === 'admins') return who.admin
  return true
}

const FOLLOW_UP = {
  cart: { total: 2, items: [
    { user_id: CAMILA.id, email: CAMILA.email, since: '2026-10-31T18:30:00Z', last_added: '2026-10-31T18:34:00Z', items: ['Coleção KeyToTwo: Fundadores'], reminded: false },
    { user_id: RAFAEL.id, email: RAFAEL.email, since: '2026-10-29T09:12:00Z', last_added: '2026-10-30T13:58:00Z', items: ['Retrospectiva a Dois', 'A Rota da Fornalha'], reminded: true },
  ] },
  no_download: { total: 3, items: [
    { user_id: RAFAEL.id, email: RAFAEL.email, order_id: ORDERS.find(item => item.ref === '7B2D04AA')!.id, order_ref: '7B2D04AA', order_kind: 'purchase', paid_at: '2026-10-30T14:06:10Z', items: ['O Sumiço de Rapadura'] },
    { user_id: PEDRO.id, email: PEDRO.email, order_id: ORDERS.find(item => item.ref === '9A7C6E14')!.id, order_ref: '9A7C6E14', order_kind: 'purchase', paid_at: '2026-10-27T01:16:10Z', items: ['Rabisque e Adivinhe', 'Tabuleiro da Sorte'] },
    { user_id: LETICIA.id, email: LETICIA.email, order_id: ORDERS.find(item => item.ref === '5F3B2D90')!.id, order_ref: '5F3B2D90', order_kind: 'courtesy', paid_at: '2026-10-25T12:00:00Z', items: ['Retrospectiva a Dois'] },
  ] },
  delivery: { total: 2, items: [
    { user_id: RAFAEL.id, email: RAFAEL.email, order_id: ORDERS.find(item => item.ref === '7B2D04AA')!.id, order_ref: '7B2D04AA', problem: 'failed', reason: null, at: '2026-10-30T14:06:10Z' },
    { user_id: LETICIA.id, email: LETICIA.email, order_id: null, order_ref: null, problem: 'suppressed', reason: 'hard_bounce', at: '2026-10-25T12:00:20Z' },
  ] },
  unconfirmed: { total: 2, items: [
    { user_id: JOAO.id, email: JOAO.email, created_at: JOAO.created_at },
    { user_id: PAULA.id, email: PAULA.email, created_at: PAULA.created_at },
  ] },
}

// ---------------------------------------------------------------- atenção
const alert = (id: number, kind: string, opened_at: string, over: Record<string, unknown> = {}) => ({
  id, kind, details: {}, opened_at, order_id: null, order_ref: null, order_status: null, livemode: null, user_id: null, resolved_at: null, resolution: null, resolved_by: null,
  manual: !['backup_late', 'email_queue_stuck', 'site_down'].includes(kind), ...over,
})
const forOrder = (ref: string) => {
  const item = ORDERS.find(entry => entry.ref === ref)!
  return { order_id: item.id, order_ref: ref, order_status: item.status, livemode: true, user_id: item.person.id }
}
const ALERTS = {
  open: [
    alert(44, 'backup_late', '2026-10-31T09:00:00Z', { details: { last_finished_at: '2026-10-30T06:31:00Z' } }),
    alert(41, 'dispute', DISPUTED_AT, { ...forOrder('0D4E9B71'), details: { dispute_id: 'dp_1QzA4hLk2mN8pQ7r', due_by: '2026-11-08T23:59:59+00:00', amount: 1290, currency: brl, reason: 'fraudulent' } }),
    alert(39, 'delivery_failed', '2026-10-25T12:00:30Z', { ...forOrder('5F3B2D90'), details: { email_kind: 'gift', cause: 'bounced' } }),
  ],
  resolved: [
    alert(38, 'order_stuck', '2026-10-25T18:30:00Z', { ...forOrder('B4E0F6A2'), resolved_at: '2026-10-25T16:30:00Z', resolution: 'auto' }),
    alert(36, 'site_down', '2026-10-26T04:10:00Z', { details: { target: 'site', since: '2026-10-26T04:10:00Z', error: 'HTTP 502' }, resolved_at: '2026-10-26T04:25:00Z', resolution: 'auto' }),
    alert(33, 'stripe_unmatched', '2026-10-21T15:02:00Z', {
      details: { type: 'checkout.session.completed', event_id: 'evt_1QyR8LJk2mN4pQ7r', livemode: true },
      resolved_at: '2026-10-22T10:15:00Z', resolution: 'Sessão criada à mão no painel da Stripe para testar o Pix', resolved_by: 'larissa@keytotwo.com.br',
    }),
  ],
}

// ---------------------------------------------------------------- catálogo (API)
const CATALOG_HISTORY: Partial<Record<Code, History[]>> = {
  P001: [
    { action: 'product_list_price', created_at: '2026-10-27T14:00:00Z', by: 'larissa@keytotwo.com.br', details: { reason: 'Preço de lançamento até o fim de novembro' } },
    { action: 'pack_add_game', created_at: '2026-10-24T18:30:00Z', by: ME_EMAIL, details: { reason: 'Retrospectiva a Dois entrou na coleção' } },
    { action: 'product_price', created_at: '2026-10-24T18:00:00Z', by: ME_EMAIL, details: { reason: 'Preço com os 5 jogos' } },
  ],
  J004: [{ action: 'product_price', created_at: '2026-10-20T11:00:00Z', by: ME_EMAIL, details: { reason: 'Escape room tem mais páginas que os outros' } }],
}
const PDF: Record<string, [string, number, string]> = {
  J001: ['1.2', 8_400_000, '2026-10-23T23:30:00Z'], J002: ['1.1', 14_900_000, '2026-10-22T20:10:00Z'], J003: ['1.0', 11_200_000, '2026-10-16T19:00:00Z'],
  J004: ['1.0', 15_300_000, '2026-10-19T21:45:00Z'], J005: ['1.1', 9_800_000, '2026-10-24T17:20:00Z'], F001: ['1.0', 3_100_000, '2026-10-12T12:00:00Z'], F002: ['1.0', 2_600_000, '2026-10-12T12:00:00Z'],
}
function catalog() {
  const owners = (code: Code) => new Set(ORDERS.filter(item => item.items.includes(code) && entitlements(item).some(entry => entry.status === 'active')).map(item => item.person.id)).size
  return {
    version: CATALOG_VERSION, livemode: true,
    products: (Object.keys(PRODUCTS) as Code[]).map(code => ({
      code, name: PRODUCTS[code].name, kind: PRODUCTS[code].kind, slug: PRODUCTS[code].slug, status: 'active', ready: true, sellable: true,
      stripe_price_id: `price_1Q${code}kT9aLm2`, games_expected: gamesOf(code).length,
      price: { unit_amount: PRODUCTS[code].price, currency: brl }, list_price: PRODUCTS[code].list ? { amount: PRODUCTS[code].list, label: 'Preço de lançamento' } : null,
      games: gamesOf(code).map((game, index) => ({ ...game, position: index + 1 })),
      paid_orders: ORDERS.filter(item => paidPurchase(item) && item.items.includes(code)).length, owners: owners(code), history: CATALOG_HISTORY[code] ?? [],
    })),
    games: Object.entries(GAME_NAMES).map(([code, name]) => ({
      code, name, access: code.startsWith('F') ? 'free' : 'paid', status: 'published',
      file: { version: PDF[code][0], filename: `${code}-v${PDF[code][0]}.pdf`, size_bytes: PDF[code][1], published_at: PDF[code][2] },
      single: code.startsWith('F') ? null : code, packs: PACK.includes(code as Code) ? ['P001'] : [],
    })),
  }
}

// ---------------------------------------------------------------- cupons e parceiros
const statsOf = (code: string) => {
  const used = ORDERS.filter(item => paidPurchase(item) && item.code === code)
  return { orders: used.length, revenue: used.reduce((sum, item) => sum + total(item), 0), discount: used.reduce((sum, item) => sum + item.discount, 0) }
}
let discountCount = 0
const discount = (code: string, over: Record<string, unknown> = {}) => ({
  id: uuid('d15c0de0', ++discountCount), code, percent_off: 10, product_codes: null, starts_at: null, ends_at: null, max_redemptions: null, first_time_only: false,
  minimum_amount: null, campaign: null, banner: null, partner: null, state: 'active', effective_state: 'active', created_at: '2026-10-01T12:00:00Z', stats: statsOf(code), ...over,
})
const DISCOUNTS = [
  discount('PRIMEIRA10', { first_time_only: true, banner: 'Primeira compra? Usem o cupom {cupom} no pagamento e ganhem 10% de desconto.', created_at: '2026-10-08T12:00:00Z' }),
  discount('LANCAMENTO50', { percent_off: 50, product_codes: ['P001'], max_redemptions: 20, starts_at: '2026-10-27T03:00:00Z', ends_at: '2026-11-16T02:59:59Z', campaign: 'Lançamento', created_at: '2026-10-26T20:00:00Z' }),
  discount('DUDA10', { partner: DUDA, created_at: '2026-08-20T12:00:00Z' }),
  discount('DADOS15', { percent_off: 15, partner: CASAL, minimum_amount: 1500, created_at: '2026-10-15T12:00:00Z' }),
  discount('AMIGOS20', { percent_off: 20, state: 'paused', effective_state: 'paused', campaign: 'Amigos e família', created_at: '2026-09-01T12:00:00Z',
    stats: { orders: 4, revenue: 7176, discount: 1794 } }),
  discount('NATAL26', { percent_off: 20, product_codes: ['P001'], starts_at: '2026-12-01T03:00:00Z', ends_at: '2026-12-26T02:59:59Z', state: 'scheduled', effective_state: 'scheduled',
    campaign: 'Natal 2026', banner: 'Natal a dois: 20% na Coleção com o cupom {cupom}.', created_at: '2026-10-30T16:00:00Z' }),
  discount('PREVENDA15', { percent_off: 15, ends_at: '2026-10-15T02:59:59Z', state: 'ended', effective_state: 'ended', campaign: 'Pré-venda', created_at: '2026-08-15T12:00:00Z',
    stats: { orders: 6, revenue: 9605, discount: 1695 } }),
]
type Partner = typeof DUDA & { handle: string; contact: string | null; commission_percent: number; status: 'active' | 'paused'; notes: string | null; created_at: string; visits_30d: number; codes: string[] }
const partnerOrders = (partner: Partner) => ORDERS.filter(item => paidPurchase(item) && item.origin?.partner?.id === partner.id)
const PARTNERS: Partner[] = [
  { ...DUDA, handle: '@duda.joga', contact: 'duda.ribeiro.contato@gmail.com', commission_percent: 10, status: 'active', notes: 'Cria conteúdo de jogos de tabuleiro; posta às quintas. Pix no CPF.', created_at: '2026-08-20T12:00:00Z', visits_30d: 184, codes: ['DUDA10'] },
  { ...CASAL, handle: '@casaldedados', contact: null, commission_percent: 12.5, status: 'active', notes: null, created_at: '2026-10-15T12:00:00Z', visits_30d: 63, codes: ['DADOS15'] },
]
const TOTAL_VISITS: Record<string, number> = { [DUDA.id]: 412, [CASAL.id]: 63 }
const partnerRow = (partner: Partner) => {
  const orders = partnerOrders(partner)
  return { ...partner, orders: orders.length, revenue: orders.reduce((sum, item) => sum + total(item), 0) }
}
function partnerDetail(partner: Partner) {
  const orders = partnerOrders(partner)
  const months = [...new Set(orders.map(item => `${item.paid_at!.slice(0, 7)}-01`))].sort().reverse().map(month => {
    const inMonth = orders.filter(item => item.paid_at!.startsWith(month.slice(0, 7)))
    const revenue = inMonth.reduce((sum, item) => sum + total(item), 0)
    const commission = Math.round(revenue * partner.commission_percent / 100)
    const closed = month < '2026-10-01'
    return { month, orders: inMonth.length, revenue, commission, closed, payout: month === '2026-08-01' ? { amount: commission, orders: inMonth.length, paid_at: '2026-09-05T15:00:00Z', note: 'Pix' } : null }
  })
  return {
    partner: { id: partner.id, slug: partner.slug, name: partner.name, handle: partner.handle, contact: partner.contact, commission_percent: partner.commission_percent, status: partner.status, notes: partner.notes, created_at: partner.created_at },
    months, visits: { last_30_days: partner.visits_30d, total: TOTAL_VISITS[partner.id] },
    discounts: DISCOUNTS.filter(item => (item.partner as { id: string } | null)?.id === partner.id),
    orders: orders.map(item => ({ id: item.id, ref: item.ref, paid_at: item.paid_at!, amount_total: total(item), promotion_code: item.code, source: item.origin?.source ?? 'link' })),
  }
}

// ---------------------------------------------------------------- métricas
const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 2 + i)).toISOString().slice(0, 10))
const ORDERS_PER_DAY = [0, 1, 0, 0, 2, 1, 0, 1, 0, 1, 2, 0, 1, 1, 0, 0, 2, 1, 0, 1, 3, 1, 0, 2, 1, 2, 1, 3, 2, 1]
const ACCOUNTS_PER_DAY = [1, 2, 0, 1, 3, 2, 1, 2, 0, 1, 4, 1, 2, 3, 1, 0, 3, 2, 1, 2, 5, 3, 1, 4, 2, 3, 2, 6, 4, 3]
const TICKETS = [2990, 990, 1290, 2691, 1980, 1495, 990, 2990, 1290]
// A abertura das vendas daqui a 9 dias (o aviso das Métricas e do Catálogo) e os mais vendidos do período.
const SALES_OPEN_AT = new Date(Date.now() + 9 * 86_400_000 - 3_600_000).toISOString()
const TOP_PRODUCTS = [
  { code: 'P001', name: 'Coleção KeyToTwo: Fundadores', kind: 'bundle', orders: 6, amount: 17_940 },
  { code: 'J001', name: 'Rabisque e Adivinhe', kind: 'single', orders: 3, amount: 2_970 },
  { code: 'J002', name: 'O Sumiço de Rapadura', kind: 'single', orders: 2, amount: 2_580 },
  { code: 'J005', name: 'Retrospectiva a Dois', kind: 'single', orders: 1, amount: 990 },
]

function metrics(days: number) {
  let ticket = 0
  const all = DAYS.map((date, i) => {
    const orders = ORDERS_PER_DAY[i]
    let revenue = 0
    for (let n = 0; n < orders; n++) revenue += TICKETS[ticket++ % TICKETS.length]
    return { date, orders, revenue, accounts: ACCOUNTS_PER_DAY[i] }
  })
  const daily = all.slice(-days)
  const sum = (key: 'orders' | 'revenue' | 'accounts') => daily.reduce((value, item) => value + item[key], 0)
  const paid = sum('orders')
  const long = days === 30
  return {
    days, since: daily[0].date, until: daily.at(-1)!.date, livemode: true,
    sales: { orders: paid, revenue: sum('revenue'), currency: brl }, accounts: sum('accounts'),
    funnel: { cart: Math.round(paid * 3.6), checkout: Math.round(paid * 1.7), paid }, downloads: { paid: paid * 2 + 3, free: sum('accounts') * 2 + 5 },
    free_unlocks: Math.round(sum('accounts') * 0.6), newsletter: { subscribed: 214 }, daily,
    marketing: long ? {
      codes: [{ code: 'PRIMEIRA10', orders: 6, revenue: 9873, discount: 1097 }, { code: 'LANCAMENTO50', orders: 3, revenue: 4485, discount: 4485 }, { code: 'DUDA10', orders: 2, revenue: 3582, discount: 398 }],
      partners: [{ name: 'Duda Ribeiro', slug: 'duda-ribeiro', orders: 4, revenue: 7254 }, { name: 'Casal de Dados', slug: 'casal-de-dados', orders: 1, revenue: 1980 }],
      campaigns: [{ source: 'instagram', campaign: 'lancamento', orders: 7, revenue: 13290 }, { source: 'tiktok', campaign: 'lancamento', orders: 3, revenue: 5980 }, { source: 'youtube', campaign: null, orders: 1, revenue: 1980 }],
    } : {
      codes: [{ code: 'LANCAMENTO50', orders: 3, revenue: 4485, discount: 4485 }, { code: 'PRIMEIRA10', orders: 1, revenue: 2691, discount: 299 }],
      partners: [{ name: 'Duda Ribeiro', slug: 'duda-ribeiro', orders: 1, revenue: 2691 }, { name: 'Casal de Dados', slug: 'casal-de-dados', orders: 1, revenue: 1980 }],
      campaigns: [{ source: 'instagram', campaign: 'lancamento', orders: 3, revenue: 6971 }, { source: 'tiktok', campaign: 'lancamento', orders: 2, revenue: 2990 }],
    },
    usage: {
      month_start: '2026-10-01', calls_month: 186_420,
      by_area: { public: 128_900, account: 31_240, admin: 4_870, webhooks: 2_310, schedule: 19_100 },
      daily: daily.map((item, i) => ({ date: item.date, calls: 4_200 + ((i * 2731 + item.orders * 900) % 5_600) })),
      peak_hour: { hour: '2026-10-31T00:00:00Z', calls: 912 }, database_bytes: 61_341_696, active_accounts_month: 143,
    },
  }
}

// ---------------------------------------------------------------- blog
type Post = { id: string; slug: string; title: string; description: string; author: string; author_instagram: string; date: string; cover: string | null; cover_alt: string
  tags: string[]; body: string; status: 'draft' | 'published'; published_at: string | null; created_at: string; updated_at: string; seo_title: string; seo_description: string }
const POST_BODY = `Sexta à noite, celular longe e uma mesa livre: é tudo o que vocês precisam. Separamos cinco jogos para imprimir em casa e jogar a dois, do mais rápido ao que pede a noite inteira.

## 1. Rabisque e Adivinhe

Um desenha, o outro adivinha, e o relógio corre. Rodadas de um minuto, placar da dupla e **nenhum talento para desenho** necessário.

![Folhas do Rabisque e Adivinhe espalhadas na mesa](/images/blog/2026/10/8b2e7f10-rabisque.webp)

## 2. Tabuleiro da Sorte

Perguntas, desafios e moedas. Cada um guarda um pedido secreto, e quem juntar mais moedas no fim faz o outro cumprir.

## 3. O Sumiço de Rapadura

Um escape room de papel para dois: recortar, dobrar e olhar contra a luz fazem parte da investigação.

> Dica: imprimam em papel de 90 g ou mais. As peças aguentam melhor as dobras.

## Para escolher

- **Pouco tempo:** Rabisque e Adivinhe, uns 20 minutos.
- **Noite inteira:** O Sumiço de Rapadura ou A Rota da Fornalha.
- **Para lembrar do ano:** Retrospectiva a Dois.

Todos estão na [Coleção KeyToTwo: Fundadores](/loja), com os cinco jogos num pedido só.`
const POSTS: Post[] = [
  { id: uuid('b106b106', 3), slug: 'bastidores-de-onde-veio-o-kito', title: 'Bastidores: de onde veio o Kito', description: '', author: 'Equipe KeyToTwo', author_instagram: '', date: '2026-10-30',
    cover: null, cover_alt: '', tags: ['Bastidores'], status: 'draft', published_at: null, created_at: '2026-10-30T21:40:00.000000+00:00', updated_at: '2026-10-30T22:15:00.000000+00:00',
    seo_title: '', seo_description: '',
    body: 'O Kito nasceu num guardanapo, num bar em Pinheiros.\n\n![Kito acenando](/images/blog/2026/10/e1a2b3c4-kito-acenando.webp)\n\n## Por que um bichinho\n\nRascunho: falar dos primeiros desenhos e da escolha das cores.' },
  { id: uuid('b106b106', 1), slug: 'jogos-para-casais-em-casa', title: '5 jogos para casais jogarem em casa numa sexta à noite',
    description: 'Do desenho de um minuto ao escape room de papel: cinco jogos para imprimir e jogar a dois, com o tempo que cada um pede.',
    author: 'Larissa Mendes', author_instagram: 'larissa.mendes', date: '2026-10-24', cover: '/images/blog/2026/10/3fa9c1d2-mesa-de-jogo.webp', cover_alt: 'Mesa com folhas de jogo impressas, lápis e duas canecas',
    tags: ['Jogos', 'Casal', 'Sexta à noite'], body: POST_BODY, status: 'published', published_at: '2026-10-24T15:00:00.000000+00:00',
    created_at: '2026-10-23T18:20:00.000000+00:00', updated_at: '2026-10-29T12:40:00.000000+00:00', seo_title: 'Jogos para casais em casa: 5 ideias para imprimir', seo_description: '' },
  { id: uuid('b106b106', 2), slug: 'como-imprimir-os-jogos-em-casa', title: 'Como imprimir os jogos em casa sem gastar muito',
    description: 'Papel, tinta e configuração da impressora: o que faz diferença e o que dá para pular.', author: 'Equipe KeyToTwo', author_instagram: '', date: '2026-10-21',
    cover: '/images/blog/2026/10/c47d0e21-impressora-e-papel.webp', cover_alt: 'Folhas de jogo saindo da impressora', tags: ['Impressão', 'Dicas'], status: 'published',
    published_at: '2026-10-21T13:00:00.000000+00:00', created_at: '2026-10-20T10:00:00.000000+00:00', updated_at: '2026-10-21T13:00:00.000000+00:00', seo_title: '', seo_description: '',
    body: 'Não precisa de gráfica.\n\n## Papel\n\nSulfite comum resolve; 90 g deixa as cartas mais firmes.\n\n## Tinta\n\nUse o modo rascunho nas páginas de regras e o normal nas cartas.' },
]
const POST = POSTS.find(item => item.status === 'published')!
const BUCKET: [string, string, number][] = [
  ['2026/10/3fa9c1d2-mesa-de-jogo.webp', '2026-10-24T13:10:00.000Z', 182_400],
  ['2026/10/8b2e7f10-rabisque.webp', '2026-10-24T13:12:00.000Z', 96_800],
  ['2026/10/c47d0e21-impressora-e-papel.webp', '2026-10-21T10:05:00.000Z', 143_900],
  ['2026/10/e1a2b3c4-kito-acenando.webp', '2026-10-19T18:40:00.000Z', 38_200],
  ['2026/10/5d6e7f80-tabuleiro-da-sorte.webp', '2026-10-17T09:22:00.000Z', 1_420_000],
  ['2026/09/9c8b7a65-fornalha-recortes.webp', '2026-09-30T16:00:00.000Z', 212_300],
]
const images = () => BUCKET.map(([key, uploaded_at, size]) => {
  const path = `/images/blog/${key}`
  return { path, url: `${MEDIA}/${key}`, size, uploaded_at, used_by: POSTS.filter(item => item.cover === path || item.body.includes(path)).map(item => ({ id: item.id, title: item.title, status: item.status })) }
})
// As imagens do bucket simulado são as fotos e capas do próprio site.
const IMAGE_FILES: [string, string][] = [
  ['mesa-de-jogo', 'public/media/hero/foto-mesma-folha-1008.webp'], ['rabisque', 'public/media/games/j001-capa-800.webp'],
  ['impressora', 'public/media/experience/gratuitos-paginas-780.webp'], ['kito', 'public/media/experience/kito-hi-256.webp'],
  ['tabuleiro', 'public/media/games/j003-capa-800.webp'], ['fornalha', 'public/media/games/j004-capa-800.webp'],
]
const withoutBody = (item: Post) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'body'))

// ---------------------------------------------------------------- rotas simuladas
type Problems = string[]
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body })
const notFound = (route: Route, message: string) => json(route, { error: { code: 'NOT_FOUND', message } }, 404)

function api(route: Route, url: URL, problems: Problems) {
  const method = route.request().method()
  const path = url.pathname.split('/functions/v1/api')[1]
  const params = url.searchParams
  if (method !== 'GET') return json(route, { ok: true })
  if (path === '/admin/alerts') return json(route, ALERTS)
  if (path === '/admin/metrics') return json(route, { ...metrics(Number(params.get('days') ?? 7)), top_products: TOP_PRODUCTS, previous: { orders: 8, revenue: 15_430, accounts: 19 } })
  if (path === '/catalog') return json(route, { products: [], banner: null, sales_open_at: SALES_OPEN_AT })
  if (path === '/admin/catalog') return json(route, catalog())
  if (path === '/admin/discounts') {
    return json(route, {
      discounts: DISCOUNTS, partners: PARTNERS.map(({ id, slug, name, status }) => ({ id, slug, name, status })),
      products: (Object.keys(PRODUCTS) as Code[]).map(code => ({ code, name: PRODUCTS[code].name, stripe_product: `prod_R${code}x2` })),
    })
  }
  if (path === '/admin/partners') return json(route, { partners: PARTNERS.map(partnerRow) })
  if (path === '/admin/follow-up') return json(route, FOLLOW_UP)
  if (path === '/admin/blog/posts') return json(route, { version: BLOG_VERSION, media_base: MEDIA, posts: [...POSTS].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(withoutBody) })
  if (path === '/admin/blog/images') return json(route, { images: images(), truncated: false, media_base: MEDIA })
  if (path === '/admin/orders' || path === '/admin/users') {
    const filter = params.get('filter') ?? 'all'
    const query = (params.get('q') ?? '').trim().toLowerCase().replace(/^#/, '')
    const page = Math.max(1, Number(params.get('page') ?? '1'))
    const rows = path === '/admin/orders'
      ? ORDERS.filter(item => orderFilter(item, filter) && (!query || item.ref.toLowerCase().includes(query) || item.person.email.includes(query))).map(summaryOf)
      : PEOPLE.filter(who => userFilter(who, filter) && (!query || who.email.includes(query))).map(userSummary)
    return json(route, { total: rows.length, offset: (page - 1) * 50, limit: 50, page, [path === '/admin/orders' ? 'orders' : 'users']: rows.slice((page - 1) * 50, page * 50) })
  }
  const [, , section, id] = path.split('/')
  if (section === 'orders') {
    const item = ORDERS.find(entry => entry.id === id)
    return item ? json(route, orderDetail(item)) : notFound(route, 'Pedido não encontrado.')
  }
  if (section === 'users') {
    const who = PEOPLE.find(entry => entry.id === id)
    return who ? json(route, userDetail(who)) : notFound(route, 'Conta não encontrada.')
  }
  if (section === 'partners') {
    const partner = PARTNERS.find(entry => entry.id === id)
    return partner ? json(route, partnerDetail(partner)) : notFound(route, 'Parceiro não encontrado.')
  }
  if (path.startsWith('/admin/blog/posts/')) {
    const post = POSTS.find(entry => entry.id === path.split('/')[4])
    return post ? json(route, { post, media_base: MEDIA }) : notFound(route, 'Post não encontrado.')
  }
  problems.push(`API sem simulação: ${method} ${path}${url.search}`)
  return notFound(route, 'Sem simulação.')
}

async function mock(page: Page, origin: string, auth: 'none' | 'aal1' | 'aal2', problems: Problems) {
  const who = { ...user(), email: ME_EMAIL, user_metadata: { full_name: 'Equipe KeyToTwo' } }
  if (auth !== 'none') await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session(auth, who)] as const)
  // Tudo o que não é o próprio admin (Supabase, site, bucket do blog) é simulado aqui; o resto é barrado e anotado.
  await page.route(url => url.origin !== origin, route => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/auth/v1/')) {
      const path = url.pathname.split('/auth/v1')[1]
      if (path === '/user') return json(route, who)
      if (path === '/logout') return route.fulfill({ status: 204, body: '' })
      problems.push(`Auth sem simulação: ${route.request().method()} ${path}`)
      return json(route, {}, 404)
    }
    if (url.pathname.includes('/functions/v1/api/')) return api(route, url, problems)
    if (url.pathname.endsWith('/blog/versao.json')) return json(route, { version: BLOG_VERSION })
    if (url.pathname.endsWith('/catalogo/versao.json')) return json(route, { version: CATALOG_VERSION })
    if (url.origin === 'https://keytotwo.com.br' && url.pathname.startsWith('/media/') && existsSync(`public${url.pathname}`)) {
      return route.fulfill({ contentType: 'image/webp', body: readFileSync(`public${url.pathname}`) })
    }
    if (url.origin === MEDIA) {
      const file = IMAGE_FILES.find(([word]) => url.pathname.includes(word))?.[1] ?? 'public/media/icons/kito-192.png'
      return route.fulfill({ contentType: file.endsWith('.png') ? 'image/png' : 'image/webp', body: readFileSync(file) })
    }
    problems.push(`Barrado (fora da simulação): ${url.href}`)
    return route.abort()
  })
}

// Espera a página assentar: nada carregando, fontes prontas e todas as imagens baixadas (as preguiçosas também).
async function settle(page: Page) {
  await expect(page.getByText(/^(Carregando|Abrindo|Atualizando)/)).toHaveCount(0)
  await page.evaluate(async () => {
    for (const image of Array.from(document.images)) if (image.loading === 'lazy') image.loading = 'eager'
    await document.fonts.ready
    await Promise.all(Array.from(document.images, image => (image.complete ? undefined
      : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }) }))))
  })
}

// ---------------------------------------------------------------- telas
type Step = (page: Page) => Promise<unknown>
interface Capture { name: string; path: string; auth?: 'none' | 'aal1'; ready: Step; act?: Step; fullPage?: boolean }
const heading = (name: string | RegExp) => (page: Page) => expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
const both = (...steps: Step[]): Step => async page => { for (const step of steps) await step(page) }
const siteSync = (page: Page) => expect(page.locator('.site-sync')).toBeVisible()
const MARIANA_PATH = `/usuarios/${MARIANA.id}`

const CAPTURES: Capture[] = [
  { name: 'entrar', path: '/', auth: 'none', ready: heading('Entrar no admin') },
  { name: 'mfa', path: '/', auth: 'aal1', ready: heading('Código do app autenticador') },
  { name: 'metricas', path: '/', ready: both(heading('Métricas'), page => expect(page.getByRole('region', { name: 'Uso da infraestrutura' })).toBeVisible()) },
  { name: 'metricas-30dias', path: '/', ready: both(heading('Métricas'), page => expect(page.getByRole('region', { name: 'Uso da infraestrutura' })).toBeVisible()),
    act: async page => {
      await page.getByRole('button', { name: '30 dias' }).click()
      await expect(page.getByRole('region', { name: 'Vendas' }).locator('.bars span')).toHaveCount(30)
    } },
  { name: 'atencao', path: '/atencao', ready: both(heading('Atenção'), page => expect(page.getByRole('region', { name: 'Abertos 3' })).toBeVisible()) },
  { name: 'pedidos', path: '/pedidos', ready: both(heading('Pedidos e reembolsos'), page => expect(page.getByRole('list', { name: 'Pedidos' }).getByRole('listitem')).toHaveCount(ORDERS.length)) },
  { name: 'pedidos-filtro-pagos', path: '/pedidos', ready: both(heading('Pedidos e reembolsos'), page => expect(page.getByRole('list', { name: 'Pedidos' }).getByRole('listitem')).toHaveCount(ORDERS.length)),
    act: async page => {
      await page.getByRole('group', { name: 'Mostrar' }).getByRole('button', { name: 'Pagos' }).click()
      await expect(page).toHaveURL(/filter=paid/)
      await expect(page.getByRole('list', { name: 'Pedidos' }).getByRole('listitem')).toHaveCount(ORDERS.filter(paidPurchase).length)
      await expect(page.getByRole('list', { name: 'Pedidos' })).toHaveAttribute('aria-busy', 'false')
    } },
  { name: 'pedido', path: `/pedidos/${PAID.id}`, ready: both(heading(`Pedido ${PAID.ref}`), page => expect(page.getByRole('region', { name: 'Valores' })).toBeVisible()) },
  { name: 'pedido-reembolso-aberto', path: `/pedidos/${PAID.id}`, ready: heading(`Pedido ${PAID.ref}`),
    act: async page => {
      await page.getByRole('button', { name: /^Reembolsar R\$/ }).click()
      await expect(page.getByRole('form', { name: /Reembolsar R\$/ })).toBeVisible()
    } },
  { name: 'pedido-reembolsado', path: `/pedidos/${REFUNDED.id}`, ready: both(heading(`Pedido ${REFUNDED.ref}`), page => expect(page.getByRole('region', { name: 'Valores' })).toBeVisible()) },
  { name: 'catalogo', path: '/catalogo', ready: both(heading('Catálogo'), siteSync, page => expect(page.getByRole('list', { name: 'Produtos' }).getByRole('listitem')).toHaveCount(6)) },
  { name: 'produto', path: '/catalogo/P001', ready: both(heading(PRODUCTS.P001.name), siteSync) },
  { name: 'produto-avulso', path: '/catalogo/J001', ready: both(heading(PRODUCTS.J001.name), siteSync) },
  { name: 'cupons', path: '/cupons', ready: both(heading('Cupons e parceiros'), page => expect(page.getByRole('list', { name: 'Cupons', exact: true })).toBeVisible()) },
  { name: 'cupons-novo-cupom', path: '/cupons', ready: both(heading('Cupons e parceiros'), page => expect(page.getByRole('list', { name: 'Cupons', exact: true })).toBeVisible()),
    act: async page => {
      await page.getByRole('button', { name: 'Novo cupom' }).click()
      await expect(page.getByRole('button', { name: 'Criar o cupom' })).toBeVisible()
    } },
  { name: 'parceiros', path: '/cupons/parceiros', ready: both(heading('Cupons e parceiros'), page => expect(page.getByRole('list', { name: 'Parceiros' })).toBeVisible()) },
  { name: 'parceiro', path: `/cupons/parceiros/${DUDA.id}`, ready: both(heading(DUDA.name), page => expect(page.getByRole('region', { name: 'Vendas e comissão por mês' })).toBeVisible()) },
  { name: 'usuarios', path: '/usuarios', ready: both(heading('Usuários'), page => expect(page.getByRole('list', { name: 'Contas' }).getByRole('listitem')).toHaveCount(PEOPLE.length)) },
  { name: 'usuario', path: MARIANA_PATH, ready: both(heading(MARIANA.email), page => expect(page.getByRole('region', { name: /Jogos/ })).toBeVisible()) },
  // A Mariana já tem todos os jogos (sem o botão de presente): o formulário abre na conta do Pedro.
  { name: 'usuario-presente-aberto', path: `/usuarios/${PEDRO.id}`, ready: heading(PEDRO.email),
    act: async page => {
      await page.getByRole('button', { name: 'Dar um jogo de presente' }).click()
      await expect(page.getByRole('form', { name: 'Dar um jogo de presente' })).toBeVisible()
    } },
  { name: 'acompanhamento', path: '/usuarios/acompanhamento', ready: both(heading('Usuários'), page => expect(page.getByRole('list', { name: 'Resumo' })).toBeVisible()) },
  { name: 'equipe', path: '/usuarios/equipe', ready: both(heading('Usuários'), page => expect(page.getByRole('list', { name: 'Admins' }).getByRole('listitem')).toHaveCount(2)) },
  { name: 'blog', path: '/blog', ready: both(heading('Blog'), siteSync, page => expect(page.getByRole('list', { name: 'Posts' }).getByRole('listitem')).toHaveCount(POSTS.length)) },
  { name: 'blog-editor', path: `/blog/${POST.id}`, ready: both(heading('Editar post'), page => expect(page.getByLabel('Título', { exact: true })).toHaveValue(POST.title)) },
  // O diálogo é fixo na tela: a captura é da janela, não da página inteira.
  { name: 'blog-editor-galeria', path: `/blog/${POST.id}`, fullPage: false, ready: both(heading('Editar post'), page => expect(page.getByLabel('Título', { exact: true })).toHaveValue(POST.title)),
    act: async page => {
      await page.getByRole('toolbar', { name: 'Formatação' }).getByRole('button', { name: 'Galeria' }).click()
      const gallery = page.getByRole('dialog', { name: 'Galeria de imagens' })
      await expect(gallery.getByRole('status')).toHaveText(`${BUCKET.length} imagens`)
    } },
  { name: 'blog-novo', path: '/blog/novo', ready: heading('Novo post') },
  { name: 'naoencontrado', path: '/rota-que-nao-existe', ready: heading('Página não encontrada') },
]

test.beforeAll(() => { if (process.env.ADMIN_CAPTURE === '1') mkdirSync(OUT, { recursive: true }) })

for (const capture of CAPTURES) {
  for (const [width, height] of SIZES) {
    test(`${capture.name}-${width}`, async ({ page, baseURL }) => {
      test.skip(process.env.ADMIN_CAPTURE !== '1', 'Só com ADMIN_CAPTURE=1 (captura de telas para a revisão de UX)')
      const problems: Problems = []
      page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`) })
      page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
      await page.setViewportSize({ width, height })
      await mock(page, new URL(baseURL!).origin, capture.auth ?? 'aal2', problems)
      await page.goto(capture.path)
      await capture.ready(page)
      if (capture.act) await capture.act(page)
      await settle(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (overflow > 0) problems.push(`rolagem lateral de ${overflow}px`)
      await page.screenshot({ path: `${OUT}/${capture.name}-${width}.png`, fullPage: capture.fullPage ?? true, animations: 'disabled' })
      for (const problem of problems) console.log(`[${capture.name}-${width}] ${problem}`)
    })
  }
}

// ===== As melhorias da revisão de UX (rodam sempre) =====
async function open(page: Page, baseURL: string | undefined, path: string, width = 1440) {
  const problems: Problems = []
  await page.setViewportSize({ width, height: 900 })
  await mock(page, new URL(baseURL!).origin, 'aal2', problems)
  await page.goto(path)
  return problems
}

test('revisão de UX: a busca rápida leva o e-mail a Usuários e o código a Pedidos', async ({ page, baseURL }) => {
  await open(page, baseURL, '/')
  const search = page.getByRole('searchbox', { name: 'Busca rápida: pedido ou e-mail' })
  await search.fill(MARIANA.email)
  await search.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/usuarios\\?q=${encodeURIComponent(MARIANA.email)}$`))
  await expect(page.getByRole('searchbox', { name: 'Buscar pelo e-mail' })).toHaveValue(MARIANA.email)
  await expect(page.getByRole('list', { name: 'Contas' }).getByRole('listitem')).toHaveCount(1)
  await search.fill(PAID.ref)
  await search.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/pedidos\\?q=${PAID.ref}$`))
  await expect(page.getByRole('list', { name: 'Pedidos' }).getByRole('listitem')).toHaveCount(1)
})

test('revisão de UX: Métricas com a abertura das vendas, os alertas em destaque, a variação, os mais vendidos e o uso recolhido', async ({ page, baseURL }) => {
  await open(page, baseURL, '/')
  await expect(page.getByText(/^As vendas abrem em/)).toBeVisible()
  const callout = page.getByRole('region', { name: `${ALERTS.open.length} alertas precisam de atenção` })
  await expect(callout.getByRole('listitem').first()).toContainText('Contestação no pedido 0D4E9B71')
  await expect(page.getByRole('region', { name: 'Vendas' }).locator('.card-delta').first()).toHaveText(/sobre os 7 dias antes$/)
  await expect(page.getByRole('region', { name: 'Mais vendidos' }).getByRole('link')).toHaveText(TOP_PRODUCTS.map(item => item.name))
  await expect(page.getByRole('region', { name: 'Últimos pedidos pagos' }).getByRole('listitem')).toHaveCount(5)
  const usage = page.getByRole('region', { name: 'Uso da infraestrutura' })
  await expect(usage.locator('summary')).toHaveText(/^Tudo bem: o maior uso é \d+% do limite/)
  await expect(usage.getByRole('table')).toBeHidden()
})

test('revisão de UX: pedidos com Hoje/Ontem e Baixar CSV; a ficha copia o código e põe o reembolso na Zona de perigo', async ({ page, baseURL }) => {
  await open(page, baseURL, '/pedidos')
  const list = page.getByRole('list', { name: 'Pedidos' })
  await expect(list.getByRole('listitem').first()).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^pedidos-all-\d{4}-\d{2}-\d{2}\.csv$/)
  const csv = readFileSync(await file.path(), 'utf8')
  expect(csv.split('\r\n')[0]).toBe('\uFEFFPedido;Data;E-mail;Situação;Itens;Cupom;Valor (R$)')
  expect(csv).toContain(`${PAID.ref};`)
  expect(csv.trim().split('\r\n')).toHaveLength(ORDERS.length + 1)

  await page.goto(`/pedidos/${PAID.id}`)
  await expect(page.getByRole('button', { name: `Copiar o código do pedido ${PAID.ref}` })).toBeVisible()
  const danger = page.getByRole('region', { name: 'Zona de perigo' })
  await expect(danger.getByRole('button', { name: /^Reembolsar R\$/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ações' }).getByRole('button', { name: /^Reembolsar/ })).toHaveCount(0)
})

test('revisão de UX: Atenção mostra o prazo da contestação; cupons com os usos e o copiar; catálogo com as capas', async ({ page, baseURL }) => {
  await open(page, baseURL, '/atencao')
  const first = page.getByRole('region', { name: /^Abertos/ }).getByRole('listitem').first()
  await expect(first).toContainText('Contestação no pedido 0D4E9B71')
  await expect(first.locator('.badge').first()).toHaveText(/^Prazo/)

  await page.goto('/cupons')
  const row = page.getByRole('list', { name: 'Cupons', exact: true }).getByRole('listitem').filter({ hasText: 'LANCAMENTO50' })
  await expect(row.locator('.uses-meter')).toContainText(/\d+ de 20 usos/)
  await expect(row.getByRole('button', { name: 'Copiar o cupom LANCAMENTO50' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo cupom' })).toHaveClass(/button-primary/)

  await page.goto('/catalogo')
  const thumbs = page.getByRole('list', { name: 'Produtos' }).locator('img.catalog-thumb')
  await expect(thumbs.first()).toHaveAttribute('src', /^https:\/\/keytotwo\.com\.br\/media\/games\/p001-capa-640\.webp$/)
  await expect(page.getByText(/^As vendas abrem em/)).toBeVisible()
})

test('revisão de UX: a conta tem o resumo no topo e a Zona de perigo; o acompanhamento escreve para a pessoa', async ({ page, baseURL }) => {
  await open(page, baseURL, `/usuarios/${MARIANA.id}`)
  await expect(page.locator('.summary-cards dt')).toHaveText(['Compras', 'Gastou', 'Jogos', 'Novidades'])
  await expect(page.getByRole('region', { name: 'Zona de perigo' }).getByRole('button', { name: 'Excluir a conta' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Conta' }).getByRole('button', { name: /Exportar os dados/ })).toBeVisible()

  await page.goto('/usuarios/acompanhamento')
  const write = page.getByRole('link', { name: /^Escrever para a pessoa/ }).first()
  await expect(write).toHaveAttribute('href', /^mailto:.+\?subject=Sua%20sacola%20na%20KeyToTwo&body=/)
})

test('revisão de UX: no celular, o menu Seções abre as seções e fecha ao trocar de página', async ({ page, baseURL }) => {
  await open(page, baseURL, '/', 390)
  const nav = page.getByRole('navigation', { name: 'Seções do admin' })
  await expect(nav).toBeHidden()
  const toggle = page.getByRole('button', { name: /^Seções/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(nav.getByRole('link')).toHaveCount(7)
  await nav.getByRole('link', { name: 'Pedidos e reembolsos' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Pedidos e reembolsos' })).toBeVisible()
  await expect(nav).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

