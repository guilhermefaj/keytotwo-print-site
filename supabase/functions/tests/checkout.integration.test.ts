// I3 contra as RPCs reais (migrações do I3 aplicadas no banco local). Ver integration-helpers.ts.
// A Stripe é simulada neste processo (objetos no formato da API 2026-03-25.dahlia); o banco é o local.
// Com KT_STRIPE=1, o último teste usa a API de TESTE real da Stripe (chaves de supabase/functions/.env).
import { assert, assertEquals } from '@std/assert'
import { createUser, enabled, passwordSession, removeTestUsers, testEmail } from './integration-helpers.ts'

const WEBHOOK_SECRET = 'segredo-webhook-integracao'
const TERMS = 'termos-integracao-1'
if (enabled) {
  Deno.env.set('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
  Deno.env.set('TERMS_VERSION', TERMS)
  Deno.env.set('SITE_URL', 'http://127.0.0.1:5176')
  if (Deno.env.get('KT_STRIPE') !== '1') Deno.env.set('STRIPE_SECRET_KEY', 'stripe-simulada')
}

const { handleRequest } = await import('../api/router.ts')
const { handleStripeWebhook } = await import('../stripe-webhook/handler.ts')
const { cryptoProvider, stripe } = await import('../_shared/stripe.ts')

// ---- Stripe simulada: guarda as sessões criadas pela api e responde às leituras do código ----
interface FakeSession {
  id: string
  orderId: string
  priceIds: string[]
  customer: string
  state: { status: string; payment_status: string; discount: number; code: string | null }
}
const sessions = new Map<string, FakeSession>()
const intents = new Map<string, string>()
const UNIT = 1990
const realFetch = globalThis.fetch

function sessionObject(s: FakeSession) {
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

if (enabled && Deno.env.get('KT_STRIPE') !== '1') {
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

// ---- utilitários ----
async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const headers = new Headers({ Authorization: `Bearer ${token}` })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await handleRequest(new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

async function deliver(type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID().replaceAll('-', '')}`) {
  const payload = JSON.stringify({ id, object: 'event', type, api_version: '2026-03-25.dahlia', created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: { id: null }, data: { object } })
  const signature = await stripe().webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET, cryptoProvider })
  const res = await handleStripeWebhook(new Request('http://localhost/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload }))
  return { status: res.status, body: await res.json(), id }
}

async function buyer(name: string) {
  const email = testEmail(`i3-${name}`)
  const password = `Senha${crypto.randomUUID().slice(0, 8)}1`
  await createUser(email, { password })
  return await passwordSession(email, password)
}

// Carrinho com o P001 e checkout: devolve a sessão simulada criada pela api.
async function startCheckout(token: string): Promise<FakeSession> {
  const cart = await call('/cart/items', token, 'POST', { product_code: 'P001' })
  assertEquals(cart.status, 200)
  const res = await call('/checkout', token, 'POST', { cart_version: cart.body.version, terms_accepted: true, terms_version: TERMS })
  assertEquals(res.status, 200, JSON.stringify(res.body))
  const s = [...sessions.values()].find((x) => res.body.client_secret === `${x.id}_segredo`)
  assert(s, 'sessão não criada')
  return s
}

const pay = (s: FakeSession, discount = 0, code: string | null = null) => {
  s.state = { status: 'complete', payment_status: 'paid', discount, code }
}

const libraryGames = async (token: string) => (await call('/library', token)).body.games.length

Deno.test({
  name: 'I3 integração: checkout, pagamento com cupom, reenvio, concorrência, recusa, expiração e contestações',
  ignore: !enabled || Deno.env.get('KT_STRIPE') === '1',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    try {
      const tokenA = await buyer('a')
      let sessionA: FakeSession

      await t.step('checkout cria pedido open e devolve client_secret', async () => {
        sessionA = await startCheckout(tokenA)
        const status = await call(`/order-status?session_id=${sessionA.id}`, tokenA)
        assertEquals(status.body.state, 'failed')
      })

      await t.step('pagamento com cupom: pedido paid, direitos, desconto gravado e carrinho limpo', async () => {
        pay(sessionA, 199, 'TESTE10')
        const res = await deliver('checkout.session.completed', sessionObject(sessionA))
        assertEquals([res.status, res.body.outcome], [200, 'applied'])
        assert((await libraryGames(tokenA)) > 0, 'biblioteca vazia após pagamento')
        const account = await call('/account', tokenA)
        const order = account.body.orders[0]
        assertEquals([order.status, order.amount_subtotal, order.amount_discount, order.amount_total, order.promotion_code], ['paid', UNIT, 199, UNIT - 199, 'TESTE10'])
        assertEquals((await call('/cart', tokenA)).body.items.length, 0)
        assertEquals((await call(`/order-status?session_id=${sessionA.id}`, tokenA)).body, { state: 'paid', next: 'open_library', items: [{ code: 'P001', name: order.items[0].name }] })
      })

      await t.step('reenvio do mesmo evento é idempotente', async () => {
        const event = await deliver('checkout.session.completed', sessionObject(sessionA), `evt_repetido_${crypto.randomUUID().slice(0, 8)}`)
        const again = await deliver('checkout.session.completed', sessionObject(sessionA), event.id)
        assertEquals([event.body.outcome, again.body.outcome], ['noop', 'duplicate_event'])
        assertEquals((await call('/account', tokenA)).body.orders.length, 1)
      })

      await t.step('webhook e order-status concorrentes liberam uma vez só', async () => {
        const tokenB = await buyer('b')
        const sessionB = await startCheckout(tokenB)
        pay(sessionB)
        const results = await Promise.all([
          ...Array.from({ length: 4 }, () => deliver('checkout.session.completed', sessionObject(sessionB))),
          call(`/order-status?session_id=${sessionB.id}`, tokenB),
        ])
        const outcomes = results.slice(0, 4).map((r) => (r as { body: { outcome: string } }).body.outcome)
        assert(outcomes.filter((o) => o === 'applied').length <= 1, `mais de uma liberação: ${outcomes}`)
        assertEquals(results.every((r) => r.status === 200), true)
        const account = await call('/account', tokenB)
        assertEquals([account.body.orders.length, account.body.orders[0].status], [1, 'paid'])
      })

      await t.step('pagamento assíncrono recusado e checkout expirado não liberam nada', async () => {
        const tokenC = await buyer('c')
        const sessionC = await startCheckout(tokenC)
        sessionC.state = { status: 'complete', payment_status: 'unpaid', discount: 0, code: null }
        assertEquals((await deliver('checkout.session.completed', sessionObject(sessionC))).body.outcome, 'applied')
        assertEquals((await call(`/order-status?session_id=${sessionC.id}`, tokenC)).body.state, 'pending_payment')
        assertEquals((await deliver('checkout.session.async_payment_failed', sessionObject(sessionC))).body.outcome, 'applied')
        assertEquals((await call(`/order-status?session_id=${sessionC.id}`, tokenC)).body.state, 'failed')
        assertEquals(await libraryGames(tokenC), 0)

        const tokenD = await buyer('d')
        const sessionD = await startCheckout(tokenD)
        sessionD.state = { status: 'expired', payment_status: 'unpaid', discount: 0, code: null }
        assertEquals((await deliver('checkout.session.expired', sessionObject(sessionD))).body.outcome, 'applied')
        assertEquals((await call(`/order-status?session_id=${sessionD.id}`, tokenD)).body.state, 'expired')
        assertEquals((await call('/account', tokenD)).body.orders.length, 0)
        assertEquals((await call('/cart', tokenD)).body.items.length, 1)
      })

      await t.step('contestação aberta revoga, vencida devolve e perdida mantém revogado', async () => {
        const dispute = (status: string) => ({ id: `dp_${crypto.randomUUID().slice(0, 8)}`, object: 'dispute', payment_intent: `pi_${sessionA.id.slice(8)}`, reason: 'fraudulent', status })
        assertEquals((await deliver('charge.dispute.created', dispute('needs_response'))).body.outcome, 'applied')
        assertEquals(await libraryGames(tokenA), 0)
        assertEquals((await deliver('charge.dispute.closed', dispute('won'))).body.outcome, 'applied')
        assert((await libraryGames(tokenA)) > 0, 'contestação vencida não devolveu o acesso')
        assertEquals((await deliver('charge.dispute.created', dispute('needs_response'))).body.outcome, 'applied')
        assertEquals((await deliver('charge.dispute.closed', dispute('lost'))).body.outcome, 'applied')
        assertEquals(await libraryGames(tokenA), 0)
        assertEquals((await call('/account', tokenA)).body.orders[0].status, 'dispute_lost')
      })
    } finally {
      const cleanup = await removeTestUsers()
      console.log(`usuários de teste removidos: ${cleanup.removed}; mantidos pelo banco: ${cleanup.kept}`)
    }
  },
})

Deno.test({
  name: 'I3 Stripe de teste real: /checkout cria a sessão do formulário; expirada, o evento real expira o pedido',
  ignore: !enabled || Deno.env.get('KT_STRIPE') !== '1',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    try {
      const token = await buyer('stripe-real')
      const cart = await call('/cart/items', token, 'POST', { product_code: 'P001' })
      const res = await call('/checkout', token, 'POST', { cart_version: cart.body.version, terms_accepted: true, terms_version: TERMS })
      assertEquals(res.status, 200, JSON.stringify(res.body))
      assert(typeof res.body.client_secret === 'string')
      const sessionId = String(res.body.client_secret).split('_secret_')[0]
      const real = await stripe().checkout.sessions.retrieve(sessionId)
      assertEquals([real.ui_mode, real.status, real.locale, real.allow_promotion_codes], ['form', 'open', 'pt-BR', true])
      await stripe().checkout.sessions.expire(sessionId)
      const events = await stripe().events.list({ type: 'checkout.session.expired', limit: 10 })
      const event = events.data.find((e) => (e.data.object as { id: string }).id === sessionId)
      assert(event, 'evento checkout.session.expired não encontrado na API de teste')
      const delivered = await deliver(event.type, event.data.object as unknown as Record<string, unknown>, event.id)
      assertEquals([delivered.status, delivered.body.outcome], [200, 'applied'])
      assertEquals((await call(`/order-status?session_id=${sessionId}`, token)).body.state, 'expired')
      const customer = typeof real.customer === 'string' ? real.customer : real.customer?.id
      if (customer) await stripe().customers.del(customer)
    } finally {
      const cleanup = await removeTestUsers()
      console.log(`usuários de teste removidos: ${cleanup.removed}; mantidos pelo banco: ${cleanup.kept}`)
    }
  },
})
