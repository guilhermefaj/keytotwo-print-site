// Testes de contrato de pedidos e reembolsos no admin (docs/api-contract.md 6.15), sem rede e sem banco: a Stripe e o
// banco são falsos (contract-helpers).
import { assertEquals } from '@std/assert'
import { setBackgroundRunner } from '../_shared/background.ts'
import { adminToken as admin, contractTest, ok, onRpc, onStripe, row, rpcCalls, send, sessionToken, stripeCalls, userId } from './contract-helpers.ts'

const ORDER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'
const OWNER = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const OUTBOX = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'
const SESSION = 'cs_test_ORDERS1'
const base = `/admin/orders/${ORDER}`

// O pedido como admin_order_stripe devolve; over troca campos.
const stripeRow = (over: Record<string, unknown> = {}) => ({
  outcome: 'ok', ref: '9F8E7D6C', kind: 'purchase', status: 'paid', livemode: false, user_id: OWNER,
  checkout_session_id: SESSION, payment_intent_id: 'pi_ORDERS1', amount_total: 990, currency: 'brl', ...over,
})

// Banco falso do reembolso: o pedido, o status e o histórico (com o aviso na fila).
function refundDb(order: Record<string, unknown> = stripeRow()) {
  onRpc((fn) => {
    if (fn === 'admin_order_stripe') return row(order)
    if (fn === 'set_order_status') return row({ outcome: 'applied', order_id: ORDER, previous_status: 'paid', order_status: 'refunded', entitlement_status: 'revoked' })
    if (fn === 'admin_log_order_action') return row({ outcome: 'ok', outbox_id: OUTBOX })
    if (fn === 'claim_email_batch') return ok([])
    return { status: 500, body: {} }
  })
}

contractTest('pedidos no admin: sem sessão 401; sem o segundo fator 403 MFA_REQUIRED, antes do banco', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const aal1 = await sessionToken({ aal: 'aal1' })
  const routes: [string, string][] = [['/admin/orders', 'GET'], [base, 'GET'], [`${base}/refund`, 'POST'], [`${base}/reconcile`, 'POST']]
  for (const [path, method] of routes) {
    const body = method === 'GET' ? undefined : {}
    assertEquals((await send(path, { method, body })).body.error.code, 'UNAUTHENTICATED', `${method} ${path}`)
    const res = await send(path, { method, token: aal1, body })
    assertEquals([res.status, res.body.error.code], [403, 'MFA_REQUIRED'], `${method} ${path}`)
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /admin/orders: busca, filtro, página e o modo da chave viram os argumentos; inválidos 400 sem banco; não admin 403', async () => {
  const token = await admin()
  onRpc(() => row({ outcome: 'ok', result: { total: 1, offset: 50, limit: 50, orders: [{ id: ORDER }] } }))
  const res = await send('/admin/orders?q=%20%239f8e7d6c%20&filter=refunded&page=2', { token })
  assertEquals([res.status, res.body], [200, { total: 1, offset: 50, limit: 50, orders: [{ id: ORDER }], page: 2 }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['admin_list_orders', { p_user_id: userId(token), p_query: '#9f8e7d6c', p_filter: 'refunded', p_livemode: false, p_offset: 50 }]])
  await send('/admin/orders', { token })
  assertEquals(rpcCalls[1].args, { p_user_id: userId(token), p_query: null, p_filter: 'all', p_livemode: false, p_offset: 0 })
  for (const query of ['filter=todos', 'page=0', 'page=2.5', `q=${'a'.repeat(201)}`]) {
    assertEquals((await send(`/admin/orders?${query}`, { token })).status, 400, query)
  }
  assertEquals(rpcCalls.length, 2)
  onRpc(() => row({ outcome: 'forbidden', result: null }))
  assertEquals((await send('/admin/orders', { token })).body.error.code, 'NOT_ADMIN')
})

contractTest('GET /admin/orders/:id: a ficha do banco; id inválido 404 sem banco; pedido que não existe 404', async () => {
  const token = await admin()
  onRpc(() => row({ outcome: 'ok', result: { order: { id: ORDER } } }))
  assertEquals((await send(base, { token })).body, { order: { id: ORDER } })
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_order_id: ORDER })
  assertEquals((await send('/admin/orders/nao-e-id', { token })).status, 404)
  assertEquals(rpcCalls.length, 1)
  onRpc(() => row({ outcome: 'not_found', result: null }))
  const gone = await send(base, { token })
  assertEquals([gone.status, gone.body.error.message], [404, 'Pedido não encontrado.'])
})

