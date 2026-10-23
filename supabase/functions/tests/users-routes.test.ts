// Testes de contrato da gestão de usuários no admin (docs/api-contract.md 6.14), sem rede e sem banco.
import { assertEquals } from '@std/assert'
import { setBackgroundRunner } from '../_shared/background.ts'
import { authAdminCalls, contractTest, onAuthAdmin, onRpc, request, rpcCalls, sessionToken, userId } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'

const TARGET = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const ENT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const ORDER = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'
const OUTBOX = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'
const admin = () => sessionToken({ aal: 'aal2' })
const send = async (path: string, options: { method?: string; token?: string; body?: unknown }) => {
  const res = await handleRequest(request(path, options))
  return { status: res.status, headers: res.headers, body: await res.json() }
}
const base = `/admin/users/${TARGET}`

contractTest('usuários no admin: sem sessão 401; sem o segundo fator 403 MFA_REQUIRED, antes do banco', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const aal1 = await sessionToken({ aal: 'aal1' })
  const routes: [string, string][] = [
    ['/admin/users', 'GET'], [base, 'GET'], [`${base}/gifts`, 'POST'], [`${base}/entitlements/${ENT}/revoke`, 'POST'],
    [`${base}/orders/${ORDER}/resend`, 'POST'], [`${base}/newsletter/off`, 'POST'], [`${base}/block`, 'POST'], [`${base}/unblock`, 'POST'],
    [`${base}/export`, 'GET'], [`${base}/delete`, 'POST'],
  ]
  for (const [path, method] of routes) {
    const body = method === 'GET' ? undefined : {}
    assertEquals((await send(path, { method, body })).body.error.code, 'UNAUTHENTICATED', `${method} ${path}`)
    const res = await send(path, { method, token: aal1, body })
    assertEquals([res.status, res.body.error.code], [403, 'MFA_REQUIRED'], `${method} ${path}`)
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /admin/users: busca, filtro e página viram o offset; inválidos 400 sem banco; não admin 403', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', result: { total: 1, offset: 50, limit: 50, users: [{ id: TARGET }] } }] }))
  const res = await send('/admin/users?q=%20ana%40%20&filter=buyers&page=2', { token })
  assertEquals([res.status, res.body], [200, { total: 1, offset: 50, limit: 50, users: [{ id: TARGET }], page: 2 }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['admin_list_users', { p_user_id: userId(token), p_query: 'ana@', p_filter: 'buyers', p_offset: 50 }]])
  await send('/admin/users', { token })
  assertEquals(rpcCalls[1].args, { p_user_id: userId(token), p_query: null, p_filter: 'all', p_offset: 0 })
  for (const query of ['filter=todos', 'page=0', 'page=1.5', `q=${'a'.repeat(201)}`]) {
    assertEquals((await send(`/admin/users?${query}`, { token })).status, 400, query)
  }
  assertEquals(rpcCalls.length, 2)
  onRpc(() => ({ status: 200, body: [{ outcome: 'forbidden', result: null }] }))
  assertEquals((await send('/admin/users', { token })).body.error.code, 'NOT_ADMIN')
})

contractTest('GET /admin/users/:id: a ficha do banco; id inválido ou conta apagada 404', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', result: { account: { id: TARGET } } }] }))
  assertEquals((await send(base, { token })).body, { account: { id: TARGET } })
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_target: TARGET })
  assertEquals((await send('/admin/users/nao-e-id', { token })).status, 404)
  onRpc(() => ({ status: 200, body: [{ outcome: 'not_found', result: null }] }))
  const gone = await send(base, { token })
  assertEquals([gone.status, gone.body.error.message], [404, 'Conta não encontrada. Ela pode ter sido excluída.'])
})

