// I3 contra as RPCs reais (migrações do I3 aplicadas no banco local). Ver integration-helpers.ts.
// A Stripe é simulada neste processo (stripe-fake.ts); o banco é o local.
// Com KT_STRIPE=1, o último teste usa a API de TESTE real da Stripe (chaves de supabase/functions/.env).
import { assert, assertEquals } from '@std/assert'
import { enabled, removeTestUsers } from './integration-helpers.ts'
import { buyer as newBuyer, call, deliver, type FakeSession, pay, sessionObject, startCheckout, stripe, TERMS, UNIT } from './stripe-fake.ts'

const buyer = async (name: string) => (await newBuyer(`i3-${name}`)).token

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
