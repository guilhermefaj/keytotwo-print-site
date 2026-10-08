// Testes de contrato das rotas do I2b (docs/api-contract.md v0.3), sem rede e sem banco.
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assertEquals, assertExists } from '@std/assert'
import { captureErrors, onPrice, onRpc, request, rpcCalls, sessionToken, userId, contractTest } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'

const GAME = { code: 'J001', name: 'Jogo [TESTE]' }
const CATALOG = [
  { code: 'P001', kind: 'bundle', name: 'Pacote [TESTE]', stripe_price_id: 'price_ok', games: [GAME] },
  { code: 'A002', kind: 'single', name: 'Avulso [TESTE]', stripe_price_id: 'price_fora', games: [GAME] },
]
const ACCOUNT = {
  email: 'teste@example.com',
  marketing: { opted_in: true, updated_at: '2026-10-08T12:00:00Z', text_version: 'mkt-1', prompted_at: '2026-10-08T12:00:00Z' },
  orders: [{ ref: 'A1B2C3D4', created_at: '2026-10-08T12:00:00Z', paid_at: null, status: 'pending_payment', amount_total: 100, currency: 'brl', items: [] }],
}
const LIBRARY = {
  games: [{ code: 'J001', name: 'Jogo [TESTE]', acquired_at: '2026-10-08T12:00:00Z', products: [{ code: 'P001', name: 'Pacote [TESTE]' }], files: [] }],
  pending: [],
}

function cartItem(code: string, extra: Record<string, unknown> = {}) {
  return { code, kind: 'bundle', name: `Produto ${code}`, stripe_price_id: `price_${code}`, games: [GAME], status: 'ok', available: true, owned_games: [], shared_with: [], ...extra }
}

onPrice((id) => (id === 'price_fora' ? { status: 404, body: {} } : { status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl' } }))

contractTest('GET /catalog é pública, lê preço da Stripe e não expõe o stripe_price_id', async () => {
  onRpc(() => ({ status: 200, body: CATALOG }))
  const res = await handleRequest(request('/catalog'))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Cache-Control'), 'public, max-age=60')
  const body = await res.json()
  assertEquals(body.products.map((p: { price: unknown }) => p.price), [{ unit_amount: 1990, currency: 'brl' }, null])
  assertEquals(body.products.some((p: Record<string, unknown>) => 'stripe_price_id' in p), false)
  assertEquals(rpcCalls.map((c) => c.fn), ['get_catalog'])
  assertEquals(rpcCalls[0].secretKeyOk && !rpcCalls[0].hasAuthorization, true)
})

contractTest('rotas privadas recusam sem sessão, sessão vencida e papel errado', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const expired = await sessionToken({ exp: Math.floor(Date.now() / 1000) - 60 })
  const anon = await sessionToken({ role: 'anon' })
  for (const [path, method] of [['/cart', 'GET'], ['/cart/items', 'POST'], ['/cart/items/P001', 'DELETE'], ['/account', 'GET'], ['/account/marketing', 'PUT'], ['/account/marketing/prompt', 'POST'], ['/library', 'GET']]) {
    for (const token of [undefined, expired, anon, 'lixo.lixo.lixo']) {
      const res = await handleRequest(request(path, { method, token, body: method === 'GET' || method === 'DELETE' ? undefined : {} }))
      assertEquals(res.status, 401, `${method} ${path}`)
      assertEquals((await res.json()).error.code, 'UNAUTHENTICATED')
    }
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /cart soma o subtotal dos disponíveis e gera avisos', async () => {
  const token = await sessionToken()
  onRpc(() => ({
    status: 200,
    body: {
      version: 4,
      items: [
        cartItem('P001', { owned_games: ['J001'] }),
        cartItem('A002', { status: 'unavailable', available: false }),
        cartItem('A003', { stripe_price_id: 'price_fora' }),
      ],
    },
  }))
  const res = await handleRequest(request('/cart', { token }))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.version, 4)
  assertEquals(body.items.some((i: Record<string, unknown>) => 'stripe_price_id' in i), false)
  assertEquals(body.subtotal, null)
  assertEquals(body.warnings, [
    { code: 'PARTIAL_OVERLAP', product_code: 'P001' },
    { code: 'PRODUCT_UNAVAILABLE', product_code: 'A002' },
    { code: 'PRICE_UNAVAILABLE', product_code: 'A003' },
  ])
  assertEquals(rpcCalls, [{ fn: 'get_cart', args: { p_user_id: userId(token) }, secretKeyOk: true, hasAuthorization: false }])

  onRpc(() => ({ status: 200, body: { version: 2, items: [cartItem('P001'), cartItem('P002')] } }))
  const ok = await (await handleRequest(request('/cart', { token }))).json()
  assertEquals(ok.subtotal, { amount: 3980, currency: 'brl' })
  assertEquals(ok.warnings, [])

  onRpc(() => ({ status: 200, body: null }))
  assertEquals(await (await handleRequest(request('/cart', { token }))).json(), { version: 0, items: [], subtotal: null, warnings: [] })
})

contractTest('POST /cart/items adiciona e mapeia os outcomes de cart_add', async () => {
  const token = await sessionToken()
  const reply = (outcome: string) => (fn: string) =>
    fn === 'cart_add' ? { status: 200, body: [{ outcome, cart_version: 1, owned_games: [] }] } : { status: 200, body: { version: 1, items: [cartItem('P001')] } }

  for (const outcome of ['added', 'noop']) {
    onRpc(reply(outcome))
    const res = await handleRequest(request('/cart/items', { method: 'POST', token, body: { product_code: 'P001' } }))
    assertEquals(res.status, 200)
    assertEquals((await res.json()).version, 1)
    assertEquals(rpcCalls.map((c) => c.fn), ['cart_add', 'get_cart'])
    assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_product_code: 'P001' })
  }
  for (const [outcome, code] of [['already_owned', 'ALREADY_OWNED'], ['product_unavailable', 'PRODUCT_UNAVAILABLE']]) {
    onRpc(reply(outcome))
    const res = await handleRequest(request('/cart/items', { method: 'POST', token, body: { product_code: 'P001' } }))
    assertEquals(res.status, 409)
    const { error } = await res.json()
    assertEquals([error.code, error.details], [code, { product_codes: ['P001'] }])
    assertEquals(rpcCalls.map((c) => c.fn), ['cart_add'])
  }
})