contractTest('POST gifts: presente com motivo e o modo da Stripe; com aviso, o e-mail sai na hora; recusas viram 409', async () => {
  const token = await admin()
  const tasks: Promise<unknown>[] = []
  setBackgroundRunner((task) => tasks.push(task))
  try {
    onRpc((fn) => ({ status: 200, body: fn === 'claim_email_batch' ? [] : [{ outcome: 'ok', order_id: ORDER, outbox_id: OUTBOX }] }))
    const res = await send(`${base}/gifts`, { method: 'POST', token, body: { product_code: 'J001', reason: '  Compensação  ', notify: true } })
    assertEquals([res.status, res.body], [201, { order_id: ORDER, email_queued: true }])
    await Promise.all(tasks)
    assertEquals(rpcCalls.map((c) => c.fn), ['admin_gift_product', 'claim_email_batch'])
    assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_target: TARGET, p_product_code: 'J001', p_reason: 'Compensação', p_notify: true, p_livemode: false })
    assertEquals(rpcCalls[1].args, { p_limit: 20, p_outbox_id: OUTBOX })

    onRpc(() => ({ status: 200, body: [{ outcome: 'ok', order_id: ORDER, outbox_id: null }] }))
    tasks.length = 0
    assertEquals((await send(`${base}/gifts`, { method: 'POST', token, body: { product_code: 'J001', reason: 'Sem aviso', notify: false } })).body.email_queued, false)
    assertEquals(tasks.length, 0)
  } finally {
    setBackgroundRunner(null)
  }

  const bad: [unknown, string][] = [
    [{ reason: 'Motivo', notify: true }, 'Escolha o jogo do presente.'],
    [{ product_code: 'j001', reason: 'Motivo', notify: true }, 'Escolha o jogo do presente.'],
    [{ product_code: 'J001', reason: 'Motivo' }, 'Diga se a pessoa recebe o e-mail do presente.'],
    [{ product_code: 'J001', reason: ' oi ', notify: true }, 'Escreva o motivo, de 3 a 300 caracteres.'],
  ]
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok' }] }))
  for (const [body, message] of bad) {
    const res = await send(`${base}/gifts`, { method: 'POST', token, body })
    assertEquals([res.status, res.body.error.message], [400, message], JSON.stringify(body))
  }
  assertEquals(rpcCalls.length, 0)
  for (const [outcome, code] of [['product_unavailable', 'PRODUCT_UNAVAILABLE'], ['already_owned', 'ALREADY_OWNED'], ['not_found', 'NOT_FOUND'], ['forbidden', 'NOT_ADMIN']]) {
    onRpc(() => ({ status: 200, body: [{ outcome, order_id: null, outbox_id: null }] }))
    assertEquals((await send(`${base}/gifts`, { method: 'POST', token, body: { product_code: 'J001', reason: 'Motivo', notify: true } })).body.error.code, code, outcome)
  }
})

contractTest('retirar jogo, reenviar acesso e tirar das novidades: o banco decide, cada recusa com o seu código', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok' }] }))
  assertEquals((await send(`${base}/entitlements/${ENT}/revoke`, { method: 'POST', token, body: { reason: 'Engano' } })).body, { revoked: true })
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_target: TARGET, p_entitlement_id: ENT, p_reason: 'Engano' })
  assertEquals((await send(`${base}/entitlements/x/revoke`, { method: 'POST', token, body: { reason: 'Engano' } })).body.error.message, 'Jogo não encontrado nesta conta.')
  for (const [outcome, status, code] of [['protected', 409, 'PROTECTED_ACCOUNT'], ['not_active', 409, 'ALREADY_REVOKED'], ['not_found', 404, 'NOT_FOUND']] as const) {
    onRpc(() => ({ status: 200, body: [{ outcome }] }))
    const res = await send(`${base}/entitlements/${ENT}/revoke`, { method: 'POST', token, body: { reason: 'Engano' } })
    assertEquals([res.status, res.body.error.code], [status, code], outcome)
  }

  setBackgroundRunner(() => {})
  try {
    onRpc(() => ({ status: 200, body: [{ outcome: 'ok', outbox_id: OUTBOX }] }))
    const resent = await send(`${base}/orders/${ORDER}/resend`, { method: 'POST', token })
    assertEquals([resent.status, resent.body], [202, { queued: true }])
    assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_target: TARGET, p_order_id: ORDER })
  } finally {
    setBackgroundRunner(null)
  }
  for (const [outcome, code] of [['not_deliverable', 'ORDER_NOT_DELIVERABLE'], ['already_queued', 'EMAIL_ALREADY_QUEUED']]) {
    onRpc(() => ({ status: 200, body: [{ outcome, outbox_id: null }] }))
    assertEquals((await send(`${base}/orders/${ORDER}/resend`, { method: 'POST', token })).body.error.code, code, outcome)
  }

  onRpc(() => ({ status: 200, body: [{ outcome: 'ok' }] }))
  assertEquals((await send(`${base}/newsletter/off`, { method: 'POST', token, body: { reason: 'Pediu por e-mail' } })).body, { newsletter: false })
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['admin_newsletter_off', { p_user_id: userId(token), p_target: TARGET, p_reason: 'Pediu por e-mail' }]])
  onRpc(() => ({ status: 200, body: [{ outcome: 'not_subscribed' }] }))
  assertEquals((await send(`${base}/newsletter/off`, { method: 'POST', token, body: { reason: 'Pediu por e-mail' } })).body.error.code, 'NOT_SUBSCRIBED')
})

