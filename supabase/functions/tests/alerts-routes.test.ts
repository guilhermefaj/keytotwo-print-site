// Testes de contrato dos alertas do admin (docs/api-contract.md 6.16), sem rede e sem banco (contract-helpers).
import { assertEquals } from '@std/assert'
import { adminToken as admin, contractTest, externalCalls, ok, onExternal, onPrice, onRpc, onSite, PLUNK_URL, request, row, rpcCalls, SECRET_KEY, send, sessionToken, userId } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'

contractTest('alertas: sem sessão 401; sem o segundo fator 403 MFA_REQUIRED, antes do banco', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const aal1 = await sessionToken({ aal: 'aal1' })
  for (const [path, method] of [['/admin/alerts', 'GET'], ['/admin/alerts/7/resolve', 'POST']] as const) {
    const body = method === 'GET' ? undefined : {}
    assertEquals((await send(path, { method, body })).body.error.code, 'UNAUTHENTICATED', `${method} ${path}`)
    const res = await send(path, { method, token: aal1, body })
    assertEquals([res.status, res.body.error.code], [403, 'MFA_REQUIRED'], `${method} ${path}`)
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /admin/alerts: abertos e resolvidos do banco; não admin 403', async () => {
  const token = await admin()
  const alerts = { open: [{ id: 7, kind: 'dispute' }], resolved: [] }
  onRpc(() => row({ outcome: 'ok', alerts }))
  const res = await send('/admin/alerts', { token })
  assertEquals([res.status, res.body], [200, alerts])
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['admin_list_alerts', { p_user_id: userId(token) }]])
  onRpc(() => row({ outcome: 'forbidden', alerts: null }))
  assertEquals((await send('/admin/alerts', { token })).body.error.code, 'NOT_ADMIN')
})

contractTest('POST /admin/alerts/:id/resolve: motivo e id conferidos antes do banco; 404, 409 e ok', async () => {
  const token = await admin()
  onRpc(() => row({ outcome: 'ok' }))
  for (const [path, reason] of [['/admin/alerts/0/resolve', 'Conferido'], ['/admin/alerts/abc/resolve', 'Conferido'], ['/admin/alerts/7/resolve', 'a']]) {
    const res = await send(path, { method: 'POST', token, body: { reason } })
    assertEquals(res.status, path.includes('/7/') ? 400 : 404, path)
  }
  assertEquals(rpcCalls.length, 0)

  const res = await send('/admin/alerts/7/resolve', { method: 'POST', token, body: { reason: '  Conferido na Stripe  ' } })
  assertEquals([res.status, res.body], [200, { resolved: true }])
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_alert_id: 7, p_reason: 'Conferido na Stripe' })

  onRpc(() => row({ outcome: 'not_found' }))
  assertEquals((await send('/admin/alerts/7/resolve', { method: 'POST', token, body: { reason: 'Conferido' } })).status, 404)
  onRpc(() => row({ outcome: 'not_resolvable' }))
  const conflict = await send('/admin/alerts/7/resolve', { method: 'POST', token, body: { reason: 'Conferido' } })
  assertEquals([conflict.status, conflict.body.error.code], [409, 'ALERT_NOT_RESOLVABLE'])
})