contractTest('POST /cart/items valida corpo e código antes do banco', async () => {
  const token = await sessionToken()
  onRpc(() => ({ status: 200, body: null }))
  for (const body of [{ product_code: 'p001' }, { product_code: 'P' }, { product_code: 42 }, {}, ['P001']]) {
    const res = await handleRequest(request('/cart/items', { method: 'POST', token, body }))
    assertEquals(res.status, 400, JSON.stringify(body))
  }
  const noJson = await handleRequest(new Request('http://localhost/api/cart/items', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'P001' }))
  assertEquals(noJson.status, 415)
  assertEquals(rpcCalls.length, 0)
})

contractTest('DELETE /cart/items/{code} remove e devolve o carrinho', async () => {
  const token = await sessionToken()
  onRpc((fn) => (fn === 'cart_remove' ? { status: 200, body: [{ outcome: 'removed', cart_version: 5 }] } : { status: 200, body: { version: 5, items: [] } }))
  const res = await handleRequest(request('/cart/items/P001', { method: 'DELETE', token }))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).version, 5)
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['cart_remove', { p_user_id: userId(token), p_product_code: 'P001' }], ['get_cart', { p_user_id: userId(token) }]])

  onRpc(() => ({ status: 200, body: null }))
  assertEquals((await handleRequest(request('/cart/items/p%20001', { method: 'DELETE', token }))).status, 400)
  assertEquals((await handleRequest(request('/cart/items/%E0%A4%A', { method: 'DELETE', token }))).status, 400)
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /account e GET /library repassam as RPCs', async () => {
  const token = await sessionToken()
  onRpc((fn) => ({ status: 200, body: fn === 'get_account' ? ACCOUNT : LIBRARY }))
  assertEquals(await (await handleRequest(request('/account', { token }))).json(), ACCOUNT)
  assertEquals(await (await handleRequest(request('/library', { token }))).json(), LIBRARY)
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['get_account', { p_user_id: userId(token) }], ['get_library', { p_user_id: userId(token) }]])

  onRpc(() => ({ status: 200, body: null }))
  assertEquals(await (await handleRequest(request('/library', { token }))).json(), { games: [], pending: [] })
})

