// Testes de contrato do I3 (checkout, order-status e stripe-webhook), sem rede: RPCs e API da Stripe simuladas.
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assertEquals } from '@std/assert'
import { captureErrors, onRpc, onStripe, request, rpcCalls, sessionToken, type StripeCall, stripeCalls, TERMS_VERSION, userId, WEBHOOK_SECRET, contractTest } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { handleStripeWebhook } from '../stripe-webhook/handler.ts'
import { cryptoProvider, stripe } from '../_shared/stripe.ts'

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = 'cs_test_sessao1'
const PRICE = 'price_teste_p001'
const CLIENT_SECRET = 'segredo-do-cliente-de-teste'
const ok = (body: unknown) => ({ status: 200, body })
const row = (body: Record<string, unknown>) => ok([body])

function session(over: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID, object: 'checkout.session', client_reference_id: ORDER_ID, status: 'complete', payment_status: 'paid',
    amount_subtotal: 1990, amount_total: 1791, currency: 'brl', total_details: { amount_discount: 199, amount_shipping: 0, amount_tax: 0 },
    discounts: [{ coupon: 'cupom_teste', promotion_code: { id: 'promo_teste', object: 'promotion_code', code: 'TESTE10' } }],
    payment_intent: 'pi_teste', customer: 'cus_teste', livemode: false, client_secret: CLIENT_SECRET, expires_at: 1791000000, ui_mode: 'form', ...over,
  }
}

const LINE_ITEMS = {
  object: 'list', has_more: false, url: `/v1/checkout/sessions/${SESSION_ID}/line_items`,
  data: [{ id: 'li_1', object: 'item', price: { id: PRICE, object: 'price', unit_amount: 1990 }, quantity: 1, currency: 'brl', amount_subtotal: 1990, amount_total: 1791 }],
}

const FULFILL_ARGS = {
  p_order_id: ORDER_ID, p_checkout_session_id: SESSION_ID, p_payment_status: 'paid',
  p_amount_subtotal: 1990, p_amount_discount: 199, p_amount_total: 1791, p_currency: 'brl', p_promotion_code: 'TESTE10',
  p_payment_intent_id: 'pi_teste', p_customer_id: 'cus_teste', p_livemode: false,
  p_items: [{ stripe_price_id: PRICE, quantity: 1, unit_amount: 1990, currency: 'brl' }],
}

