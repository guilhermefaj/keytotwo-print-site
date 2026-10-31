// Testes de contrato do marketing no Plunk (2026-10-31, fase 4), sem rede: os contatos que o email-dispatch manda ao
// Plunk (claim_marketing_contacts → Plunk → mark_marketing_contact) e a plunk-webhook (descadastro feito no Plunk).
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assert, assertEquals } from '@std/assert'
import { captureErrors, contractTest, externalCalls, ok, onExternal, onRpc, PLUNK_URL, PLUNK_WEBHOOK_SECRET, row, rpcCalls, SECRET_KEY } from './contract-helpers.ts'
import { handleEmailDispatch } from '../email-dispatch/handler.ts'
import { handlePlunkWebhook } from '../plunk-webhook/handler.ts'

const USER = '88888888-8888-4888-8888-888888888888'
const DATA = { comprou: false, jogos: ['J001'], boas_vindas_no_lancamento: true }
const CONTACT = { user_id: USER, email: 'casal@example.com', previous_email: null, subscribed: true, push_subscribed: true, welcome: false, data: DATA }

const dispatch = async (body: Record<string, unknown> = {}) =>
  await (await handleEmailDispatch(new Request('http://localhost/email-dispatch', { method: 'POST', headers: { apikey: SECRET_KEY }, body: JSON.stringify(body) }))).json()

// claim_email_batch vazio; claim_marketing_contacts devolve as linhas; mark_marketing_contact aceita
function contactsRpc(rows: unknown[]) {
  onRpc((fn) => (fn === 'claim_marketing_contacts' ? ok(rows) : fn === 'claim_email_batch' ? ok([]) : ok('applied')))
}
const marks = () => rpcCalls.filter((c) => c.fn === 'mark_marketing_contact').map((c) => c.args)

function plunkMode(fn: () => Promise<void>) {
  return async () => {
    Deno.env.set('EMAIL_MODE', 'plunk')
    Deno.env.set('PLUNK_API_URL', PLUNK_URL)
    Deno.env.set('PLUNK_SECRET_KEY', 'sk_teste_ficticia')
    try {
      await fn()
    } finally {
      Deno.env.delete('PLUNK_API_URL')
      Deno.env.delete('PLUNK_SECRET_KEY')
      Deno.env.set('EMAIL_MODE', 'log')
    }
  }
}

contractTest('contatos: a primeira inscrição inscreve o contato e manda o evento "inscricao" (as boas-vindas) com o id dele', plunkMode(async () => {
  contactsRpc([{ ...CONTACT, welcome: true }])
  onExternal((call) => ok(call.url.endsWith('/contacts') ? { id: 'c-1', email: 'casal@example.com' } : { id: 'ev-1' }))
  const summary = await dispatch()
  assertEquals(summary.contacts, { claimed: 1, synced: 1, failed: 0 })
  assertEquals(rpcCalls[0].fn, 'claim_email_batch')
  assertEquals(rpcCalls.find((c) => c.fn === 'claim_marketing_contacts')?.args, { p_limit: 20 })
  // Tudo com a chave secreta: o /v1/track do Plunk só aceita a pública.
  assertEquals(externalCalls.map((c) => [c.url, c.method, c.headers.get('Authorization'), c.body]), [
    [`${PLUNK_URL}/contacts`, 'POST', 'Bearer sk_teste_ficticia', { email: 'casal@example.com', data: DATA, subscribed: true }],
    [`${PLUNK_URL}/events/track`, 'POST', 'Bearer sk_teste_ficticia', { name: 'inscricao', contactId: 'c-1' }],
  ])
  assertEquals(marks(), [{ p_user_id: USER, p_email: 'casal@example.com', p_subscribed: true, p_welcomed: true }])

  // Sem o id na resposta, ou com o evento recusado, fica para a próxima rodada (as boas-vindas não contam como enviadas).
  contactsRpc([{ ...CONTACT, welcome: true }])
  onExternal(() => ok({ success: true }))
  await captureErrors(dispatch)
  assertEquals([externalCalls.length, marks()[0].p_error], [1, 'plunk_contato_sem_id'])
  contactsRpc([{ ...CONTACT, welcome: true }])
  onExternal((call) => (call.url.endsWith('/contacts') ? ok({ id: 'c-1' }) : { status: 401, body: {} }))
  await captureErrors(dispatch)
  assertEquals(marks()[0].p_error, 'plunk_events_track_http_401')
}))

