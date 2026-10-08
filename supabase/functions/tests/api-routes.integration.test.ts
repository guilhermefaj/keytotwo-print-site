// Rotas do I2b contra as RPCs reais (migrações v0.3 aplicadas no banco local). Ver integration-helpers.ts.
import { assertEquals, assertRejects } from '@std/assert'
import { createUser, enabled, passwordSession, removeTestUsers, testEmail } from './integration-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { rpc } from '../_shared/admin.ts'
import { HttpError } from '../_shared/http.ts'

async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await handleRequest(new Request(`http://localhost/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
  return { status: res.status, body: await res.json() }
}

Deno.test({
  name: 'integração: catálogo, carrinho isolado, conta, marketing, biblioteca e KT009',
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const password = `Senha${crypto.randomUUID().slice(0, 8)}1`
    const emailA = testEmail('rotas-a')
    const emailB = testEmail('rotas-b')
    await createUser(emailA, { password })
    await createUser(emailB, { password })
    const tokenA = await passwordSession(emailA, password)
    const tokenB = await passwordSession(emailB, password)

    try {
      await t.step('GET /catalog lista o P001 do seed, sem stripe_price_id', async () => {
        const { status, body } = await call('/catalog')
        assertEquals(status, 200)
        const p001 = body.products.find((p: { code: string }) => p.code === 'P001')
        assertEquals(Boolean(p001), true)
        assertEquals('stripe_price_id' in p001, false)
      })

      let version = 0
      await t.step('carrinho: vazio, adiciona, repete sem mudar, isolado de outra conta, remove', async () => {
        const empty = await call('/cart', tokenA)
        assertEquals([empty.status, empty.body.items.length], [200, 0])
        const added = await call('/cart/items', tokenA, 'POST', { product_code: 'P001' })
        assertEquals(added.status, 200)
        assertEquals(added.body.items.map((i: { code: string }) => i.code), ['P001'])
        version = added.body.version
        const again = await call('/cart/items', tokenA, 'POST', { product_code: 'P001' })
        assertEquals([again.status, again.body.version, again.body.items.length], [200, version, 1])
        const other = await call('/cart', tokenB)
        assertEquals(other.body.items.length, 0)
        const unknown = await call('/cart/items', tokenA, 'POST', { product_code: 'ZZZ999' })
        assertEquals([unknown.status, unknown.body.error.code], [409, 'PRODUCT_UNAVAILABLE'])
        const removed = await call('/cart/items/P001', tokenA, 'DELETE')
        assertEquals(removed.status, 200)
        assertEquals(removed.body.items.length, 0)
        assertEquals(removed.body.version > version, true)
      })

      await t.step('conta e marketing: concede, revoga, sem pedidos', async () => {
        const account = await call('/account', tokenA)
        assertEquals([account.status, account.body.email, account.body.orders.length, account.body.marketing.opted_in], [200, emailA, 0, false])
        const granted = await call('/account/marketing', tokenA, 'PUT', { granted: true, source: 'account', text_version: 'mkt-teste-1' })
        assertEquals([granted.status, granted.body.marketing.opted_in, granted.body.marketing.text_version], [200, true, 'mkt-teste-1'])
        const revoked = await call('/account/marketing', tokenA, 'PUT', { granted: false, source: 'account' })
        assertEquals([revoked.status, revoked.body.marketing.opted_in], [200, false])
      })

      await t.step('convite pós-login: prompted_at nulo, gravado ao dispensar e mantido na repetição', async () => {
        const before = await call('/account', tokenB)
        assertEquals(before.body.marketing.prompted_at, null)
        const first = await call('/account/marketing/prompt', tokenB, 'POST')
        assertEquals(first.status, 200)
        assertEquals(typeof first.body.marketing.prompted_at, 'string')
        assertEquals(first.body.marketing.opted_in, false)
        const second = await call('/account/marketing/prompt', tokenB, 'POST')
        assertEquals(second.body.marketing.prompted_at, first.body.marketing.prompted_at)
      })

      await t.step('GET /library de conta sem compras', async () => {
        const { status, body } = await call('/library', tokenA)
        assertEquals([status, body], [200, { games: [], pending: [] }])
      })

      await t.step('RPC com usuário sem e-mail confirmado: KT009 vira 403', async () => {
        const unconfirmed = await createUser(testEmail('nao-confirmado'), { password, confirmed: false })
        const error = await assertRejects(() => rpc('get_cart', { p_user_id: unconfirmed }), HttpError)
        assertEquals([error.status, error.code], [403, 'EMAIL_NOT_CONFIRMED'])
      })
    } finally {
      const cleanup = await removeTestUsers()
      console.log(`usuários de teste removidos: ${cleanup.removed}; mantidos pelo banco: ${cleanup.kept}`)
    }
  },
})