contractTest('POST refund: reembolsa na Stripe pelo pedido (idempotente), marca reembolsado pelo admin, grava o histórico e manda o aviso', async () => {
  const token = await admin()
  const tasks: Promise<unknown>[] = []
  setBackgroundRunner((task) => tasks.push(task))
  try {
    refundDb()
    onStripe((call) => call.method === 'POST' && call.path === '/v1/refunds'
      ? ok({ id: 're_ORDERS1', object: 'refund', status: 'succeeded', amount: 990, currency: 'brl' })
      : { status: 500, body: {} })
    const res = await send(`${base}/refund`, { method: 'POST', token, body: { reason: '  Pediu por e-mail  ', confirm_ref: '#9f8e7d6c' } })
    assertEquals([res.status, res.body], [200, { refunded: true, refund_status: 'succeeded', email_queued: true }])
    await Promise.all(tasks)

    assertEquals(stripeCalls.length, 1)
    const params = Object.fromEntries(stripeCalls[0].params)
    assertEquals([params.payment_intent, params.reason, params['metadata[order_id]'], params['metadata[source]']], ['pi_ORDERS1', 'requested_by_customer', ORDER, 'admin'])
    assertEquals(stripeCalls[0].idempotencyKey, `refund:${ORDER}`)
    assertEquals(rpcCalls.map((c) => c.fn), ['admin_order_stripe', 'set_order_status', 'admin_log_order_action', 'claim_email_batch'])
    assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_order_id: ORDER })
    assertEquals([rpcCalls[1].args.p_order_id, rpcCalls[1].args.p_new_status, rpcCalls[1].args.p_source, rpcCalls[1].args.p_reason], [ORDER, 'refunded', 'admin', 'admin_refund'])
    assertEquals(rpcCalls[2].args, {
      p_user_id: userId(token), p_order_id: ORDER, p_action: 'order_refund', p_reason: 'Pediu por e-mail',
      p_details: { refund_id: 're_ORDERS1', amount: 990, currency: 'brl' },
    })
    assertEquals(rpcCalls[3].args, { p_limit: 20, p_outbox_id: OUTBOX })
  } finally {
    setBackgroundRunner(null)
  }
})

contractTest('POST refund: motivo e confirmação errados, pedido que não reembolsa ou de outro modo: recusa antes da Stripe', async () => {
  const token = await admin()
  onStripe(() => ok({ id: 're_X', status: 'succeeded' }))
  refundDb()
  const short = await send(`${base}/refund`, { method: 'POST', token, body: { reason: 'oi', confirm_ref: '9F8E7D6C' } })
  assertEquals([short.status, short.body.error.message], [400, 'Escreva o motivo, de 3 a 300 caracteres.'])
  assertEquals(rpcCalls.length, 0)
  const wrong = await send(`${base}/refund`, { method: 'POST', token, body: { reason: 'Pediu por e-mail', confirm_ref: '12345678' } })
  assertEquals([wrong.status, wrong.body.error.message], [400, 'Digite o código do pedido para confirmar o reembolso.'])

  const refused: [Record<string, unknown>, string][] = [
    [{ kind: 'courtesy', payment_intent_id: null, amount_total: 0 }, 'Presente não tem pagamento para devolver.'],
    [{ status: 'refunded' }, 'Este pedido já foi reembolsado.'],
    [{ status: 'open', payment_intent_id: null }, 'Só um pedido pago e com cobrança pode ser reembolsado.'],
    [{ amount_total: 0, payment_intent_id: null }, 'Só um pedido pago e com cobrança pode ser reembolsado.'],
    [{ livemode: true }, 'Este pedido é de outro modo da Stripe (teste ou produção) e não se mexe daqui.'],
  ]
  for (const [over, message] of refused) {
    refundDb(stripeRow(over))
    const res = await send(`${base}/refund`, { method: 'POST', token, body: { reason: 'Pediu por e-mail', confirm_ref: '9F8E7D6C' } })
    assertEquals([res.status, res.body.error.code, res.body.error.message], [409, 'ORDER_NOT_REFUNDABLE', message], JSON.stringify(over))
    assertEquals(rpcCalls.map((c) => c.fn), ['admin_order_stripe'])
  }
  assertEquals(stripeCalls.length, 0)
  onRpc(() => row({ outcome: 'not_found', ref: null }))
  assertEquals((await send(`${base}/refund`, { method: 'POST', token, body: { reason: 'Pediu por e-mail', confirm_ref: '9F8E7D6C' } })).status, 404)
})

contractTest('POST refund: a Stripe recusa (sem permissão, já reembolsado ou falhou) e o pedido não muda', async () => {
  const token = await admin()
  const body = { reason: 'Pediu por e-mail', confirm_ref: '9F8E7D6C' }
  const cases: [Parameters<typeof onStripe>[0], number, string][] = [
    [() => ({ status: 403, body: { error: { type: 'invalid_request_error', message: 'restricted key' } } }), 502,
      'A chave da Stripe não tem permissão para reembolsar. Libere a escrita de Reembolsos na chave restrita.'],
    [() => ({ status: 400, body: { error: { type: 'invalid_request_error', code: 'charge_already_refunded' } } }), 409,
      'A Stripe diz que este pagamento já foi reembolsado. O pedido atualiza quando o aviso dela chegar.'],
    [() => ({ status: 400, body: { error: { type: 'invalid_request_error', code: 'amount_too_large' } } }), 502,
      'A Stripe recusou o reembolso agora. Nada mudou; tente de novo ou faça pelo painel da Stripe.'],
    [() => ok({ id: 're_F', object: 'refund', status: 'failed', amount: 990, currency: 'brl' }), 502,
      'A Stripe não concluiu o reembolso. Confira o pagamento no painel da Stripe.'],
  ]
  for (const [reply, status, message] of cases) {
    refundDb()
    onStripe(reply)
    const res = await send(`${base}/refund`, { method: 'POST', token, body })
    assertEquals([res.status, res.body.error.message], [status, message])
    assertEquals(rpcCalls.map((c) => c.fn), ['admin_order_stripe'], message)
  }
})