contractTest('POST /internal/uptime (2026-10-26): só com a chave do despacho; grava se o site abre e se a loja tem preço', async () => {
  const product = (code: string, price: string | null) => ({ code, kind: 'single', name: code, stripe_price_id: price, list_price: null, games: [] })
  let catalog = [product('P001', 'price_ok'), product('J001', 'price_ok')]
  onRpc((fn) => (fn === 'get_catalog' ? ok(catalog) : ok(null)))
  onPrice((id) => (id === 'price_fora' ? { status: 404, body: {} } : { status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl' } }))
  const run = async (apikey = SECRET_KEY) => {
    rpcCalls.length = 0
    const res = await handleRequest(request('/internal/uptime', { method: 'POST', body: {}, headers: { apikey } }))
    return [res.status, rpcCalls.find((c) => c.fn === 'record_uptime_checks')?.args.p_checks]
  }
  assertEquals(await run('outra'), [401, undefined])
  assertEquals(rpcCalls.length, 0)

  onSite(() => ({ status: 200, body: '<title>KeyToTwo</title>' }))
  assertEquals(await run(), [200, [{ target: 'site', ok: true }, { target: 'store', ok: true }]])

  // fora do ar: o site com erro, sem o nome da loja ou sem conexão; a loja com produto sem preço ou vazia
  onSite(() => ({ status: 502, body: 'Bad Gateway' }))
  catalog = [product('P001', 'price_ok'), product('J001', 'price_fora'), product('J002', null)]
  assertEquals(await run(), [200, [{ target: 'site', ok: false, error: 'HTTP 502' }, { target: 'store', ok: false, error: 'sem preço: J001, J002' }]])
  onSite(() => ({ status: 200, body: '<title>Hostinger</title>' }))
  catalog = []
  assertEquals(await run(), [200, [{ target: 'site', ok: false, error: 'a página veio sem o nome da loja' }, { target: 'store', ok: false, error: 'nenhum produto à venda' }]])
  onSite(() => { throw new TypeError('error sending request') })
  assertEquals((await run())[1], [{ target: 'site', ok: false, error: 'sem conexão' }, { target: 'store', ok: false, error: 'nenhum produto à venda' }])
  onSite(() => { throw new DOMException('Signal timed out.', 'TimeoutError') })
  assertEquals(((await run())[1] as unknown[])[0], { target: 'site', ok: false, error: 'não respondeu em 10 segundos' })
  onSite(() => ({ status: 200, body: '<title>KeyToTwo</title>' }))
})

contractTest('POST /internal/uptime: no modo plunk confere também o Plunk (2026-11-01), sem a chave dele', async () => {
  const product = (code: string) => ({ code, kind: 'single', name: code, stripe_price_id: 'price_ok', list_price: null, games: [] })
  onRpc((fn) => (fn === 'get_catalog' ? ok([product('P001')]) : ok(null)))
  onPrice((id) => ({ status: 200, body: { id, active: true, unit_amount: 1990, currency: 'brl' } }))
  onSite(() => ({ status: 200, body: '<title>KeyToTwo</title>' }))
  const plunk = async () => {
    rpcCalls.length = 0
    await handleRequest(request('/internal/uptime', { method: 'POST', body: {}, headers: { apikey: SECRET_KEY } }))
    return (rpcCalls.find((c) => c.fn === 'record_uptime_checks')?.args.p_checks as Record<string, unknown>[]).find((c) => c.target === 'plunk')
  }
  // fora do modo plunk, o Plunk não entra
  assertEquals(await plunk(), undefined)

  Deno.env.set('EMAIL_MODE', 'plunk')
  Deno.env.set('PLUNK_API_URL', PLUNK_URL)
  try {
    const notFound = { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Contact not found', statusCode: 404 } }
    onExternal(() => ({ status: 404, body: notFound }))
    assertEquals(await plunk(), { target: 'plunk', ok: true })
    assertEquals([externalCalls[0].method, externalCalls[0].url, externalCalls[0].headers.has('Authorization')],
      ['GET', `${PLUNK_URL}/contacts/public/00000000-0000-0000-0000-000000000000`, false])
    // o proxy sem o Plunk atrás, outra rota que respondeu 404, ou sem conexão
    onExternal(() => ({ status: 502, body: {} }))
    assertEquals(await plunk(), { target: 'plunk', ok: false, error: 'HTTP 502' })
    onExternal(() => ({ status: 404, body: { success: false, error: { message: 'Unknown route' } } }))
    assertEquals(await plunk(), { target: 'plunk', ok: false, error: 'a API respondeu sem procurar o contato' })
    onExternal(() => { throw new TypeError('error sending request') })
    assertEquals(await plunk(), { target: 'plunk', ok: false, error: 'sem conexão' })
  } finally {
    Deno.env.delete('PLUNK_API_URL')
    Deno.env.set('EMAIL_MODE', 'log')
  }
})
