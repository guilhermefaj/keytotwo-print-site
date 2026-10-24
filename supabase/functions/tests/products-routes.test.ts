// Testes de contrato do catálogo no admin (docs/api-contract.md 6.17), sem rede e sem banco: a Stripe e o banco são
// falsos (contract-helpers). Cada teste usa Prices próprios: a memória de preços da função vale para o processo todo.
import { assertEquals } from '@std/assert'
import { setBackgroundRunner } from '../_shared/background.ts'
import { adminToken as admin, captureErrors, contractTest, ok, onRpc, onStripe, row, rpcCalls, send, sessionToken, stripeCalls, userId } from './contract-helpers.ts'

const fresh = () => new Date().toISOString()
// Banco falso: a lista do admin com um produto (o Price dele) e o que cada RPC de ação devolve.
function catalogDb(priceId: string, actions: Record<string, Record<string, unknown>> = {}, stored?: { unit_amount: number; product: string }) {
  onRpc((fn) => {
    if (fn === 'admin_list_catalog') {
      return row({ outcome: 'ok', result: { products: [{ code: 'J001', kind: 'single', stripe_price_id: priceId, games: [] }], games: [] } })
    }
    if (fn === 'get_stripe_prices') {
      return ok(stored ? [{ price_id: priceId, unit_amount: stored.unit_amount, currency: 'brl', product: stored.product, active: true, fetched_at: fresh() }] : [])
    }
    if (fn in actions) return row(actions[fn])
    return { status: 500, body: {} }
  })
}

contractTest('catálogo no admin: sem sessão 401; sem o segundo fator 403 MFA_REQUIRED, antes do banco', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const aal1 = await sessionToken({ aal: 'aal1' })
  const routes: [string, string][] = [
    ['/admin/catalog', 'GET'], ['/admin/products/J001/status', 'POST'], ['/admin/products/J001/price', 'POST'],
    ['/admin/products/J001/list-price', 'POST'], ['/admin/products/P001/games', 'POST'], ['/admin/products/P001/games/J004/remove', 'POST'],
  ]
  for (const [path, method] of routes) {
    const body = method === 'GET' ? undefined : {}
    assertEquals((await send(path, { method, body })).body.error.code, 'UNAUTHENTICATED', `${method} ${path}`)
    assertEquals((await send(path, { method, token: aal1, body })).body.error.code, 'MFA_REQUIRED', `${method} ${path}`)
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /admin/catalog: a lista do banco no modo da chave, com o preço guardado da Stripe', async () => {
  const token = await admin()
  catalogDb('price_CAT_LISTA', {}, { unit_amount: 990, product: 'prod_CAT_LISTA' })
  const res = await send('/admin/catalog', { token })
  assertEquals(res.status, 200)
  assertEquals(res.body.products[0].price, { unit_amount: 990, currency: 'brl' })
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_livemode: false })
  onRpc(() => row({ outcome: 'forbidden', result: null }))
  assertEquals((await send('/admin/catalog', { token })).body.error.code, 'NOT_ADMIN')
})

contractTest('POST status: situação e motivo conferidos antes do banco; os resultados do banco viram 409 ou 200', async () => {
  const token = await admin()
  catalogDb('price_CAT_STATUS', { admin_set_product_status: { outcome: 'ok' } })
  for (const body of [{ status: 'draft', reason: 'Pausa' }, { status: 'archived', reason: 'a' }]) {
    assertEquals((await send('/admin/products/J001/status', { method: 'POST', token, body })).status, 400)
  }
  assertEquals((await send('/admin/products/j001/status', { method: 'POST', token, body: { status: 'archived', reason: 'Pausa' } })).status, 404)
  assertEquals(rpcCalls.length, 0)
  const res = await send('/admin/products/J001/status', { method: 'POST', token, body: { status: 'archived', reason: ' Revisão do PDF ' } })
  assertEquals([res.status, res.body], [200, { status: 'archived' }])
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_code: 'J001', p_status: 'archived', p_reason: 'Revisão do PDF' })
  catalogDb('price_CAT_STATUS', { admin_set_product_status: { outcome: 'not_ready' } })
  const refused = await send('/admin/products/J001/status', { method: 'POST', token, body: { status: 'active', reason: 'Lançar' } })
  assertEquals([refused.status, refused.body.error.code], [409, 'CATALOG_CONFLICT'])
})

