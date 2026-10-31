// Testes de contrato das rotas do I2b (docs/api-contract.md v0.3), sem rede e sem banco.
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assertEquals, assertExists } from '@std/assert'
import { captureErrors, onPrice, onRpc, onSalesOpening, request, rpcCalls, sessionToken, usageCalls, userId, contractTest } from './contract-helpers.ts'
import { apiArea } from '../_shared/usage.ts'
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

// Chamadas ao banco sem as do cache de preços (get_stripe_prices / remember_stripe_prices).
const domainCalls = () => rpcCalls.filter((c) => !c.fn.endsWith('_stripe_prices'))

function cartItem(code: string, extra: Record<string, unknown> = {}) {
  return { code, kind: 'bundle', name: `Produto ${code}`, stripe_price_id: `price_${code}`, games: [GAME], status: 'ok', available: true, owned_games: [], included_in: [], shared_with: [], ...extra }
}

onPrice((id) => (id === 'price_fora' ? { status: 404, body: {} } : { status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl' } }))

contractTest('GET /catalog é pública, lê preço da Stripe e não expõe o stripe_price_id; leva a faixa do topo', async () => {
  const BANNER = { code: 'BLACK26', text: 'Black Friday: 30% com {cupom}' }
  onRpc((fn) => ({ status: 200, body: fn === 'get_promo_banner' ? BANNER : CATALOG }))
  const res = await handleRequest(request('/catalog'))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Cache-Control'), 'public, max-age=60')
  const body = await res.json()
  assertEquals(body.products.map((p: { price: unknown }) => p.price), [{ unit_amount: 1990, currency: 'brl' }, null])
  assertEquals(body.products.some((p: Record<string, unknown>) => 'stripe_price_id' in p), false)
  assertEquals(body.banner, BANNER)
  assertEquals(domainCalls().map((c) => c.fn), ['get_catalog', 'get_promo_banner'])
  assertEquals(rpcCalls[0].secretKeyOk && !rpcCalls[0].hasAuthorization, true)
  assertEquals(body.sales_open_at, null)
})

contractTest('GET /catalog: na prévia do lançamento leva a hora da abertura das vendas', async () => {
  onRpc((fn) => ({ status: 200, body: fn === 'get_promo_banner' ? null : CATALOG }))
  onSalesOpening('2026-11-09T22:00:00+00:00')
  const body = await (await handleRequest(request('/catalog'))).json()
  assertEquals([body.sales_open_at, body.products.length], ['2026-11-09T22:00:00.000Z', 2])
})

contractTest('preços: vêm do banco sem ir à Stripe; o que falta vem da Stripe e fica guardado', async () => {
  const fetched: string[] = []
  onPrice((id) => { fetched.push(id); return { status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl', product: 'prod_guardado_B' } } })
  onRpc((fn) => fn === 'get_stripe_prices'
    ? { status: 200, body: [{ price_id: 'price_guardado_A', unit_amount: 4590, currency: 'brl', product: 'prod_guardado_A', active: true, fetched_at: new Date().toISOString() }] }
    : fn === 'remember_stripe_prices' ? { status: 200, body: 1 }
      : fn === 'get_promo_banner' ? { status: 200, body: null }
        : { status: 200, body: [{ ...CATALOG[0], stripe_price_id: 'price_guardado_A' }, { ...CATALOG[1], stripe_price_id: 'price_guardado_B' }] })
  const body = await (await handleRequest(request('/catalog'))).json()
  assertEquals(body.products.map((p: { price: { unit_amount: number } }) => p.price.unit_amount), [4590, 1990])
  assertEquals(fetched, ['price_guardado_B'])
  assertEquals(rpcCalls.map((c) => c.fn), ['get_catalog', 'get_promo_banner', 'get_stripe_prices', 'remember_stripe_prices'])
  assertEquals(rpcCalls[2].args, { p_price_ids: ['price_guardado_A', 'price_guardado_B'] })
  assertEquals(rpcCalls[3].args, { p_prices: [{ price_id: 'price_guardado_B', unit_amount: 1990, currency: 'brl', product: 'prod_guardado_B', active: true }] })
  // Na mesma instância, os dois ficam em memória: nem banco nem Stripe na próxima chamada.
  await handleRequest(request('/catalog'))
  assertEquals([rpcCalls.map((c) => c.fn).filter((fn) => fn.endsWith('_stripe_prices')).length, fetched.length], [2, 1])
  onPrice((id) => (id === 'price_fora' ? { status: 404, body: {} } : { status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl' } }))
})

contractTest('rotas privadas recusam sem sessão, sessão vencida e papel errado', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const expired = await sessionToken({ exp: Math.floor(Date.now() / 1000) - 60 })
  const anon = await sessionToken({ role: 'anon' })
  for (const [path, method] of [['/cart', 'GET'], ['/cart/items', 'POST'], ['/cart/items/P001', 'DELETE'], ['/cart/merge', 'POST'], ['/account', 'GET'], ['/account/marketing', 'PUT'], ['/library', 'GET'], ['/free-download', 'POST'], ['/admin/metrics', 'GET']]) {
    for (const token of [undefined, expired, anon, 'lixo.lixo.lixo']) {
      const res = await handleRequest(request(path, { method, token, body: method === 'GET' || method === 'DELETE' ? undefined : {} }))
      assertEquals(res.status, 401, `${method} ${path}`)
      assertEquals((await res.json()).error.code, 'UNAUTHENTICATED')
    }
  }
  assertEquals(rpcCalls.length, 0)
})

// Preços do "completar a coleção": ids próprios, porque o cache de Price da Stripe dura entre os testes.
const SET_PRICES: Record<string, number> = { price_set_P001: 2990, price_set_J001: 990, price_set_J002: 1290, price_set_A002: 990 }
function setPrices() {
  onPrice((id) => (id in SET_PRICES
    ? { status: 200, body: { id, active: true, unit_amount: SET_PRICES[id], currency: 'brl', product: `prod_${id.slice(10)}` } }
    : id === 'price_fora' ? { status: 404, body: {} } : { status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl' } }))
}
const SET_GAMES = [{ code: 'J001', name: 'Jogo 1 [TESTE]', single_price_id: 'price_set_J001' }, { code: 'J002', name: 'Jogo 2 [TESTE]', single_price_id: 'price_set_J002' }]

contractTest('GET /cart: completar a coleção, avulso incluído no pacote, já possuído e produtos da pessoa', async () => {
  setPrices()
  const token = await sessionToken()
  onRpc(() => ({
    status: 200,
    body: {
      version: 4,
      items: [
        cartItem('P001', { stripe_price_id: 'price_set_P001', games: SET_GAMES, owned_games: ['J001'] }),
        cartItem('A002', { kind: 'single', stripe_price_id: 'price_set_A002', status: 'included', available: false, included_in: ['P001'] }),
        cartItem('A003', { status: 'already_owned', available: false }),
        cartItem('A004', { status: 'unavailable', available: false }),
      ],
      owned_products: ['A003'],
    },
  }))
  const res = await handleRequest(request('/cart', { token }))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.version, 4)
  assertEquals(JSON.stringify(body).includes('price_set'), false)
  // 2990 × 1290 / (990 + 1290): o pacote cobra o jogo que falta com o mesmo desconto do pacote
  assertEquals(body.items.map((i: { code: string; price: unknown; charge: unknown }) => [i.code, i.price, i.charge]), [
    ['P001', { unit_amount: 2990, currency: 'brl' }, { unit_amount: 1692, currency: 'brl' }],
    ['A002', { unit_amount: 990, currency: 'brl' }, null],
    ['A003', { unit_amount: 1990, currency: 'brl' }, null],
    ['A004', { unit_amount: 1990, currency: 'brl' }, null],
  ])
  assertEquals(body.items[0].games, [{ code: 'J001', name: 'Jogo 1 [TESTE]' }, { code: 'J002', name: 'Jogo 2 [TESTE]' }])
  assertEquals(body.subtotal, { amount: 1692, currency: 'brl' })
  assertEquals(body.warnings, [
    { code: 'COMPLETE_THE_SET', product_code: 'P001' },
    { code: 'INCLUDED_IN_BUNDLE', product_code: 'A002' },
    { code: 'ALREADY_OWNED', product_code: 'A003' },
    { code: 'PRODUCT_UNAVAILABLE', product_code: 'A004' },
  ])
  assertEquals(body.owned_products, ['A003'])
  assertEquals(domainCalls(), [{ fn: 'get_cart', args: { p_user_id: userId(token) }, secretKeyOk: true, hasAuthorization: false }])
})

contractTest('GET /cart soma o subtotal dos itens a pagar e avisa preço faltando e pacotes que dividem jogos', async () => {
  const token = await sessionToken()
  onRpc(() => ({ status: 200, body: { version: 2, items: [cartItem('P001', { shared_with: ['P002'] }), cartItem('P002', { shared_with: ['P001'] })] } }))
  const ok = await (await handleRequest(request('/cart', { token }))).json()
  assertEquals(ok.subtotal, { amount: 3980, currency: 'brl' })
  assertEquals(ok.warnings, [{ code: 'PARTIAL_OVERLAP', product_code: 'P001' }, { code: 'PARTIAL_OVERLAP', product_code: 'P002' }])

  onRpc(() => ({ status: 200, body: { version: 2, items: [cartItem('P001'), cartItem('A003', { stripe_price_id: 'price_fora' })] } }))
  const missing = await (await handleRequest(request('/cart', { token }))).json()
  assertEquals([missing.subtotal, missing.warnings], [null, [{ code: 'PRICE_UNAVAILABLE', product_code: 'A003' }]])

  onRpc(() => ({ status: 200, body: null }))
  assertEquals(await (await handleRequest(request('/cart', { token }))).json(), { version: 0, items: [], subtotal: null, warnings: [], owned_products: [] })
})

contractTest('POST /cart/items adiciona (até o já possuído) e mapeia product_unavailable', async () => {
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
  onRpc(reply('product_unavailable'))
  const res = await handleRequest(request('/cart/items', { method: 'POST', token, body: { product_code: 'P001' } }))
  assertEquals(res.status, 409)
  const { error } = await res.json()
  assertEquals([error.code, error.details], ['PRODUCT_UNAVAILABLE', { product_codes: ['P001'] }])
  assertEquals(rpcCalls.map((c) => c.fn), ['cart_add'])
})

contractTest('POST /cart/quote é pública: mesmas regras e preços, códigos desconhecidos à parte', async () => {
  setPrices()
  onRpc(() => ({
    status: 200,
    body: {
      items: [
        cartItem('P001', { stripe_price_id: 'price_set_P001', games: SET_GAMES }),
        cartItem('A002', { kind: 'single', stripe_price_id: 'price_set_A002', status: 'included', available: false, included_in: ['P001'] }),
      ],
      unknown: ['X999'],
    },
  }))
  const res = await handleRequest(request('/cart/quote', { method: 'POST', body: { product_codes: ['P001', 'A002', 'X999', 'P001'] } }))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals([body.version, body.subtotal, body.unknown], [0, { amount: 2990, currency: 'brl' }, ['X999']])
  assertEquals(body.items.map((i: { code: string; status: string; charge: unknown }) => [i.code, i.status, i.charge]),
    [['P001', 'ok', { unit_amount: 2990, currency: 'brl' }], ['A002', 'included', null]])
  assertEquals('owned_products' in body, false)
  assertEquals(rpcCalls, [{ fn: 'quote_cart', args: { p_product_codes: ['P001', 'A002', 'X999'] }, secretKeyOk: true, hasAuthorization: false }])

  onRpc(() => ({ status: 200, body: { items: [], unknown: [] } }))
  for (const body of [{}, { product_codes: 'P001' }, { product_codes: ['p001'] }, { product_codes: Array.from({ length: 21 }, (_, i) => `P${100 + i}`) }]) {
    const bad = await handleRequest(request('/cart/quote', { method: 'POST', body }))
    assertEquals(bad.status, 400, JSON.stringify(body))
    assertEquals((await bad.json()).error.code, 'INVALID_REQUEST')
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('POST /cart/merge junta a sacola do navegador à da conta, na ordem, e devolve a da conta', async () => {
  const token = await sessionToken()
  onRpc((fn, args) => fn === 'cart_add'
    ? { status: 200, body: [{ outcome: args.p_product_code === 'A002' ? 'product_unavailable' : 'added', cart_version: 1, owned_games: [] }] }
    : { status: 200, body: { version: 2, items: [cartItem('P001')], owned_products: [] } })
  const res = await handleRequest(request('/cart/merge', { method: 'POST', token, body: { product_codes: ['P001', 'A002', 'P001'] } }))
  assertEquals(res.status, 200)
  assertEquals((await res.json()).version, 2)
  assertEquals(rpcCalls.map((c) => [c.fn, c.args.p_product_code ?? null]), [['cart_add', 'P001'], ['cart_add', 'A002'], ['get_cart', null]])
  assertEquals(rpcCalls.every((c) => c.args.p_user_id === userId(token)), true)
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
  const res = await handleRequest(request('/account/marketing', { method: 'PUT', token, body: { granted: true, source: 'signup_prompt', text_version: 'mkt-1' } }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { marketing: ACCOUNT.marketing })
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_granted: true, p_source: 'signup_prompt', p_text_version: 'mkt-1' })

  const revoke = await handleRequest(request('/account/marketing', { method: 'PUT', token, body: { granted: false, source: 'account' } }))
  assertEquals(revoke.status, 200)

  onRpc(() => ({ status: 200, body: null }))
  for (const body of [
    { granted: true, source: 'account' },
    { granted: 'sim', source: 'account', text_version: 'v1' },
    { granted: true, source: 'brevo_webhook', text_version: 'v1' },
    { granted: false, source: 'signup_prompt' },
    // 'cart' saiu em 2026-10-24: nenhuma tela do site pede o consentimento na sacola.
    { granted: true, source: 'cart', text_version: 'v1' },
    { granted: false, source: 'free_games' },
    { granted: true, source: 'account', text_version: 'versão com espaço' },
  ]) {
    assertEquals((await handleRequest(request('/account/marketing', { method: 'PUT', token, body }))).status, 400, JSON.stringify(body))
  }
  assertEquals(rpcCalls.length, 0)
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

contractTest('GET /admin/metrics: período 7 ou 30, modo da chave da Stripe, com cupons, parceiros e o uso; 403 sem segundo fator ou sem admin', async () => {
  const token = await sessionToken({ aal: 'aal2' })
  const METRICS = { days: 30, sales: { orders: 2, revenue: 1980, currency: 'brl' }, daily: [] }
  const MARKETING = { codes: [{ code: 'ANA10', orders: 1 }], partners: [], campaigns: [] }
  const USAGE = { calls_month: 1234, by_area: { public: 1000 }, daily: [], peak_hour: null, database_bytes: 4096, active_accounts_month: 3 }
  const PRODUCTS = [{ code: 'P001', name: 'Coleção', kind: 'bundle', orders: 2, amount: 5980 }]
  // A série do dobro do período: os 30 primeiros dias (os de antes do período) somam 3 pedidos, R$ 30 e 4 contas.
  const DOUBLED = { ...METRICS, daily: Array.from({ length: 60 }, (_, i) => (i < 30 ? { orders: i < 3 ? 1 : 0, revenue: i < 3 ? 1000 : 0, accounts: i < 4 ? 1 : 0 } : { orders: 9, revenue: 9999, accounts: 9 })) }
  onRpc((fn, args) => ({ status: 200, body: [fn === 'admin_marketing_metrics' ? { outcome: 'ok', result: MARKETING } : fn === 'admin_usage_metrics' ? { outcome: 'ok', result: USAGE }
    : fn === 'admin_product_sales' ? { outcome: 'ok', result: PRODUCTS } : { outcome: 'ok', metrics: args.p_days === 60 ? DOUBLED : METRICS }] }))
  const res = await handleRequest(request('/admin/metrics?days=30', { token }))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  assertEquals(await res.json(), { ...METRICS, marketing: MARKETING, usage: USAGE, top_products: PRODUCTS, previous: { orders: 3, revenue: 3000, accounts: 4 } })
  const args = { p_user_id: userId(token), p_days: 30, p_livemode: false }
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['get_admin_metrics', args], ['admin_marketing_metrics', args], ['admin_usage_metrics', { p_user_id: userId(token), p_days: 30 }],
    ['admin_product_sales', args], ['get_admin_metrics', { ...args, p_days: 60 }]])
  assertEquals((await handleRequest(request('/admin/metrics', { token }))).status, 200)
  assertEquals(rpcCalls[5].args.p_days, 7)

  for (const days of ['0', '14', '366', 'sete', '']) {
    const invalid = await handleRequest(request(`/admin/metrics?days=${days}`, { token }))
    assertEquals(invalid.status, 400, days)
    assertEquals((await invalid.json()).error.code, 'INVALID_REQUEST')
  }
  assertEquals(rpcCalls.length, 10)

  // Sessão só com o primeiro fator (aal1), mesmo de admin, ou com o código do app confirmado há mais de 12 horas (ou sem
  // ele no amr): nem chega ao banco.
  const hours = (n: number) => Math.floor(Date.now() / 1000) - n * 3600
  for (const claims of [{}, { aal: 'aal1' }, { aal: 'aal2', amr: [{ method: 'totp', timestamp: hours(12.1) }] }, { aal: 'aal2', amr: [{ method: 'otp', timestamp: hours(0) }] }, { aal: 'aal2', amr: 'totp' }]) {
    const single = await handleRequest(request('/admin/metrics?days=7', { token: await sessionToken(claims) }))
    assertEquals(single.status, 403)
    assertEquals((await single.json()).error.code, 'MFA_REQUIRED')
  }
  assertEquals(rpcCalls.length, 10)
  const recent = await sessionToken({ aal: 'aal2', amr: [{ method: 'totp', timestamp: hours(11.9) }, { method: 'totp', timestamp: hours(30) }] })
  assertEquals((await handleRequest(request('/admin/metrics?days=7', { token: recent }))).status, 200)
  assertEquals(rpcCalls.length, 15)
  // Toda chamada conta no uso, inclusive as recusadas (período inválido, sem o segundo fator).
  await new Promise((resolve) => setTimeout(resolve, 0))
  assertEquals(usageCalls.length, 13)
  assertEquals(new Set(usageCalls), new Set(['admin']))

  onRpc(() => ({ status: 200, body: [{ outcome: 'forbidden', metrics: null, result: null }] }))
  const forbidden = await handleRequest(request('/admin/metrics?days=7', { token }))
  assertEquals(forbidden.status, 403)
  assertEquals((await forbidden.json()).error.code, 'NOT_ADMIN')
  assertEquals((await handleRequest(request('/admin/metrics', { method: 'POST', token, body: {} }))).status, 405)
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
})

contractTest('POST /csp-report (pública): só a diretiva, a origem barrada e o caminho vão para o log, nos dois formatos', async () => {
  const logs: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => logs.push(args.join(' '))
  try {
    const legacy = await handleRequest(new Request('http://localhost/api/csp-report', {
      method: 'POST', headers: { 'Content-Type': 'application/csp-report' },
      body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://keytotwo.com.br/email/preferencias?token=segredo', 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?chave=1' } }),
    }))
    const modern = await handleRequest(new Request('http://localhost/api/csp-report', {
      method: 'POST', headers: { 'Content-Type': 'application/reports+json' },
      body: JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://keytotwo.com.br/pagamento', effectiveDirective: 'script-src-elem', blockedURL: 'inline', disposition: 'enforce' } }, { type: 'deprecation', body: {} }]),
    }))
    const junk = await handleRequest(new Request('http://localhost/api/csp-report', { method: 'POST', body: 'x'.repeat(20_000) }))
    assertEquals([legacy.status, modern.status, junk.status], [204, 204, 204])
  } finally {
    console.log = original
  }
  assertEquals(logs, ['csp: barraria script-src-elem https://evil.example em /email/preferencias', 'csp: barrou script-src-elem inline em /pagamento'])
  assertEquals(rpcCalls.length, 0)
})

contractTest('uso: o tipo de cada rota da api, para o contador das Métricas', () => {
  const cases: [string, string][] = [
    ['/catalog', 'public'], ['/cart/quote', 'public'], ['/free-games', 'public'], ['/blog/posts', 'public'], ['/blog/version', 'public'],
    ['/referral/visit', 'public'], ['/csp-report', 'public'], ['/email/unsubscribe', 'public'], ['/d/abc.def', 'public'], ['/nada', 'public'], ['/', 'public'],
    ['/cart', 'account'], ['/cart/items/P001', 'account'], ['/cart/merge', 'account'], ['/account', 'account'], ['/account/export', 'account'],
    ['/library', 'account'], ['/checkout', 'account'], ['/checkout/terms', 'account'], ['/order-status', 'account'], ['/download-url', 'account'], ['/free-download', 'account'],
    ['/admin/metrics', 'admin'], ['/admin/users/x/block', 'admin'], ['/internal/discounts/tick', 'schedule'], ['/internal/uptime', 'schedule'],
  ]
  for (const [path, area] of cases) assertEquals(apiArea(path), area, path)
})
