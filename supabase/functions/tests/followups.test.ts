// Testes de contrato do I5 (descadastro, e-mails de marketing e brevo-webhook), sem rede.
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assert, assertEquals, assertMatch } from '@std/assert'
import { BREVO_WEBHOOK_SECRET, captureErrors, externalCalls, onExternal, onRpc, request, rpcCalls, SECRET_KEY, contractTest } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { handleBrevoWebhook } from '../brevo-webhook/handler.ts'
import { handleEmailDispatch } from '../email-dispatch/handler.ts'
import { signDeliveryToken, signUnsubscribeToken, verifyUnsubscribeToken } from '../_shared/tokens.ts'

const ok = (body: unknown) => ({ status: 200, body })
const row = (body: Record<string, unknown>) => ok([body])
const USER = '66666666-6666-4666-8666-666666666666'
const OUTBOX = '77777777-7777-4777-8777-777777777777'
const SITE = 'http://127.0.0.1:5176'
const API = 'http://127.0.0.1:54321/functions/v1/api'

// ---------- token e rotas de descadastro ----------

contractTest('token de descadastro: não expira, e token de entrega não serve como descadastro', async () => {
  const token = await signUnsubscribeToken(USER, Date.now() - 400 * 24 * 3600 * 1000)
  const verified = await verifyUnsubscribeToken(token)
  assert(verified.ok)
  assertEquals(verified.claims.u, USER)
  assertEquals((await verifyUnsubscribeToken(await signDeliveryToken(USER, 1))).ok, false)
  assertEquals((await verifyUnsubscribeToken(`${token.slice(0, -2)}AA`)).ok, false)
})

contractTest('GET /email/unsubscribe não muda nada: leva à página de preferências', async () => {
  onRpc(() => row({ outcome: 'applied', opted_in: false }))
  const token = await signUnsubscribeToken(USER)
  const res = await handleRequest(request(`/email/unsubscribe?token=${encodeURIComponent(token)}`))
  assertEquals(res.status, 302)
  assertEquals(res.headers.get('Location'), `${SITE}/email/preferencias?token=${encodeURIComponent(token)}`)
  assertEquals(rpcCalls.length, 0)
})

contractTest('POST /email/unsubscribe: 1 clique (query + formulário), JSON, idempotente; token inválido 400', async () => {
  const token = await signUnsubscribeToken(USER)
  const expected = { p_user_id: USER, p_source: 'unsubscribe_link' }

  onRpc(() => row({ outcome: 'applied', opted_in: false }))
  const oneClick = await handleRequest(new Request(`http://localhost/api/email/unsubscribe?token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
  }))
  assertEquals([oneClick.status, await oneClick.json()], [200, { status: 'unsubscribed' }])
  assertEquals([rpcCalls[0].fn, rpcCalls[0].args], ['unsubscribe', expected])

  onRpc(() => row({ outcome: 'noop', opted_in: false }))
  const page = await handleRequest(request('/email/unsubscribe', { method: 'POST', body: { token }, headers: { Origin: 'http://127.0.0.1:5173' } }))
  assertEquals([page.status, await page.json()], [200, { status: 'unsubscribed' }])
  assertEquals(rpcCalls[0].args, expected)

  onRpc(() => row({ outcome: 'applied', opted_in: false }))
  const form = await handleRequest(new Request('http://localhost/api/email/unsubscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(token)}`,
  }))
  assertEquals(form.status, 200)

  onRpc(() => row({ outcome: 'applied', opted_in: false }))
  for (const bad of [await signDeliveryToken(USER, 1), `${token.slice(0, -2)}AA`, '']) {
    const res = await handleRequest(request('/email/unsubscribe', { method: 'POST', body: { token: bad } }))
    assertEquals([res.status, (await res.json()).error.code], [400, 'INVALID_TOKEN'])
  }
  assertEquals((await handleRequest(new Request('http://localhost/api/email/unsubscribe', { method: 'POST' }))).status, 400)
  assertEquals(rpcCalls.length, 0)
})

// ---------- e-mails de marketing ----------

const CART_ROW = {
  id: OUTBOX, kind: 'cart_reminder', category: 'marketing', user_id: USER, order_id: null, to_email: 'casal@example.com', attempts: 0,
  payload: { cart_version: 3, items: [{ code: 'P001', name: 'Pacote <inicial>' }] },
}
const POST_ROW = {
  id: OUTBOX, kind: 'post_purchase', category: 'marketing', user_id: USER, order_id: 'o', to_email: 'casal@example.com', attempts: 0,
  payload: { order_ref: 'A1B2C3D4', games: [{ code: 'J1', name: 'Jogo Um' }, { code: 'J2', name: 'Jogo Dois' }, { code: 'J3', name: null }] },
}

