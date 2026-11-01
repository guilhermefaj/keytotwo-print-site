// Testes de contrato do I5 (descadastro e e-mails de marketing), sem rede. O webhook da Brevo saiu em 2026-10-31.
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assert, assertEquals, assertMatch } from '@std/assert'
import { captureErrors, externalCalls, onExternal, onRpc, PLUNK_URL, request, rpcCalls, SECRET_KEY, contractTest, tampered, dispatchRpc, ok, row } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { handleEmailDispatch } from '../email-dispatch/handler.ts'
import { signDeliveryToken, signUnsubscribeToken, verifyUnsubscribeToken } from '../_shared/tokens.ts'

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
  assertEquals((await verifyUnsubscribeToken(tampered(token))).ok, false)
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
  for (const bad of [await signDeliveryToken(USER, 1), tampered(token), '']) {
    const res = await handleRequest(request('/email/unsubscribe', { method: 'POST', body: { token: bad } }))
    assertEquals([res.status, (await res.json()).error.code], [400, 'INVALID_TOKEN'])
  }
  assertEquals((await handleRequest(new Request('http://localhost/api/email/unsubscribe', { method: 'POST' }))).status, 400)
  assertEquals(rpcCalls.length, 0)
})

// O link do rodapé dos e-mails do Plunk (2026-11-01): o Traefik leva a página dele à de preferências do site, que manda
// o id do contato. Sai no Plunk (1 clique, com o e-mail de origem) e, na hora, no site, pelo caminho do webhook dele.
contractTest('POST /email/unsubscribe pelo link do Plunk: sai lá e no site; contato sumido é "pronto"; Plunk fora é erro', async () => {
  const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const EMAIL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const send = (body: unknown) => handleRequest(request('/email/unsubscribe', { method: 'POST', body, headers: { Origin: 'http://127.0.0.1:5173' } }))
  Deno.env.set('PLUNK_API_URL', PLUNK_URL)
  try {
    onExternal((call) => ok(call.method === 'GET' ? { id: CONTACT, email: 'casal@example.com', subscribed: true } : {}))
    onRpc(() => row({ outcome: 'applied', user_id: USER }))
    const res = await send({ contact: CONTACT.toUpperCase(), email_id: EMAIL_ID })
    assertEquals([res.status, await res.json()], [200, { status: 'unsubscribed' }])
    // As rotas públicas do Plunk, sem a chave secreta.
    assertEquals(externalCalls.map((c) => [c.method, c.url, c.headers.get('Authorization')]), [
      ['GET', `${PLUNK_URL}/contacts/public/${CONTACT}`, null],
      ['POST', `${PLUNK_URL}/unsubscribe/${CONTACT}?e=${EMAIL_ID}`, null],
    ])
    assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['record_plunk_unsubscribe', { p_email: 'casal@example.com' }]])

    // Sem o e-mail de origem (ou com um id que não é dele), o descadastro vai sem o ?e=.
    onExternal((call) => ok(call.method === 'GET' ? { id: CONTACT, email: 'casal@example.com' } : {}))
    onRpc(() => row({ outcome: 'noop', user_id: null }))
    assertEquals((await send({ contact: CONTACT, email_id: 'x' })).status, 200)
    assertEquals(externalCalls[1].url, `${PLUNK_URL}/unsubscribe/${CONTACT}`)

    // Contato que o Plunk não conhece mais (conta excluída): nada a fazer, e a resposta não diz quais ids existem.
    onExternal(() => ({ status: 404, body: {} }))
    onRpc(() => row({ outcome: 'applied', user_id: USER }))
    assertEquals([(await send({ contact: CONTACT })).status, externalCalls.length, rpcCalls.length], [200, 1, 0])

    // Plunk fora do ar: erro (a página deixa tentar de novo), sem fingir sucesso nem mexer no site.
    for (const failing of [{ GET: 502, POST: 200 }, { GET: 200, POST: 503 }]) {
      onExternal((call) => ({ status: failing[call.method as 'GET' | 'POST'], body: { email: 'casal@example.com' } }))
      onRpc(() => row({ outcome: 'applied', user_id: USER }))
      const { result } = await captureErrors(() => send({ contact: CONTACT }))
      assertEquals([result.status, rpcCalls.length], [500, 0])
    }

    // O que não é id de contato: 400, sem chamar ninguém.
    onExternal(() => ok({}))
    for (const bad of ['nao-e-uuid', 42, null, `${CONTACT}/../x`]) {
      const res = await send({ contact: bad })
      assertEquals([res.status, (await res.json()).error.code], [400, 'INVALID_TOKEN'])
    }
    assertEquals([externalCalls.length, rpcCalls.length], [0, 0])
  } finally {
    Deno.env.delete('PLUNK_API_URL')
  }
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
  assert(mail.Text.includes(`Sair da lista (vale na hora): ${SITE}/email/preferencias?token=`))
  // O motivo do envio e a saída da lista fecham o e-mail, depois da assinatura e do CNPJ (2026-10-31).
  const exit = mail.HTML.lastIndexOf('Sair da lista')
  assert(exit > mail.HTML.lastIndexOf('Um pinguim numa tela') && exit > mail.HTML.lastIndexOf('CNPJ'), 'a saída da lista é a última linha')
  return token
}