// Stripe com a sessão (e seus itens) e, opcionalmente, o PaymentIntent e a lista de sessões por intent.
function stripeWith(sessionBody: Record<string, unknown> | null, extra: (call: StripeCall) => { status: number; body: unknown } | null = () => null) {
  onStripe((call) => {
    const answer = extra(call)
    if (answer) return answer
    if (call.method === 'GET' && call.path === `/v1/checkout/sessions/${SESSION_ID}`) {
      return sessionBody ? ok(sessionBody) : { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing' } } }
    }
    if (call.path === `/v1/checkout/sessions/${SESSION_ID}/line_items`) return ok(LINE_ITEMS)
    return { status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing' } } }
  })
}

function stripeEvent(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${crypto.randomUUID().replaceAll('-', '')}`, object: 'event', type, api_version: '2026-03-25.dahlia',
    created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, data: { object },
  }
}

async function webhook(event: Record<string, unknown>, signed = true) {
  const payload = JSON.stringify(event)
  const signature = signed
    ? await stripe().webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET, cryptoProvider })
    : `t=${Math.floor(Date.now() / 1000)},v1=assinatura-falsa`
  const res = await handleStripeWebhook(new Request('http://localhost/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload }))
  return { status: res.status, body: await res.json() }
}

const checkoutBody = { cart_version: 3, terms_accepted: true, terms_version: TERMS_VERSION }

// ---------- POST /checkout ----------

contractTest('checkout: valida sessão, termos e versão do carrinho antes do banco', async () => {
  onRpc(() => ok(null))
  onStripe(() => ok({}))
  assertEquals((await handleRequest(request('/checkout', { method: 'POST', body: checkoutBody }))).status, 401)
  const token = await sessionToken()
  const cases: [Record<string, unknown>, number, string][] = [
    [{ ...checkoutBody, terms_accepted: false }, 400, 'TERMS_NOT_ACCEPTED'],
    [{ ...checkoutBody, terms_accepted: 'sim' }, 400, 'TERMS_NOT_ACCEPTED'],
    [{ ...checkoutBody, terms_version: 'termos-antigos' }, 409, 'TERMS_CHANGED'],
    [{ ...checkoutBody, cart_version: -1 }, 400, 'INVALID_REQUEST'],
    [{ ...checkoutBody, cart_version: '3' }, 400, 'INVALID_REQUEST'],
  ]
  for (const [body, status, code] of cases) {
    const res = await handleRequest(request('/checkout', { method: 'POST', token, body }))
    const json = await res.json()
    assertEquals([res.status, json.error.code], [status, code], JSON.stringify(body))
    if (code === 'TERMS_CHANGED') assertEquals(json.error.details, { terms_version: TERMS_VERSION })
  }
  assertEquals([rpcCalls.length, stripeCalls.length], [0, 0])
})

contractTest('checkout: recusas do carrinho viram 409 com details, sem chamar a Stripe', async () => {
  const token = await sessionToken()
  onStripe(() => ok({}))
  for (const [outcome, code, detail] of [
    ['cart_empty', 'CART_EMPTY', null],
    ['cart_changed', 'CART_CHANGED', { cart_version: 4 }],
    ['product_unavailable', 'PRODUCT_UNAVAILABLE', { product_codes: ['P001'] }],
    ['already_owned', 'ALREADY_OWNED', { product_codes: ['P001'] }],
  ] as const) {
    onRpc(() => row({ outcome, order_id: null, email: null, stripe_customer_id: null, items: null, reused: null, detail }))
    const res = await handleRequest(request('/checkout', { method: 'POST', token, body: checkoutBody }))
    const json = await res.json()
    assertEquals([res.status, json.error.code, json.error.details], [409, code, detail ?? undefined])
  }
  assertEquals(stripeCalls.length, 0)
})

contractTest('checkout: cria Customer, sessão do formulário embutido com os parâmetros do Studio e devolve client_secret', async () => {
  const token = await sessionToken()
  const uid = userId(token)
  onRpc((fn) => {
    if (fn === 'create_order_from_cart') {
      return row({ outcome: 'ok', order_id: ORDER_ID, email: 'teste@example.com', stripe_customer_id: null, items: [{ product_code: 'P001', stripe_price_id: PRICE }], reused: false, detail: null })
    }
    if (fn === 'set_stripe_customer') return ok('cus_novo')
    return ok('applied')
  })
  onStripe((call) => {
    if (call.method === 'POST' && call.path === '/v1/customers') return ok({ id: 'cus_novo', object: 'customer' })
    if (call.method === 'POST' && call.path === '/v1/checkout/sessions') return ok(session({ status: 'open', payment_status: 'unpaid', customer: 'cus_novo' }))
    return { status: 500, body: {} }
  })

  const res = await handleRequest(request('/checkout', { method: 'POST', token, body: checkoutBody }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { client_secret: CLIENT_SECRET })

  assertEquals(rpcCalls.map((c) => c.fn), ['create_order_from_cart', 'set_stripe_customer', 'attach_checkout_session'])
  assertEquals(rpcCalls[0].args, { p_user_id: uid, p_livemode: false, p_cart_version: 3, p_terms_version: TERMS_VERSION, p_terms_accepted: true })
  assertEquals(rpcCalls[1].args, { p_user_id: uid, p_stripe_customer_id: 'cus_novo' })
  assertEquals(rpcCalls[2].args, { p_order_id: ORDER_ID, p_checkout_session_id: SESSION_ID, p_expires_at: new Date(1791000000 * 1000).toISOString() })

  const [customer, created] = stripeCalls
  assertEquals([customer.idempotencyKey, customer.params.get('email'), customer.params.get('metadata[user_id]')], [`customer:${uid}`, 'teste@example.com', uid])
  assertEquals(created.idempotencyKey, `checkout:${ORDER_ID}`)
  assertEquals(Object.fromEntries(created.params), {
    ui_mode: 'form',
    billing_address_collection: 'auto',
    'phone_number_collection[enabled]': 'false',
    'automatic_tax[enabled]': 'false',
    submit_type: 'auto',
    integration_identifier: 'custom_embedded_web_0001',
    mode: 'payment',
    'line_items[0][price]': PRICE,
    'line_items[0][quantity]': '1',
    allow_promotion_codes: 'true',
    client_reference_id: ORDER_ID,
    customer: 'cus_novo',
    'metadata[order_id]': ORDER_ID,
    'metadata[terms_version]': TERMS_VERSION,
    'payment_intent_data[metadata][order_id]': ORDER_ID,
    locale: 'pt-BR',
    return_url: 'http://127.0.0.1:5176/pedido/confirmacao?session_id={CHECKOUT_SESSION_ID}',
  })
})

contractTest('checkout: Customer existente é atualizado; falha da Stripe vira 502 sem gravar a sessão', async () => {
  const token = await sessionToken()
  onRpc((fn) => (fn === 'create_order_from_cart'
    ? row({ outcome: 'ok', order_id: ORDER_ID, email: 'novo@example.com', stripe_customer_id: 'cus_antigo', items: [{ product_code: 'P001', stripe_price_id: PRICE }], reused: true, detail: null })
    : ok('applied')))
  onStripe((call) => {
    if (call.path === '/v1/customers/cus_antigo') return ok({ id: 'cus_antigo', object: 'customer' })
    return { status: 400, body: { error: { type: 'invalid_request_error', code: 'resource_missing', param: 'line_items[0][price]' } } }
  })
  const { result, logs } = await captureErrors(() => handleRequest(request('/checkout', { method: 'POST', token, body: checkoutBody })))
  assertEquals(result.status, 502)
  assertEquals((await result.json()).error.code, 'PAYMENT_PROVIDER_ERROR')
  assertEquals(stripeCalls.map((c) => [c.method, c.path]), [['POST', '/v1/customers/cus_antigo'], ['POST', '/v1/checkout/sessions']])
  assertEquals(stripeCalls[0].params.get('email'), 'novo@example.com')
  assertEquals(rpcCalls.map((c) => c.fn), ['create_order_from_cart'])
  assertEquals(logs.some((l) => l.includes('@')), false)
})

// ---------- GET /order-status ----------

function orderStatusRpc(status: string, relation: 'owner' | 'other', fulfillReply = row({ outcome: 'applied', order_status: 'paid' })) {
  onRpc((fn) => {
    if (fn === 'fulfill_order') return fulfillReply
    if (fn === 'set_order_status') return row({ outcome: 'applied' })
    return row({ outcome: 'ok', status, items: relation === 'owner' ? [{ code: 'P001', name: 'Pacote' }] : null, relation })
  })
}

contractTest('order-status: sessão paga com cupom libera pelo banco e responde paid ao dono', async () => {
  const token = await sessionToken()
  stripeWith(session())
  orderStatusRpc('paid', 'owner')
  const res = await handleRequest(request(`/order-status?session_id=${SESSION_ID}`, { token }))
  assertEquals(await res.json(), { state: 'paid', next: 'open_library', items: [{ code: 'P001', name: 'Pacote' }] })
  assertEquals(rpcCalls.map((c) => c.fn), ['fulfill_order', 'get_order_status'])
  assertEquals(rpcCalls[0].args, { ...FULFILL_ARGS, p_source: 'return_page', p_stripe_event_id: null, p_event_type: null })
  assertEquals(rpcCalls[1].args, { p_order_id: ORDER_ID, p_user_id: userId(token) })

  orderStatusRpc('paid', 'other')
  assertEquals(await (await handleRequest(request(`/order-status?session_id=${SESSION_ID}`, { token }))).json(), { state: 'paid', next: 'other_account' })
})

contractTest('order-status: aberta, expirada, liberação falhando, sessão inexistente e sessão alheia', async () => {
  const token = await sessionToken()
  const get = async () => (await handleRequest(request(`/order-status?session_id=${SESSION_ID}`, { token }))).json()

  stripeWith(session({ status: 'open', payment_status: 'unpaid' }))
  orderStatusRpc('open', 'owner')
  assertEquals((await get()).state, 'failed')
  assertEquals(rpcCalls.map((c) => c.fn), ['get_order_status'])

  stripeWith(session({ status: 'expired', payment_status: 'unpaid' }))
  orderStatusRpc('expired', 'owner')
  assertEquals((await get()).state, 'expired')
  assertEquals(rpcCalls[0].args.p_new_status, 'expired')

  stripeWith(session())
  orderStatusRpc('open', 'owner', { status: 503, body: { code: 'PGRST000' } })
  const { result } = await captureErrors(get)
  assertEquals(result.state, 'processing')

  stripeWith(null)
  onRpc(() => ok(null))
  assertEquals(await get(), { state: 'not_found' })

  stripeWith(session({ client_reference_id: 'pedido-de-outro-sistema' }))
  assertEquals(await get(), { state: 'not_found' })
  assertEquals(rpcCalls.length, 0)

  assertEquals((await handleRequest(request('/order-status?session_id=nao-e-sessao', { token }))).status, 400)
})

// ---------- stripe-webhook ----------

contractTest('webhook: assinatura inválida responde 400 sem tocar no banco; GET responde 405', async () => {
  onRpc(() => ok(null))
  stripeWith(session())
  const { status, body } = await webhook(stripeEvent('checkout.session.completed', session()), false)
  assertEquals([status, body.error.code], [400, 'INVALID_SIGNATURE'])
  assertEquals((await handleStripeWebhook(new Request('http://localhost/stripe-webhook'))).status, 405)
  assertEquals([rpcCalls.length, stripeCalls.length], [0, 0])
})

contractTest('webhook: completed pago libera com cupom e evento; repetido responde 200 (idempotência no banco)', async () => {
  stripeWith(session())
  onRpc(() => row({ outcome: 'applied', order_status: 'paid', outbox_id: '22222222-2222-4222-8222-222222222222', send_delivery: true }))
  const event = stripeEvent('checkout.session.completed', session())
  const first = await webhook(event)
  assertEquals([first.status, first.body], [200, { received: true, outcome: 'applied' }])
  assertEquals(rpcCalls[0].args, { ...FULFILL_ARGS, p_source: 'webhook', p_stripe_event_id: event.id, p_event_type: 'checkout.session.completed' })

  onRpc(() => row({ outcome: 'duplicate_event', order_status: 'paid', send_delivery: false }))
  const again = await webhook(event)
  assertEquals([again.status, again.body.outcome], [200, 'duplicate_event'])
})

contractTest('webhook: unpaid vira pending_payment; async_failed, expired e sessão alheia', async () => {
  stripeWith(session({ payment_status: 'unpaid' }))
  onRpc(() => row({ outcome: 'applied' }))
  const pending = stripeEvent('checkout.session.completed', session({ payment_status: 'unpaid' }))
  assertEquals((await webhook(pending)).status, 200)
  assertEquals(rpcCalls[0].args, {
    p_order_id: ORDER_ID, p_new_status: 'pending_payment', p_source: 'webhook', p_stripe_event_id: pending.id, p_event_type: 'checkout.session.completed',
    p_amount_subtotal: 1990, p_amount_discount: 199, p_amount_total: 1791, p_currency: 'brl', p_promotion_code: 'TESTE10', p_payment_intent_id: 'pi_teste',
  })

  for (const [type, target] of [['checkout.session.async_payment_failed', 'failed'], ['checkout.session.expired', 'expired']]) {
    onRpc(() => row({ outcome: 'applied' }))
    const event = stripeEvent(type, session({ payment_status: 'unpaid' }))
    assertEquals((await webhook(event)).status, 200)
    assertEquals([rpcCalls[0].fn, rpcCalls[0].args.p_new_status, rpcCalls[0].args.p_stripe_event_id], ['set_order_status', target, event.id])
  }

  onRpc(() => ok(null))
  const alheia = await webhook(stripeEvent('checkout.session.completed', session({ client_reference_id: null })))
  assertEquals([alheia.status, alheia.body.outcome, rpcCalls.length], [200, 'not_ours', 0])
  const outro = await webhook(stripeEvent('customer.created', { id: 'cus_x', object: 'customer' }))
  assertEquals([outro.status, outro.body.outcome], [200, 'ignored'])
})

contractTest('webhook: contestação aberta, vencida, perdida e reembolso total; pedido pelo PaymentIntent', async () => {
  const intent = (metadata: Record<string, string>) => (call: StripeCall) =>
    call.path === '/v1/payment_intents/pi_teste' ? ok({ id: 'pi_teste', object: 'payment_intent', metadata }) : null
  const dispute = (status: string) => ({ id: 'dp_teste', object: 'dispute', payment_intent: 'pi_teste', reason: 'fraudulent', status })

  for (const [type, object, target] of [
    ['charge.dispute.created', dispute('needs_response'), 'disputed'],
    ['charge.dispute.closed', dispute('won'), 'paid'],
    ['charge.dispute.closed', dispute('warning_closed'), 'paid'],
    ['charge.dispute.closed', dispute('lost'), 'dispute_lost'],
    ['charge.refunded', { id: 'ch_teste', object: 'charge', payment_intent: 'pi_teste', refunded: true }, 'refunded'],
  ] as const) {
    stripeWith(null, intent({ order_id: ORDER_ID }))
    onRpc(() => row({ outcome: 'applied' }))
    const res = await webhook(stripeEvent(type, object))
    assertEquals([res.status, rpcCalls[0]?.args.p_order_id, rpcCalls[0]?.args.p_new_status], [200, ORDER_ID, target], `${type} ${target}`)
  }

  // Parcial não chama o banco (D5); intent sem metadata cai na sessão do intent.
  stripeWith(null, intent({ order_id: ORDER_ID }))
  onRpc(() => row({ outcome: 'applied' }))
  const partial = await webhook(stripeEvent('charge.refunded', { id: 'ch_teste', object: 'charge', payment_intent: 'pi_teste', refunded: false }))
  assertEquals([partial.status, partial.body.outcome, rpcCalls.length], [200, 'ignored', 0])

  stripeWith(null, (call) => {
    if (call.path === '/v1/payment_intents/pi_teste') return ok({ id: 'pi_teste', object: 'payment_intent', metadata: {} })
    if (call.path === '/v1/checkout/sessions') return ok({ object: 'list', data: [session()], has_more: false, url: '/v1/checkout/sessions' })
    return null
  })
  onRpc(() => row({ outcome: 'applied' }))
  await webhook(stripeEvent('charge.dispute.created', dispute('needs_response')))
  assertEquals(rpcCalls[0].args.p_order_id, ORDER_ID)
  assertEquals(stripeCalls[1].params.get('payment_intent'), 'pi_teste')
})

contractTest('webhook: deferred e defeitos corrigíveis respondem 500; erros finais respondem 200', async () => {
  stripeWith(null, (call) => (call.path === '/v1/payment_intents/pi_teste' ? ok({ id: 'pi_teste', object: 'payment_intent', metadata: { order_id: ORDER_ID } }) : null))
  onRpc(() => row({ outcome: 'deferred' }))
  const deferred = await webhook(stripeEvent('charge.dispute.created', { id: 'dp', object: 'dispute', payment_intent: 'pi_teste', reason: 'fraudulent', status: 'needs_response' }))
  assertEquals([deferred.status, deferred.body.outcome], [500, 'deferred'])

  stripeWith(session())
  for (const [code, status] of [['KT012', 200], ['KT002', 200], ['KT003', 500], ['KT011', 500], ['PGRST000', 500]] as const) {
    onRpc(() => ({ status: 400, body: { code, message: 'detalhe com teste@example.com' } }))
    const { result, logs } = await captureErrors(() => webhook(stripeEvent('checkout.session.completed', session())))
    assertEquals(result.status, status, code)
    assertEquals(logs.some((l) => l.includes('@')), false)
  }
})