function dispatchRpc(rows: unknown[]) {
  onRpc((fn) => (fn === 'claim_email_batch' ? ok(rows) : row({ outcome: 'applied', status: 'sent', next_attempt_at: null })))
}

const dispatch = async () =>
  await (await handleEmailDispatch(new Request('http://localhost/email-dispatch', { method: 'POST', headers: { apikey: SECRET_KEY }, body: '{}' }))).json()

interface MailpitBody {
  Subject: string
  HTML: string
  Text: string
  Headers: Record<string, string>
  Tags: string[]
}

async function unsubscribeTokenOf(mail: MailpitBody): Promise<string> {
  const header = /^<(.+)>$/.exec(mail.Headers['List-Unsubscribe'])![1]
  const url = new URL(header)
  assertEquals(`${url.origin}${url.pathname}`, `${API}/email/unsubscribe`)
  const token = url.searchParams.get('token')!
  const verified = await verifyUnsubscribeToken(token)
  assert(verified.ok && verified.claims.u === USER)
  assert(mail.HTML.includes(`${SITE}/email/preferencias?token=${encodeURIComponent(token)}`), 'rodapé sem o link de descadastro')
  assert(mail.Text.includes(`Descadastrar (vale na hora): ${SITE}/email/preferencias?token=`))
  return token
}