contractTest('POST price: cria o Price na Stripe (idempotente), passa o produto para ele e arquiva o antigo', async () => {
  const token = await admin()
  catalogDb('price_CAT_VELHO', { admin_set_product_price: { outcome: 'ok', previous_price_id: 'price_CAT_VELHO' } }, { unit_amount: 990, product: 'prod_CAT_J001' })
  onStripe((call) => (call.method === 'POST' && call.path === '/v1/prices' ? ok({ id: 'price_CAT_NOVO', object: 'price' })
    : call.method === 'POST' && call.path === '/v1/prices/price_CAT_VELHO' ? ok({ id: 'price_CAT_VELHO', object: 'price', active: false }) : { status: 404, body: {} }))
  for (const amount of [99, 100_001, 12.5, '1490']) {
    assertEquals((await send('/admin/products/J001/price', { method: 'POST', token, body: { amount, reason: 'Reajuste' } })).status, 400, String(amount))
  }
  const res = await send('/admin/products/J001/price', { method: 'POST', token, body: { amount: 1490, reason: 'Reajuste de lançamento' } })
  assertEquals([res.status, res.body], [200, { price: { unit_amount: 1490, currency: 'brl' } }])
  assertEquals(stripeCalls.map((c) => `${c.method} ${c.path}`), ['POST /v1/prices', 'POST /v1/prices/price_CAT_VELHO'])
  const created = Object.fromEntries(stripeCalls[0].params)
  assertEquals([created.product, created.unit_amount, created.currency, created['metadata[code]']], ['prod_CAT_J001', '1490', 'brl', 'J001'])
  assertEquals(stripeCalls[0].idempotencyKey, 'price:J001:price_CAT_VELHO:1490')
  assertEquals(Object.fromEntries(stripeCalls[1].params).active, 'false')
  assertEquals(rpcCalls.find((c) => c.fn === 'admin_set_product_price')!.args, {
    p_user_id: userId(token), p_code: 'J001', p_price_id: 'price_CAT_NOVO', p_unit_amount: 1490, p_currency: 'brl',
    p_stripe_product: 'prod_CAT_J001', p_reason: 'Reajuste de lançamento',
  })

  // o mesmo valor de agora: 409 sem ir à Stripe
  onStripe(() => ok({}))
  const same = await send('/admin/products/J001/price', { method: 'POST', token, body: { amount: 990, reason: 'Reajuste' } })
  assertEquals([same.status, same.body.error.code, stripeCalls.length], [409, 'CATALOG_CONFLICT', 0])
})

contractTest('POST price: sem a permissão da chave, 502 explicando; nada muda no banco', async () => {
  const token = await admin()
  catalogDb('price_CAT_SEMPERM', { admin_set_product_price: { outcome: 'ok', previous_price_id: null } }, { unit_amount: 990, product: 'prod_CAT_SEMPERM' })
  onStripe(() => ({ status: 403, body: { error: { type: 'invalid_request_error', code: 'more_permissions_required', message: 'sem permissão' } } }))
  const { result: res } = await captureErrors(() => send('/admin/products/J001/price', { method: 'POST', token, body: { amount: 1490, reason: 'Reajuste' } }))
  assertEquals([res.status, res.body.error.code], [502, 'PAYMENT_PROVIDER_ERROR'])
  assertEquals(res.body.error.message.includes('escrita de Preços'), true)
  assertEquals(rpcCalls.some((c) => c.fn === 'admin_set_product_price'), false)
})