contractTest('bloquear e desbloquear: o banco confere, o Auth troca o bloqueio com a chave secreta e o histórico registra depois', async () => {
  const token = await admin()
  onAuthAdmin(() => ({ status: 200, body: {} }))
  onRpc((fn) => ({ status: 200, body: [fn === 'admin_check_user_block' ? { outcome: 'ok', blocked: false } : { outcome: 'ok' }] }))
  const blocked = await send(`${base}/block`, { method: 'POST', token, body: { reason: 'Abuso no cupom' } })
  assertEquals([blocked.status, blocked.body], [200, { blocked: true }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [
    ['admin_check_user_block', { p_user_id: userId(token), p_target: TARGET }],
    ['admin_log_user_block', { p_user_id: userId(token), p_target: TARGET, p_blocked: true, p_reason: 'Abuso no cupom' }],
  ])
  assertEquals(authAdminCalls, [{ method: 'PUT', userId: TARGET, secretKeyOk: true, body: { ban_duration: '876000h' } }])

  onAuthAdmin(() => ({ status: 200, body: {} }))
  onRpc((fn) => ({ status: 200, body: [fn === 'admin_check_user_block' ? { outcome: 'ok', blocked: true } : { outcome: 'ok' }] }))
  assertEquals((await send(`${base}/unblock`, { method: 'POST', token, body: { reason: 'Resolvido' } })).body, { blocked: false })
  assertEquals(authAdminCalls[0].body, { ban_duration: 'none' })
  assertEquals((await send(`${base}/block`, { method: 'POST', token, body: { reason: 'De novo' } })).body.error.code, 'ALREADY_BLOCKED')

  // Admin ou a própria conta: nada no Auth. Auth fora do ar: nada no histórico.
  onAuthAdmin(() => ({ status: 200, body: {} }))
  onRpc(() => ({ status: 200, body: [{ outcome: 'protected', blocked: null }] }))
  assertEquals((await send(`${base}/block`, { method: 'POST', token, body: { reason: 'Teste' } })).body.error.code, 'PROTECTED_ACCOUNT')
  assertEquals(authAdminCalls.length, 0)
  onAuthAdmin(() => ({ status: 500, body: {} }))
  onRpc((fn) => ({ status: 200, body: [fn === 'admin_check_user_block' ? { outcome: 'ok', blocked: false } : { outcome: 'ok' }] }))
  assertEquals((await send(`${base}/block`, { method: 'POST', token, body: { reason: 'Teste' } })).status, 500)
  assertEquals(rpcCalls.map((c) => c.fn), ['admin_check_user_block'])
})

contractTest('exportar baixa a cópia dos dados; excluir confere o e-mail no banco e só então apaga no Auth', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', data: { orders: [] } }] }))
  const exported = await send(`${base}/export`, { token })
  assertEquals([exported.status, exported.body, exported.headers.get('Content-Disposition')], [200, { orders: [] }, 'attachment; filename="keytotwo-dados-7d1c2b3a.json"'])
  onRpc(() => ({ status: 200, body: [{ outcome: 'not_confirmed', data: null }] }))
  assertEquals((await send(`${base}/export`, { token })).body.error.code, 'TARGET_NOT_CONFIRMED')

  onAuthAdmin(() => ({ status: 200, body: {} }))
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok' }] }))
  for (const body of [{ confirm_email: 'ana@example.com' }, { reason: 'Pedido da pessoa' }]) {
    assertEquals((await send(`${base}/delete`, { method: 'POST', token, body })).status, 400)
  }
  assertEquals([rpcCalls.length, authAdminCalls.length], [0, 0])
  onRpc(() => ({ status: 200, body: [{ outcome: 'deleted', reason: null, orders_anonymized: 2 }] }))
  const deleted = await send(`${base}/delete`, { method: 'POST', token, body: { reason: 'Pedido da pessoa', confirm_email: 'Ana@Example.com' } })
  assertEquals([deleted.status, deleted.body], [200, { deleted: true, orders_anonymized: 2 }])
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_target: TARGET, p_reason: 'Pedido da pessoa', p_confirm_email: 'Ana@Example.com' })
  assertEquals(authAdminCalls, [{ method: 'DELETE', userId: TARGET, secretKeyOk: true }])

  const refusals: [Record<string, unknown>, number, string][] = [
    [{ outcome: 'confirmation_mismatch' }, 400, 'O e-mail digitado não é o desta conta.'],
    [{ outcome: 'blocked', reason: 'dispute_open' }, 409, 'Há uma contestação de pagamento aberta nesta conta. Tente de novo quando ela terminar.'],
    [{ outcome: 'protected' }, 409, 'Isso não vale para a sua própria conta nem para a de outro admin.'],
    [{ outcome: 'not_confirmed' }, 409, 'Esta conta nunca confirmou o e-mail: não tem compras nem dados de conta para isso.'],
  ]
  for (const [row, status, message] of refusals) {
    onAuthAdmin(() => ({ status: 200, body: {} }))
    onRpc(() => ({ status: 200, body: [{ reason: null, orders_anonymized: null, ...row }] }))
    const res = await send(`${base}/delete`, { method: 'POST', token, body: { reason: 'Pedido da pessoa', confirm_email: 'ana@example.com' } })
    assertEquals([res.status, res.body.error.message], [status, message], String(row.outcome))
    assertEquals(authAdminCalls.length, 0)
  }
})