contractTest('contatos: atualização manda a inscrição só quando o banco pede (respeita a pausa feita no Plunk)', plunkMode(async () => {
  contactsRpc([
    { ...CONTACT, subscribed: false, push_subscribed: true },
    { ...CONTACT, push_subscribed: false },
  ])
  onExternal(() => ok({ success: true }))
  await dispatch()
  assertEquals(externalCalls.map((c) => [c.url, c.body]), [
    [`${PLUNK_URL}/contacts`, { email: 'casal@example.com', data: DATA, subscribed: false }],
    [`${PLUNK_URL}/contacts`, { email: 'casal@example.com', data: DATA }],
  ])
  assertEquals(marks().map((m) => m.p_subscribed), [false, null])
}))

contractTest('contatos: troca de e-mail apaga o contato antigo (só o endereço exato) antes de mandar o novo', plunkMode(async () => {
  contactsRpc([{ ...CONTACT, previous_email: 'antigo@example.com' }])
  onExternal((call) => call.method === 'GET'
    ? ok({ data: [{ id: 'c-outro', email: 'antigo@example.com.br' }, { id: 'c-antigo', email: 'antigo@example.com' }] })
    : ok({ success: true }))
  assertEquals((await dispatch()).contacts, { claimed: 1, synced: 1, failed: 0 })
  assertEquals(externalCalls.map((c) => `${c.method} ${c.url}`), [
    `GET ${PLUNK_URL}/contacts?search=antigo%40example.com&limit=100`,
    `DELETE ${PLUNK_URL}/contacts/c-antigo`,
    `POST ${PLUNK_URL}/contacts`,
  ])
}))

contractTest('contatos: falha do Plunk e e-mail fora da lista de teste ficam para depois, com o erro', plunkMode(async () => {
  contactsRpc([CONTACT])
  onExternal(() => ({ status: 503, body: {} }))
  const { result, logs } = await captureErrors(dispatch)
  assertEquals(result.contacts, { claimed: 1, synced: 0, failed: 1 })
  assertEquals(marks(), [{ p_user_id: USER, p_error: 'plunk_contacts_http_503' }])
  assert(logs.every((line) => !line.includes('casal@example.com')), 'o e-mail não vai para o log')

  Deno.env.set('EMAIL_ALLOWED_RECIPIENTS', 'responsavel@example.com')
  contactsRpc([CONTACT])
  onExternal(() => ok({ success: true }))
  await captureErrors(dispatch)
  assertEquals([externalCalls.length, marks()[0].p_error], [0, 'fora_da_lista_de_teste'])
  Deno.env.delete('EMAIL_ALLOWED_RECIPIENTS')
}))

contractTest('contatos: fora do modo plunk e no reenvio de um e-mail (outbox_id) a fila de contatos não roda', async () => {
  Deno.env.set('EMAIL_MODE', 'log')
  contactsRpc([CONTACT])
  assertEquals(await dispatch(), { claimed: 0, sent: 0, failed: 0, rejected: 0 })
  assert(!rpcCalls.some((c) => c.fn === 'claim_marketing_contacts'))
  await plunkMode(async () => {
    contactsRpc([CONTACT])
    assertEquals(await dispatch({ outbox_id: '99999999-9999-4999-8999-999999999999' }), { claimed: 0, sent: 0, failed: 0, rejected: 0 })
    assert(!rpcCalls.some((c) => c.fn === 'claim_marketing_contacts'))
  })()
})

// ---------- plunk-webhook ----------

const hook = (body: unknown, token: string | null = PLUNK_WEBHOOK_SECRET) =>
  handlePlunkWebhook(new Request('http://localhost/plunk-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  }))

contractTest('plunk-webhook: só com o token; descadastro vai para record_plunk_unsubscribe; a pausa não muda nada', async () => {
  onRpc(() => row({ outcome: 'applied', user_id: USER }))
  for (const token of [null, '', 'outro-token']) {
    const res = await hook({ email: 'casal@example.com' }, token)
    assertEquals(res.status, 401)
  }
  assertEquals(rpcCalls.length, 0)

  const res = await hook({ email: 'casal@example.com', motivo: '' })
  assertEquals([res.status, await res.json()], [200, { outcome: 'applied' }])
  assertEquals([rpcCalls[0].fn, rpcCalls[0].args], ['record_plunk_unsubscribe', { p_email: 'casal@example.com' }])

  onRpc(() => row({ outcome: 'applied', user_id: USER }))
  const snooze = await hook({ email: 'casal@example.com', motivo: 'snooze' })
  assertEquals([snooze.status, await snooze.json(), rpcCalls.length], [200, { outcome: 'ignored' }, 0])

  for (const bad of [{}, { email: 'sem-arroba' }, [], 'texto']) {
    assertEquals((await hook(bad)).status, 400)
  }
  assertEquals((await handlePlunkWebhook(new Request('http://localhost/plunk-webhook'))).status, 405)
})