contractTest('POST list-price: valor e rótulo, ou null para tirar', async () => {
  const token = await admin()
  catalogDb('price_CAT_RISCADO', { admin_set_list_price: { outcome: 'ok' } })
  assertEquals((await send('/admin/products/P001/list-price', { method: 'POST', token, body: { amount: 3990, label: 'a', reason: 'Promo' } })).status, 400)
  const set = await send('/admin/products/P001/list-price', { method: 'POST', token, body: { amount: 3990, label: ' Preço de lançamento ', reason: 'Lançamento' } })
  assertEquals([set.status, set.body], [200, { list_price: { amount: 3990, label: 'Preço de lançamento' } }])
  assertEquals(rpcCalls.at(-1)!.args, { p_user_id: userId(token), p_code: 'P001', p_amount: 3990, p_label: 'Preço de lançamento', p_reason: 'Lançamento' })
  const off = await send('/admin/products/P001/list-price', { method: 'POST', token, body: { amount: null, reason: 'Fim da promoção' } })
  assertEquals([off.status, off.body.list_price, rpcCalls.at(-1)!.args.p_amount, rpcCalls.at(-1)!.args.p_label], [200, null, null, null])
})

contractTest('POST games: põe o jogo com o presente e manda os e-mails em seguida; tira com motivo', async () => {
  const token = await admin()
  const tasks: Promise<unknown>[] = []
  setBackgroundRunner((task) => tasks.push(task))
  try {
    catalogDb('price_CAT_PACOTE', {
      admin_add_pack_game: { outcome: 'ok', gifted: 2, outbox_ids: ['2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f'] },
      admin_remove_pack_game: { outcome: 'ok' },
    })
    assertEquals((await send('/admin/products/P001/games', { method: 'POST', token, body: { game: 'J006', reason: 'Jogo novo' } })).status, 400)
    const added = await send('/admin/products/P001/games', { method: 'POST', token, body: { game: 'J006', gift: true, notify: true, reason: 'Jogo novo no pacote' } })
    assertEquals([added.status, added.body], [200, { added: true, gifted: 2, emails_queued: 2 }])
    assertEquals(rpcCalls.find((c) => c.fn === 'admin_add_pack_game')!.args, { p_user_id: userId(token), p_code: 'P001', p_game_code: 'J006', p_gift: true, p_notify: true, p_reason: 'Jogo novo no pacote', p_livemode: false })
    assertEquals(tasks.length, 1)
    await Promise.allSettled(tasks)
    // sem presente, o aviso também não vai
    await send('/admin/products/P001/games', { method: 'POST', token, body: { game: 'J006', gift: false, notify: true, reason: 'Jogo novo' } })
    assertEquals(rpcCalls.filter((c) => c.fn === 'admin_add_pack_game').at(-1)!.args.p_notify, false)
    await Promise.allSettled(tasks)
    const removed = await send('/admin/products/P001/games/J004/remove', { method: 'POST', token, body: { reason: 'Saiu da coleção' } })
    assertEquals([removed.status, removed.body], [200, { removed: true }])
    assertEquals(rpcCalls.at(-1)!.args, { p_user_id: userId(token), p_code: 'P001', p_game_code: 'J004', p_reason: 'Saiu da coleção' })
    catalogDb('price_CAT_PACOTE', { admin_add_pack_game: { outcome: 'no_single', gifted: 0, outbox_ids: null }, admin_remove_pack_game: { outcome: 'not_allowed' } })
    assertEquals((await send('/admin/products/P001/games', { method: 'POST', token, body: { game: 'J006', gift: true, notify: false, reason: 'Jogo novo' } })).body.error.code, 'CATALOG_CONFLICT')
    assertEquals((await send('/admin/products/P001/games/J004/remove', { method: 'POST', token, body: { reason: 'Saiu' } })).status, 409)
  } finally {
    setBackgroundRunner(null)
  }
})