contractTest('lembrete de carrinho: itens, botão do carrinho, rodapé e headers de descadastro (RFC 8058)', async () => {
  Deno.env.set('EMAIL_MODE', 'log')
  dispatchRpc([CART_ROW])
  onExternal(() => ok({ ID: 'mp-1' }))
  assertEquals(await dispatch(), { claimed: 1, sent: 1, failed: 0, rejected: 0 })
  const mail = externalCalls[0].body as unknown as MailpitBody
  assertEquals([mail.Subject, mail.Tags], ['Ficou um jogo no carrinho', ['cart_reminder']])
  assert(mail.HTML.includes('Pacote &lt;inicial&gt;') && mail.HTML.includes(`${SITE}/carrinho`))
  assertEquals(mail.Headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  await unsubscribeTokenOf(mail)
})

contractTest('pós-compra: jogos, Meus jogos, ajuda de impressão e descadastro', async () => {
  dispatchRpc([POST_ROW])
  onExternal(() => ok({ ID: 'mp-2' }))
  assertEquals((await dispatch()).sent, 1)
  const mail = externalCalls[0].body as unknown as MailpitBody
  assertEquals(mail.Subject, 'Já rolou a primeira partida?')
  assert(mail.Text.includes('Jogo Um, Jogo Dois e J3 chegaram'))
  assert(mail.HTML.includes(`${SITE}/meus-jogos`) && mail.HTML.includes(`${SITE}/ajuda#impressao`))
  await unsubscribeTokenOf(mail)
})

contractTest('marketing sem usuário ou sem itens é recusado; entrega não leva descadastro; Brevo recebe os headers', async () => {
  dispatchRpc([{ ...CART_ROW, user_id: null }])
  await captureErrors(dispatch)
  assertEquals([rpcCalls[1].args.p_status, rpcCalls[1].args.p_error], ['rejected', 'marketing_sem_usuario'])
  dispatchRpc([{ ...CART_ROW, payload: { cart_version: 3, items: [] } }])
  await captureErrors(dispatch)
  assertEquals(rpcCalls[1].args.p_error, 'lembrete_sem_itens')

  Deno.env.set('EMAIL_MODE', 'brevo')
  Deno.env.set('BREVO_API_KEY', 'xkeysib-teste-ficticia')
  onExternal(() => ({ status: 201, body: { messageId: '<m@brevo>' } }))
  dispatchRpc([CART_ROW])
  await dispatch()
  const headers = externalCalls[0].body.headers as Record<string, string>
  assertMatch(headers['List-Unsubscribe'], /^<http:\/\/127\.0\.0\.1:54321\/functions\/v1\/api\/email\/unsubscribe\?token=/)
  assertEquals(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')

  onExternal(() => ({ status: 201, body: { messageId: '<d@brevo>' } }))
  dispatchRpc([{
    ...CART_ROW, kind: 'delivery', category: 'transactional',
    payload: { order_ref: 'X', games: [{ entitlement_id: '33333333-3333-4333-8333-333333333333', game_id: 1, code: 'J1', name: 'Jogo' }] },
  }])
  await dispatch()
  assertEquals(externalCalls[0].body.headers, undefined)
  assert(!String(externalCalls[0].body.htmlContent).includes('Descadastrar'))
  Deno.env.set('EMAIL_MODE', 'log')
})

// ---------- brevo-webhook ----------

const webhook = (body: unknown, auth: string | null = `Bearer ${BREVO_WEBHOOK_SECRET}`, init: RequestInit = {}) =>
  handleBrevoWebhook(new Request('http://localhost/brevo-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body), ...init,
  }))

const EVENT = { event: 'hard_bounce', email: ' Casal@Example.com ', id: 1, 'message-id': '<abc@relay>', ts_event: 1_790_000_000, reason: 'mailbox' }

contractTest('brevo-webhook: segredo ausente ou errado 401, método 405, corpo 415/400, sem tocar no banco', async () => {
  onRpc(() => row({ outcome: 'applied', user_id: USER }))
  assertEquals((await webhook(EVENT, null)).status, 401)
  assertEquals((await webhook(EVENT, 'Bearer segredo-errado')).status, 401)
  assertEquals((await webhook(EVENT, BREVO_WEBHOOK_SECRET)).status, 401)
  assertEquals((await handleBrevoWebhook(new Request('http://localhost/brevo-webhook'))).status, 405)
  assertEquals((await webhook(EVENT, undefined, { headers: { Authorization: `Bearer ${BREVO_WEBHOOK_SECRET}`, 'Content-Type': 'text/plain' } })).status, 415)
  assertEquals((await webhook(EVENT, undefined, { body: '{' })).status, 400)
  assertEquals((await webhook([])).status, 400)
  assertEquals(rpcCalls.length, 0)
})

contractTest('brevo-webhook: evento único e lote mapeiam para record_email_event; outros eventos são ignorados', async () => {
  onRpc(() => row({ outcome: 'applied', user_id: USER }))
  const single = await webhook(EVENT)
  assertEquals([single.status, await single.json()], [200, { received: 1, recorded: 1, ignored: 0 }])
  assertEquals(rpcCalls[0], {
    fn: 'record_email_event', secretKeyOk: true, hasAuthorization: false,
    args: { p_email: 'casal@example.com', p_event: 'hard_bounce', p_provider_message_id: '<abc@relay>', p_occurred_at: new Date(1_790_000_000_000).toISOString() },
  })

  onRpc(() => row({ outcome: 'applied', user_id: null }))
  const batch = await webhook([
    { event: 'spam', email: 'a@example.com' },
    { event: 'unsubscribed', email: 'b@example.com', ts: 1_790_000_100 },
    { event: 'invalid_email', email: 'c@example.com' },
    { event: 'blocked', email: 'd@example.com' },
    { event: 'delivered', email: 'e@example.com' },
    { event: 'soft_bounce', email: 'f@example.com' },
    { event: 'spam' },
  ])
  assertEquals(await batch.json(), { received: 7, recorded: 4, ignored: 3 })
  assertEquals(rpcCalls.map((c) => c.args.p_event), ['complaint', 'unsubscribe', 'hard_bounce', 'hard_bounce'])
  assertEquals(rpcCalls[0].args.p_occurred_at, undefined)
  assertEquals(rpcCalls[1].args.p_occurred_at, new Date(1_790_000_100_000).toISOString())
})

contractTest('brevo-webhook: KT001 é ignorado; falha do banco vira 500 para a Brevo reenviar, sem e-mail no log', async () => {
  onRpc(() => ({ status: 400, body: { code: 'KT001', message: 'e-mail inválido' } }))
  const { result: invalid } = await captureErrors(() => webhook({ event: 'spam', email: 'sem-arroba' }))
  assertEquals(await invalid.json(), { received: 1, recorded: 0, ignored: 1 })

  onRpc(() => ({ status: 503, body: { message: 'indisponível' } }))
  const { result: down, logs } = await captureErrors(() => webhook(EVENT))
  assertEquals(down.status, 500)
  assert(!logs.join('\n').includes('example.com'), 'o e-mail não pode ir para o log')
})