// Sessão paga da Stripe, com um item.
const paidSession = {
  id: SESSION, object: 'checkout.session', status: 'complete', payment_status: 'paid', client_reference_id: ORDER, livemode: false,
  amount_subtotal: 990, amount_total: 990, currency: 'brl', total_details: { amount_discount: 0 }, payment_intent: 'pi_ORDERS1',
  customer: 'cus_ORDERS1', metadata: {}, discounts: [],
}
const lineItems = { object: 'list', has_more: false, data: [{ id: 'li_1', object: 'item', quantity: 1, currency: 'brl', amount_total: 990, price: { id: 'price_J001', unit_amount: 990 } }] }
const stripeSession = (session: Record<string, unknown>) => onStripe((call) => {
  if (call.method === 'GET' && call.path === `/v1/checkout/sessions/${SESSION}`) return ok(session)
  if (call.path === `/v1/checkout/sessions/${SESSION}/line_items`) return ok(lineItems)
  return { status: 500, body: {} }
})

contractTest('POST reconcile: sessão paga libera pela origem reconcile, grava o histórico e manda o acesso', async () => {
  const token = await admin()
  const tasks: Promise<unknown>[] = []
  setBackgroundRunner((task) => tasks.push(task))
  try {
    onRpc((fn) => {
      if (fn === 'admin_order_stripe') return row(stripeRow({ status: 'open', payment_intent_id: null }))
      if (fn === 'fulfill_order') return row({ outcome: 'applied', order_id: ORDER, order_status: 'paid', entitlement_count: 1, outbox_id: OUTBOX, send_delivery: true })
      if (fn === 'admin_log_order_action') return row({ outcome: 'ok', outbox_id: null })
      return ok([])
    })
    stripeSession(paidSession)
    const res = await send(`${base}/reconcile`, { method: 'POST', token, body: { reason: 'Webhook não chegou' } })
    assertEquals([res.status, res.body], [200, { outcome: 'applied', status: 'paid' }])
    await Promise.all(tasks)
    assertEquals(rpcCalls.map((c) => c.fn), ['admin_order_stripe', 'fulfill_order', 'admin_log_order_action', 'claim_email_batch'])
    assertEquals([rpcCalls[1].args.p_order_id, rpcCalls[1].args.p_source, rpcCalls[1].args.p_checkout_session_id], [ORDER, 'reconcile', SESSION])
    assertEquals(rpcCalls[2].args, { p_user_id: userId(token), p_order_id: ORDER, p_action: 'order_reconcile', p_reason: 'Webhook não chegou', p_details: { outcome: 'applied', status: 'paid' } })
    assertEquals(rpcCalls[3].args, { p_limit: 20, p_outbox_id: OUTBOX })
  } finally {
    setBackgroundRunner(null)
  }
})

contractTest('POST reconcile: sessão aberta, pedido pago ou presente não mudam; Stripe fora do ar 502', async () => {
  const token = await admin()
  const body = { reason: 'Webhook não chegou' }
  onRpc((fn) => (fn === 'admin_order_stripe' ? row(stripeRow({ status: 'open' })) : ok([])))
  stripeSession({ ...paidSession, status: 'open', payment_status: 'unpaid' })
  const open = await send(`${base}/reconcile`, { method: 'POST', token, body })
  assertEquals([open.status, open.body.error.message], [409, 'A sessão ainda está aberta na Stripe: a pessoa não terminou de pagar.'])
  assertEquals(rpcCalls.map((c) => c.fn), ['admin_order_stripe'])

  for (const over of [{ status: 'paid' }, { kind: 'courtesy', checkout_session_id: null }, { status: 'open', checkout_session_id: null }]) {
    onRpc(() => row(stripeRow(over)))
    stripeSession(paidSession)
    const res = await send(`${base}/reconcile`, { method: 'POST', token, body })
    assertEquals([res.status, res.body.error.code], [409, 'ORDER_NOT_RECONCILABLE'], JSON.stringify(over))
    assertEquals(stripeCalls.length, 0)
  }

  onRpc(() => row(stripeRow({ status: 'pending_payment' })))
  onStripe(() => ({ status: 500, body: { error: { type: 'api_error' } } }))
  const down = await send(`${base}/reconcile`, { method: 'POST', token, body })
  assertEquals([down.status, down.body.error.code], [502, 'PAYMENT_PROVIDER_ERROR'])
})