contractTest('PUT /account/marketing grava o consentimento e devolve a preferência', async () => {
  const token = await sessionToken()
  onRpc((fn) => (fn === 'set_marketing_consent' ? { status: 200, body: [{ outcome: 'applied', opted_in: true }] } : { status: 200, body: ACCOUNT }))
  const res = await handleRequest(request('/account/marketing', { method: 'PUT', token, body: { granted: true, source: 'cart', text_version: 'mkt-1' } }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { marketing: ACCOUNT.marketing })
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_granted: true, p_source: 'cart', p_text_version: 'mkt-1' })

  const revoke = await handleRequest(request('/account/marketing', { method: 'PUT', token, body: { granted: false, source: 'account' } }))
  assertEquals(revoke.status, 200)

  onRpc(() => ({ status: 200, body: null }))
  for (const body of [
    { granted: true, source: 'account' },
    { granted: 'sim', source: 'account', text_version: 'v1' },
    { granted: true, source: 'brevo_webhook', text_version: 'v1' },
    { granted: false, source: 'cart' },
    { granted: true, source: 'account', text_version: 'versão com espaço' },
  ]) {
    assertEquals((await handleRequest(request('/account/marketing', { method: 'PUT', token, body }))).status, 400, JSON.stringify(body))
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('POST /account/marketing/prompt registra o convite visto e devolve a preferência', async () => {
  const token = await sessionToken()
  onRpc((fn) => (fn === 'mark_marketing_prompt' ? { status: 200, body: '2026-10-08T12:00:00Z' } : { status: 200, body: ACCOUNT }))
  const res = await handleRequest(request('/account/marketing/prompt', { method: 'POST', token }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { marketing: ACCOUNT.marketing })
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['mark_marketing_prompt', { p_user_id: userId(token) }], ['get_account', { p_user_id: userId(token) }]])
})

contractTest('KT009 vira 403 EMAIL_NOT_CONFIRMED; outra falha de RPC vira 500 sem dado pessoal no log', async () => {
  const token = await sessionToken()
  onRpc(() => ({ status: 400, body: { code: 'KT009', message: 'e-mail não confirmado de teste@example.com' } }))
  const res = await handleRequest(request('/account', { token }))
  assertEquals(res.status, 403)
  assertEquals((await res.json()).error.code, 'EMAIL_NOT_CONFIRMED')

  onRpc(() => ({ status: 404, body: { code: 'PGRST202', message: 'função não encontrada; e-mail teste@example.com' } }))
  const { result, logs } = await captureErrors(async () => await handleRequest(request('/library', { token })))
  assertEquals(result.status, 500)
  assertEquals((await result.json()).error.code, 'INTERNAL_ERROR')
  assertEquals(logs.length, 1)
  assertEquals(logs[0].includes('@'), false)
  assertEquals(logs[0].includes('PGRST202'), true)
})

contractTest('router: 404, 405 com Allow e CORS com PUT e DELETE', async () => {
  onRpc(() => ({ status: 200, body: null }))
  assertEquals((await handleRequest(request('/nada'))).status, 404)
  const notAllowed = await handleRequest(request('/cart', { method: 'PUT' }))
  assertEquals(notAllowed.status, 405)
  assertEquals(notAllowed.headers.get('Allow'), 'GET, OPTIONS')
  const preflight = await handleRequest(request('/cart/items/P001', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'DELETE' } }))
  assertEquals(preflight.status, 204)
  assertEquals(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, POST, PUT, DELETE, OPTIONS')
  assertExists(preflight.headers.get('Access-Control-Allow-Origin'))
  const health = await handleRequest(request('/health'))
  assertEquals(await health.json(), { status: 'ok', service: 'api' })
})