contractTest('lembrete de carrinho: itens, botão do carrinho, rodapé e headers de descadastro (RFC 8058)', async () => {
  Deno.env.set('EMAIL_MODE', 'log')
  dispatchRpc([CART_ROW])
  onExternal(() => ok({ ID: 'mp-1' }))
  assertEquals(await dispatch(), { claimed: 1, sent: 1, failed: 0, rejected: 0 })
  const mail = externalCalls[0].body as unknown as MailpitBody
  assertEquals([mail.Subject, mail.Tags], ['Pacote <inicial> ficou na sacola', ['cart_reminder']])
  assert(mail.HTML.includes('Pacote &lt;inicial&gt;') && mail.HTML.includes(`${SITE}/carrinho`))
  assert(mail.HTML.includes(`${SITE}/media/email/kito-na-caixa.png`), 'o Kito do marketing, servido pelo site')
  assertEquals(mail.Headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  await unsubscribeTokenOf(mail)
})

contractTest('sacola, 2º toque: o cupom da primeira compra, os itens, o Kito do biscoito e o descadastro', async () => {
  dispatchRpc([{ ...CART_ROW, kind: 'cart_reminder_2', payload: { cart_version: 3, items: [{ code: 'P001', name: 'Pacote <inicial>' }, { code: 'J002', name: null }] } }])
  onExternal(() => ok({ ID: 'mp-3' }))
  assertEquals((await dispatch()).sent, 1)
  const mail = externalCalls[0].body as unknown as MailpitBody
  assertEquals([mail.Subject, mail.Tags], ['10% na primeira compra de vocês', ['cart_reminder_2']])
  assert(mail.HTML.includes('PRIMEIRA10') && mail.Text.includes('Cupom: PRIMEIRA10'))
  assert(mail.HTML.includes('Pacote &lt;inicial&gt;') && mail.HTML.includes('J002') && mail.Text.includes('Os jogos ainda estão na sacola'))
  assert(mail.HTML.includes(`${SITE}/carrinho`) && mail.HTML.includes(`${SITE}/media/email/kito-biscoito.png`))
  // Sem preço: a fila não guarda o preço do item, e o desconto é calculado no pagamento.
  assert(!mail.HTML.includes('R$'))
  await unsubscribeTokenOf(mail)
  dispatchRpc([{ ...CART_ROW, kind: 'cart_reminder_2', payload: { cart_version: 3, items: [] } }])
  await captureErrors(dispatch)
  assertEquals(rpcCalls[1].args.p_error, 'lembrete_sem_itens')
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

contractTest('marketing sem usuário ou sem itens é recusado; entrega não leva descadastro; o Plunk recebe os headers', async () => {
  dispatchRpc([{ ...CART_ROW, user_id: null }])
  await captureErrors(dispatch)
  assertEquals([rpcCalls[1].args.p_status, rpcCalls[1].args.p_error], ['rejected', 'marketing_sem_usuario'])
  dispatchRpc([{ ...CART_ROW, payload: { cart_version: 3, items: [] } }])
  await captureErrors(dispatch)
  assertEquals(rpcCalls[1].args.p_error, 'lembrete_sem_itens')

  Deno.env.set('EMAIL_MODE', 'plunk')
  Deno.env.set('PLUNK_API_URL', PLUNK_URL)
  Deno.env.set('PLUNK_SECRET_KEY', 'sk_teste_ficticia')
  const sent = { status: 200, body: { success: true, data: { emails: [{ email: 'e-1' }] } } }
  onExternal(() => sent)
  dispatchRpc([CART_ROW])
  await dispatch()
  const headers = externalCalls[0].body.headers as Record<string, string>
  assertMatch(headers['List-Unsubscribe'], /^<http:\/\/127\.0\.0\.1:54321\/functions\/v1\/api\/email\/unsubscribe\?token=/)
  assertEquals(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')

  onExternal(() => sent)
  dispatchRpc([{
    ...CART_ROW, kind: 'delivery', category: 'transactional',
    payload: { order_ref: 'X', games: [{ entitlement_id: '33333333-3333-4333-8333-333333333333', game_id: 1, code: 'J1', name: 'Jogo' }] },
  }])
  await dispatch()
  assertEquals(externalCalls[0].body.headers, undefined)
  assert(!String(externalCalls[0].body.body).toLowerCase().includes('sair da lista'))
  Deno.env.delete('PLUNK_API_URL')
  Deno.env.delete('PLUNK_SECRET_KEY')
  Deno.env.set('EMAIL_MODE', 'log')
})
