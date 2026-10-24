// Testes de contrato dos alertas do admin (docs/api-contract.md 6.16), sem rede e sem banco (contract-helpers).
import { assertEquals } from '@std/assert'
import { adminToken as admin, contractTest, onRpc, row, rpcCalls, send, sessionToken, userId } from './contract-helpers.ts'

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
