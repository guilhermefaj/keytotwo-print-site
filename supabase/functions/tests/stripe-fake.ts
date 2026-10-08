// Stripe simulada para os testes de integração (objetos no formato da API 2026-03-25.dahlia).
// Guarda as sessões criadas pela api e responde às leituras do código; o banco é o local.
// Com KT_STRIPE=1 a simulação fica desligada e as chamadas vão para a API de TESTE real.
import { assert, assertEquals } from '@std/assert'
import { createUser, enabled, passwordSession, testEmail } from './integration-helpers.ts'

export const WEBHOOK_SECRET = 'segredo-webhook-integracao'
export const TERMS = 'termos-integracao-1'
export const UNIT = 1990
const simulated = enabled && Deno.env.get('KT_STRIPE') !== '1'
if (enabled) {
  Deno.env.set('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
  Deno.env.set('TERMS_VERSION', TERMS)
  Deno.env.set('SITE_URL', 'http://127.0.0.1:5176')
  if (simulated) Deno.env.set('STRIPE_SECRET_KEY', 'stripe-simulada')
}

const { handleRequest } = await import('../api/router.ts')
const { handleStripeWebhook } = await import('../stripe-webhook/handler.ts')
const { cryptoProvider, stripe } = await import('../_shared/stripe.ts')
export { stripe }

export interface FakeSession {
  id: string
  orderId: string
  priceIds: string[]
  customer: string
  state: { status: string; payment_status: string; discount: number; code: string | null }
}
const sessions = new Map<string, FakeSession>()
const intents = new Map<string, string>()
const realFetch = globalThis.fetch

export function sessionObject(s: FakeSession) {
  const subtotal = UNIT * s.priceIds.length
  return {
    id: s.id, object: 'checkout.session', client_reference_id: s.orderId, status: s.state.status, payment_status: s.state.payment_status,
    amount_subtotal: subtotal, amount_total: subtotal - s.state.discount, currency: 'brl',
    total_details: { amount_discount: s.state.discount, amount_shipping: 0, amount_tax: 0 },
    discounts: s.state.code ? [{ coupon: 'cupom_teste', promotion_code: { id: 'promo_teste', object: 'promotion_code', code: s.state.code } }] : [],
    payment_intent: `pi_${s.id.slice(8)}`, customer: s.customer, livemode: false, client_secret: `${s.id}_segredo`,
    expires_at: Math.floor(Date.now() / 1000) + 86400, ui_mode: 'form',
  }
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

if (simulated) {
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.origin !== 'https://api.stripe.com') return realFetch(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    const form = new URLSearchParams(String(init?.body ?? ''))
    const path = url.pathname
    if (method === 'POST' && path === '/v1/customers') return Promise.resolve(reply({ id: `cus_${crypto.randomUUID().slice(0, 8)}`, object: 'customer' }))
    if (method === 'POST' && path.startsWith('/v1/customers/')) return Promise.resolve(reply({ id: path.split('/').pop(), object: 'customer' }))
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const idem = new Headers(init?.headers).get('Idempotency-Key') ?? ''
      const existing = [...sessions.values()].find((s) => `checkout:${s.orderId}` === idem)
      const s = existing ?? {
        id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}`,
        orderId: form.get('client_reference_id')!,
        priceIds: [...form.entries()].filter(([k]) => /^line_items\[\d+\]\[price\]$/.test(k)).map(([, v]) => v),
        customer: form.get('customer')!,
        state: { status: 'open', payment_status: 'unpaid', discount: 0, code: null },
      }
      sessions.set(s.id, s)
      intents.set(`pi_${s.id.slice(8)}`, s.orderId)
      return Promise.resolve(reply(sessionObject(s)))
    }
    const lineItems = /^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/.exec(path)
    if (lineItems && sessions.has(lineItems[1])) {
      const s = sessions.get(lineItems[1])!
      return Promise.resolve(reply({
        object: 'list', has_more: false, url: path,
        data: s.priceIds.map((price, i) => ({ id: `li_${i}`, object: 'item', price: { id: price, object: 'price', unit_amount: UNIT }, quantity: 1, currency: 'brl' })),
      }))
    }
    const one = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path)
    if (one && sessions.has(one[1])) return Promise.resolve(reply(sessionObject(sessions.get(one[1])!)))
    const intent = /^\/v1\/payment_intents\/([^/]+)$/.exec(path)
    if (intent && intents.has(intent[1])) return Promise.resolve(reply({ id: intent[1], object: 'payment_intent', metadata: { order_id: intents.get(intent[1]) } }))
    return Promise.resolve(reply({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404))
  }
}

export async function call(path: string, token: string | null, method = 'GET', body?: unknown) {
  const headers = new Headers(token ? { Authorization: `Bearer ${token}` } : {})
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await handleRequest(new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

export async function deliver(type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID().replaceAll('-', '')}`) {
  const payload = JSON.stringify({ id, object: 'event', type, api_version: '2026-03-25.dahlia', created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: { id: null }, data: { object } })
  const signature = await stripe().webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET, cryptoProvider })
  const res = await handleStripeWebhook(new Request('http://localhost/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload }))
  return { status: res.status, body: await res.json(), id }
}

export async function buyer(name: string): Promise<{ email: string; token: string }> {
  const email = testEmail(name)
  const password = `Senha${crypto.randomUUID().slice(0, 8)}1`
  await createUser(email, { password })
  return { email, token: await passwordSession(email, password) }
}

// Carrinho com o P001 e checkout: devolve a sessão simulada criada pela api.
export async function startCheckout(token: string): Promise<FakeSession> {
  const cart = await call('/cart/items', token, 'POST', { product_code: 'P001' })
  assertEquals(cart.status, 200)
  const res = await call('/checkout', token, 'POST', { cart_version: cart.body.version, terms_accepted: true, terms_version: TERMS })
  assertEquals(res.status, 200, JSON.stringify(res.body))
  const s = [...sessions.values()].find((x) => res.body.client_secret === `${x.id}_segredo`)
  assert(s, 'sessão não criada')
  return s
}

export const pay = (s: FakeSession, discount = 0, code: string | null = null) => {
  s.state = { status: 'complete', payment_status: 'paid', discount, code }
}
