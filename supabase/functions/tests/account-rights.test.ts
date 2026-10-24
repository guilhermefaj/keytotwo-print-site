// Testes de contrato dos direitos do titular (docs/api-contract.md 6.11): GET /account/export e POST /account/delete,
// e o descadastro de conta já excluída. Sem rede e sem banco.
import { assertEquals } from '@std/assert'
import { authAdminCalls, captureErrors, contractTest, onAuthAdmin, onRpc, request, rpcCalls, sessionToken, userId } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { signUnsubscribeToken } from '../_shared/tokens.ts'

const EXPORT = { generated_at: '2026-10-19T12:00:00Z', account: { email: 'teste@example.com' }, orders: [], library: [], consents: [] }
const deleted = { status: 200, body: [{ outcome: 'deleted', reason: null, orders_anonymized: 2 }] }

contractTest('GET /account/export devolve a cópia dos dados da RPC, para baixar', async () => {
  const token = await sessionToken()
  onRpc(() => ({ status: 200, body: EXPORT }))
  const res = await handleRequest(request('/account/export', { token }))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), EXPORT)
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  assertEquals(rpcCalls.map((c) => [c.fn, c.args, c.secretKeyOk]), [['export_account_data', { p_user_id: userId(token) }, true]])
})

contractTest('rotas do titular exigem sessão', async () => {
  onRpc(() => ({ status: 200, body: null }))
  onAuthAdmin(() => ({ status: 200, body: {} }))
  const expired = await sessionToken({ exp: Math.floor(Date.now() / 1000) - 60 })
  for (const [path, method] of [['/account/export', 'GET'], ['/account/delete', 'POST']]) {
    for (const token of [undefined, expired]) {
      const res = await handleRequest(request(path, { method, token, body: method === 'POST' ? { confirmation: 'EXCLUIR' } : undefined }))
      assertEquals(res.status, 401, `${method} ${path}`)
    }
  }
  assertEquals([rpcCalls.length, authAdminCalls.length], [0, 0])
  const wrongMethod = await handleRequest(request('/account/delete', { token: await sessionToken() }))
  assertEquals([wrongMethod.status, wrongMethod.headers.get('Allow')], [405, 'POST, OPTIONS'])
})

contractTest('POST /account/delete exige a confirmação digitada antes de tocar no banco', async () => {
  const token = await sessionToken()
  onRpc(() => deleted)
  onAuthAdmin(() => ({ status: 200, body: {} }))
  for (const body of [{}, { confirmation: 'sim' }, { confirmation: true }, { confirmation: 'EXCLUI' }]) {
    const res = await handleRequest(request('/account/delete', { method: 'POST', token, body }))
    assertEquals(res.status, 400, JSON.stringify(body))
    assertEquals((await res.json()).error.code, 'INVALID_REQUEST')
  }
  assertEquals([rpcCalls.length, authAdminCalls.length], [0, 0])
})

contractTest('POST /account/delete: anonimiza no banco e depois apaga o usuário no Auth com a chave secreta', async () => {
  const token = await sessionToken()
  onRpc(() => deleted)
  onAuthAdmin(() => ({ status: 200, body: {} }))
  const res = await handleRequest(request('/account/delete', { method: 'POST', token, body: { confirmation: ' excluir ' } }))
  assertEquals([res.status, await res.json()], [200, { deleted: true }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['delete_account_data', { p_user_id: userId(token) }]])
  assertEquals(authAdminCalls, [{ method: 'DELETE', userId: userId(token), secretKeyOk: true }])

  // Repetição depois de o Auth já ter apagado: 404 conta como feito.
  onRpc(() => deleted)
  onAuthAdmin(() => ({ status: 404, body: {} }))
  assertEquals((await handleRequest(request('/account/delete', { method: 'POST', token, body: { confirmation: 'EXCLUIR' } }))).status, 200)
})

contractTest('POST /account/delete recusado pelo banco: 409 com o motivo e o Auth intocado', async () => {
  const token = await sessionToken()
  onAuthAdmin(() => ({ status: 200, body: {} }))
  for (const reason of ['payment_pending', 'checkout_open', 'dispute_open']) {
    onRpc(() => ({ status: 200, body: [{ outcome: 'blocked', reason, orders_anonymized: 0 }] }))
    const res = await handleRequest(request('/account/delete', { method: 'POST', token, body: { confirmation: 'EXCLUIR' } }))
    assertEquals(res.status, 409)
    const { error } = await res.json()
    assertEquals([error.code, error.details], ['ACCOUNT_DELETION_BLOCKED', { reason }])
  }
  assertEquals(authAdminCalls.length, 0)
})

contractTest('POST /account/delete: falha no Auth vira 500 sem dado pessoal no log; KT009 vira 403', async () => {
  const token = await sessionToken()
  onRpc(() => deleted)
  onAuthAdmin(() => ({ status: 500, body: { msg: 'Database error deleting user teste@example.com' } }))
  const { result, logs } = await captureErrors(async () => await handleRequest(request('/account/delete', { method: 'POST', token, body: { confirmation: 'EXCLUIR' } })))
  assertEquals(result.status, 500)
  assertEquals((await result.json()).error.code, 'INTERNAL_ERROR')
  assertEquals(logs.length, 1)
  assertEquals(logs[0].includes('@'), false)
  assertEquals(logs[0].includes(userId(token)), false)

  onRpc(() => ({ status: 400, body: { code: 'KT009' } }))
  onAuthAdmin(() => ({ status: 200, body: {} }))
  const unconfirmed = await handleRequest(request('/account/delete', { method: 'POST', token, body: { confirmation: 'EXCLUIR' } }))
  assertEquals([unconfirmed.status, (await unconfirmed.json()).error.code], [403, 'EMAIL_NOT_CONFIRMED'])
  assertEquals(authAdminCalls.length, 0)
})

contractTest('descadastro de conta já excluída responde como feito (KT001 do banco)', async () => {
  const token = await signUnsubscribeToken(crypto.randomUUID())
  onRpc(() => ({ status: 400, body: { code: 'KT001', message: 'unsubscribe: usuário sem e-mail' } }))
  const res = await handleRequest(request('/email/unsubscribe', { method: 'POST', body: { token } }))
  assertEquals([res.status, await res.json()], [200, { status: 'unsubscribed' }])

  onRpc(() => ({ status: 500, body: { code: 'XX000' } }))
  const { result } = await captureErrors(async () => await handleRequest(request('/email/unsubscribe', { method: 'POST', body: { token } })))
  assertEquals(result.status, 500)
})
