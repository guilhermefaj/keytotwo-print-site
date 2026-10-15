// Testes de contrato do I4 (downloads, link do e-mail, gratuito e email-dispatch), sem rede.
// Rodar na raiz do repositório:
//   npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
import { assert, assertEquals, assertMatch } from '@std/assert'
import { captureErrors, externalCalls, LINK_SECRET, onExternal, onRpc, onStripe, request, rpcCalls, SECRET_KEY, sessionToken, tampered, userId, WEBHOOK_SECRET, contractTest } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { attachment } from '../api/routes/downloads.ts'
import { handleEmailDispatch } from '../email-dispatch/handler.ts'
import { handleStripeWebhook } from '../stripe-webhook/handler.ts'
import { presignUrl } from '../_shared/b2.ts'
import { setBackgroundRunner } from '../_shared/background.ts'
import { cryptoProvider, stripe } from '../_shared/stripe.ts'
import { signDeliveryToken, verifyDeliveryToken } from '../_shared/tokens.ts'

const ok = (body: unknown) => ({ status: 200, body })
const row = (body: Record<string, unknown>) => ok([body])
const ENTITLEMENT = '33333333-3333-4333-8333-333333333333'
const FILE_ID = '44444444-4444-4444-8444-444444444444'
const OUTBOX_ID = '55555555-5555-4555-8555-555555555555'
const FILE_OK = { outcome: 'ok', bucket: 'qualquer', object_key: 'paid/TESTE-J01/1.0/TESTE-J01-v1.0.pdf', filename: 'TESTE-J01-v1.0.pdf', content_type: 'application/pdf', size_bytes: 699 }
const outcome = (name: string) => ({ outcome: name, bucket: null, object_key: null, filename: null, content_type: null, size_bytes: null })

// ---------- tokens e B2 ----------

contractTest('token de entrega: válido, adulterado, de outro segredo, vencido e rotação do segredo', async () => {
  const token = await signDeliveryToken(ENTITLEMENT, 7)
  const good = await verifyDeliveryToken(token)
  assert(good.ok)
  assertEquals([good.claims.e, good.claims.g, good.claims.t], [ENTITLEMENT, 7, 'd'])

  const [payload, signature] = token.split('.')
  const forged = btoa(JSON.stringify({ t: 'd', e: ENTITLEMENT, g: 8, x: good.claims.x })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  for (const bad of [`${forged}.${signature}`, tampered(token), `${payload}`, 'nada', `${payload}.${signature}.extra`]) {
    assertEquals(await verifyDeliveryToken(bad), { ok: false, reason: 'invalid' }, bad)
  }

  assertEquals(await verifyDeliveryToken(token, Date.now() + 31 * 24 * 3600 * 1000), { ok: false, reason: 'expired' })

  Deno.env.set('EMAIL_LINK_SECRET', 'segredo-novo')
  assertEquals((await verifyDeliveryToken(token)).ok, false)
  Deno.env.set('EMAIL_LINK_SECRET_PREVIOUS', LINK_SECRET)
  assertEquals((await verifyDeliveryToken(token)).ok, true)
  Deno.env.delete('EMAIL_LINK_SECRET_PREVIOUS')
  Deno.env.set('EMAIL_LINK_SECRET', LINK_SECRET)
})

contractTest('B2: assinatura SigV4 confere com o vetor oficial da AWS', async () => {
  const { url, expiresAt } = await presignUrl(
    { endpoint: 's3.amazonaws.com', region: 'us-east-1', bucket: 'examplebucket', keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    { key: 'test.txt', expiresIn: 86400, now: new Date('2013-05-24T00:00:00Z') },
  )
  assertEquals(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
  assertEquals(expiresAt, '2013-05-25T00:00:00.000Z')
})

// ---------- POST /download-url ----------

contractTest('download-url: sessão, formato do id e outcomes de resolve_download', async () => {
  onRpc(() => row(FILE_OK))
  assertEquals((await handleRequest(request('/download-url', { method: 'POST', body: { file_id: FILE_ID } }))).status, 401)
  const token = await sessionToken()
  assertEquals((await handleRequest(request('/download-url', { method: 'POST', token, body: { file_id: 'x' } }))).status, 400)
  assertEquals(rpcCalls.length, 0)

  const res = await handleRequest(request('/download-url', { method: 'POST', token, body: { file_id: FILE_ID } }))
  assertEquals(res.status, 200)
  const body = await res.json()
  const url = new URL(body.url)
  assertEquals([url.host, url.pathname, url.searchParams.get('X-Amz-Expires'), body.filename], ['bucket-de-teste.s3.teste-001.backblazeb2.com', '/paid/TESTE-J01/1.0/TESTE-J01-v1.0.pdf', '300', 'TESTE-J01-v1.0.pdf'])
  assert(url.searchParams.get('X-Amz-Credential')!.startsWith('chave-leitura-teste/'))
  assertEquals(url.searchParams.get('response-content-disposition'), `attachment; filename="TESTE-J01-v1.0.pdf"; filename*=UTF-8''TESTE-J01-v1.0.pdf`)
  assertEquals(url.searchParams.get('response-content-type'), 'application/pdf')
  assertEquals(attachment('Jogo "Ação".pdf'), `attachment; filename="Jogo _Acao_.pdf"; filename*=UTF-8''Jogo%20%22A%C3%A7%C3%A3o%22.pdf`)
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_file_id: FILE_ID })
  assert(Math.abs(Date.parse(body.expires_at) - Date.now() - 300_000) < 5_000)

  for (const [name, status, code] of [['not_entitled', 403, 'NOT_ENTITLED'], ['not_found', 404, 'FILE_NOT_FOUND'], ['unavailable', 503, 'FILE_UNAVAILABLE']] as const) {
    onRpc(() => row(outcome(name)))
    const refused = await handleRequest(request('/download-url', { method: 'POST', token, body: { file_id: FILE_ID } }))
    assertEquals([refused.status, (await refused.json()).error.code], [status, code])
  }
})

// ---------- GET /d/{token} ----------

contractTest('link do e-mail: válido redireciona ao B2; adulterado 401; vencido e revogado vão a Meus jogos', async () => {
  const token = await signDeliveryToken(ENTITLEMENT, 7)
  onRpc(() => row(FILE_OK))
  const res = await handleRequest(request(`/d/${token}`))
  assertEquals(res.status, 302)
  assertMatch(res.headers.get('Location')!, /^https:\/\/bucket-de-teste\.s3\.teste-001\.backblazeb2\.com\/paid\/TESTE-J01\//)
  assertEquals([res.headers.get('Cache-Control'), res.headers.get('Referrer-Policy')], ['no-store', 'no-referrer'])
  assertEquals(rpcCalls[0], { fn: 'resolve_delivery', args: { p_entitlement_id: ENTITLEMENT, p_game_id: 7 }, secretKeyOk: true, hasAuthorization: false })

  onRpc(() => row(FILE_OK))
  const tampered = await handleRequest(request(`/d/${token.slice(0, -3)}abc`))
  assertEquals([tampered.status, (await tampered.json()).error.code, rpcCalls.length], [401, 'INVALID_TOKEN', 0])

  const old = await signDeliveryToken(ENTITLEMENT, 7, Date.now() - 31 * 24 * 3600 * 1000)
  const expired = await handleRequest(request(`/d/${old}`))
  assertEquals([expired.status, expired.headers.get('Location'), rpcCalls.length], [302, 'http://127.0.0.1:5176/meus-jogos?link=expirado', 0])

  for (const name of ['revoked', 'not_found', 'unavailable']) {
    onRpc(() => row(outcome(name)))
    const gone = await handleRequest(request(`/d/${token}`))
    assertEquals([gone.status, gone.headers.get('Location')], [302, 'http://127.0.0.1:5176/meus-jogos?link=indisponivel'])
  }
  assertEquals((await handleRequest(request(`/d/${token}`, { method: 'POST' }))).status, 405)
})

// ---------- jogo gratuito ----------

contractTest('jogo gratuito: indisponível por padrão; free-download só assina arquivo gratuito', async () => {
  onRpc(() => ok({ available: false }))
  assertEquals(await (await handleRequest(request('/free-game'))).json(), { available: false })
  onRpc(() => ok({ available: true, game: { code: 'TESTE-GRATIS', name: 'Gratuito' }, file: { id: FILE_ID, version: '0.1', size_bytes: 10, filename: 'g.pdf' } }))
  assertEquals(await (await handleRequest(request('/free-game'))).json(), { available: true, game: { name: 'Gratuito' }, file: { id: FILE_ID, version: '0.1', size_bytes: 10 } })

  onRpc(() => row(outcome('not_found')))
  const paid = await handleRequest(request('/free-download', { method: 'POST', body: { file_id: FILE_ID } }))
  assertEquals([paid.status, (await paid.json()).error.code], [404, 'FILE_NOT_FOUND'])
  onRpc(() => row({ ...FILE_OK, object_key: 'free/TESTE-GRATIS/0.1/TESTE-GRATIS-v0.1.pdf' }))
  const free = await handleRequest(request('/free-download', { method: 'POST', body: { file_id: FILE_ID } }))
  assertEquals(free.status, 200)
  assertEquals(new URL((await free.json()).url).pathname, '/free/TESTE-GRATIS/0.1/TESTE-GRATIS-v0.1.pdf')
})

// ---------- email-dispatch ----------

const DELIVERY_ROW = {
  id: OUTBOX_ID, kind: 'delivery', category: 'transactional', user_id: 'u', order_id: 'o', to_email: 'comprador@example.com', attempts: 0,
  payload: { order_ref: 'A1B2C3D4', items: [{ code: 'P001', name: 'Pacote' }], games: [{ entitlement_id: ENTITLEMENT, game_id: 7, code: 'TESTE-J01', name: 'Jogo <Um>' }, { entitlement_id: ENTITLEMENT, game_id: 8, code: 'TESTE-J02', name: null }] },
}

function dispatchRpc(rows: unknown[]) {
  onRpc((fn) => (fn === 'claim_email_batch' ? ok(rows) : row({ outcome: 'applied', status: 'sent', next_attempt_at: null })))
}

const dispatchRequest = (body: unknown, apikey: string | null = SECRET_KEY, method = 'POST') =>
  handleEmailDispatch(new Request('http://localhost/email-dispatch', { method, headers: apikey ? { apikey } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }))

contractTest('email-dispatch: chave obrigatória e validação do corpo', async () => {
  dispatchRpc([])
  assertEquals((await dispatchRequest({}, null)).status, 401)
  assertEquals((await dispatchRequest({}, 'outra-chave')).status, 401)
  assertEquals((await dispatchRequest({}, SECRET_KEY, 'GET')).status, 405)
  assertEquals((await dispatchRequest({ limit: 0 })).status, 400)
  assertEquals((await dispatchRequest({ outbox_id: 'x' })).status, 400)
  assertEquals(rpcCalls.length, 0)
  const res = await dispatchRequest({ limit: 5 })
  assertEquals(await res.json(), { claimed: 0, sent: 0, failed: 0, rejected: 0 })
  assertEquals(rpcCalls[0].args, { p_limit: 5, p_outbox_id: null })
})

contractTest('email-dispatch modo log: um botão por jogo com link /d/{token} válido, Meus jogos, Mailpit e mark sent', async () => {
  Deno.env.set('EMAIL_MODE', 'log')
  dispatchRpc([DELIVERY_ROW])
  onExternal(() => ok({ ID: 'mailpit-1' }))
  const { result } = await captureErrors(async () => await (await dispatchRequest({ outbox_id: OUTBOX_ID })).json())
  assertEquals(result, { claimed: 1, sent: 1, failed: 0, rejected: 0 })
  assertEquals(rpcCalls[0].args, { p_limit: 20, p_outbox_id: OUTBOX_ID })
  assertEquals(rpcCalls[1].args, { p_id: OUTBOX_ID, p_status: 'sent', p_provider_message_id: 'log-mailpit-1', p_error: null })

  const mail = externalCalls[0].body as { To: { Email: string }[]; Subject: string; HTML: string; Text: string }
  assertEquals([mail.To[0].Email, mail.Subject], ['comprador@example.com', 'Seus jogos chegaram (pedido A1B2C3D4)'])
  assert(mail.HTML.includes('Baixar Jogo &lt;Um&gt;') && mail.HTML.includes('Baixar TESTE-J02'), 'nomes escapados e código como reserva')
  assert(mail.HTML.includes('http://127.0.0.1:5176/meus-jogos') && mail.Text.includes('Meus jogos: http://127.0.0.1:5176/meus-jogos'))
  const links = [...mail.Text.matchAll(/http:\/\/127\.0\.0\.1:54321\/functions\/v1\/api\/d\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1])
  assertEquals(links.length, 2)
  const claims = await Promise.all(links.map((t) => verifyDeliveryToken(t)))
  assertEquals(claims.map((c) => c.ok && [c.claims.e, c.claims.g]), [[ENTITLEMENT, 7], [ENTITLEMENT, 8]])
})

contractTest('email-dispatch modo brevo: chave v3, lista de teste, recusa definitiva e falha transitória', async () => {
  Deno.env.set('EMAIL_MODE', 'brevo')
  const run = async () => {
    dispatchRpc([DELIVERY_ROW])
    const { result } = await captureErrors(async () => await (await dispatchRequest({})).json())
    return { summary: result, mark: rpcCalls[1].args }
  }

  Deno.env.set('BREVO_API_KEY', 'chave-antiga-smtp')
  assertEquals((await run()).mark, { p_id: OUTBOX_ID, p_status: 'rejected', p_provider_message_id: null, p_error: 'brevo_chave_nao_v3' })

  Deno.env.set('BREVO_API_KEY', 'xkeysib-teste-ficticia')
  Deno.env.set('EMAIL_ALLOWED_RECIPIENTS', 'responsavel@example.com')
  assertEquals((await run()).mark.p_error, 'fora_da_lista_de_teste')
  Deno.env.set('EMAIL_ALLOWED_RECIPIENTS', 'comprador@example.com')

  onExternal(() => ({ status: 201, body: { messageId: '<msg-1@brevo>' } }))
  const sent = await run()
  assertEquals([sent.summary.sent, sent.mark.p_status, sent.mark.p_provider_message_id], [1, 'sent', '<msg-1@brevo>'])
  const call = externalCalls[0]
  assertEquals([call.headers.get('api-key'), (call.body.sender as { email: string }).email, (call.body.to as { email: string }[])[0].email], ['xkeysib-teste-ficticia', 'acesso@example.com', 'comprador@example.com'])

  onExternal(() => ({ status: 400, body: { code: 'invalid_parameter' } }))
  assertEquals((await run()).mark, { p_id: OUTBOX_ID, p_status: 'rejected', p_provider_message_id: null, p_error: 'brevo_http_400_invalid_parameter' })
  onExternal(() => ({ status: 503, body: {} }))
  assertEquals((await run()).mark.p_status, 'failed')
  onExternal(() => ({ status: 401, body: { code: 'unauthorized' } }))
  assertEquals((await run()).mark, { p_id: OUTBOX_ID, p_status: 'failed', p_provider_message_id: null, p_error: 'brevo_http_401_unauthorized' })

  dispatchRpc([{ ...DELIVERY_ROW, kind: 'outro' }])
  await captureErrors(() => dispatchRequest({}))
  assertEquals([rpcCalls[1].args.p_status, rpcCalls[1].args.p_error], ['rejected', 'kind_desconhecido'])

  Deno.env.delete('EMAIL_ALLOWED_RECIPIENTS')
  Deno.env.set('EMAIL_MODE', 'log')
})

contractTest('webhook: liberação com send_delivery despacha a entrega daquele outbox em segundo plano', async () => {
  const tasks: Promise<unknown>[] = []
  setBackgroundRunner((task) => tasks.push(task))
  const SESSION = 'cs_test_entrega'
  const session = {
    id: SESSION, object: 'checkout.session', client_reference_id: '11111111-1111-4111-8111-111111111111', status: 'complete', payment_status: 'paid',
    amount_subtotal: 1990, amount_total: 1990, currency: 'brl', total_details: { amount_discount: 0 }, discounts: [], payment_intent: 'pi_x', customer: 'cus_x', livemode: false,
  }
  onStripe((call) => (call.path.endsWith('/line_items')
    ? ok({ object: 'list', has_more: false, url: '', data: [{ id: 'li', object: 'item', price: { id: 'price_x', unit_amount: 1990 }, quantity: 1, currency: 'brl' }] })
    : ok(session)))
  onRpc((fn) => {
    if (fn === 'fulfill_order') return row({ outcome: 'applied', order_status: 'paid', outbox_id: OUTBOX_ID, send_delivery: true })
    if (fn === 'claim_email_batch') return ok([DELIVERY_ROW])
    return row({ outcome: 'applied', status: 'sent' })
  })
  onExternal(() => ok({ ID: 'mailpit-2' }))
  const payload = JSON.stringify({ id: 'evt_entrega', object: 'event', type: 'checkout.session.completed', api_version: '2026-03-25.dahlia', created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 1, request: { id: null }, data: { object: session } })
  const signature = await stripe().webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET, cryptoProvider })
  const res = await handleStripeWebhook(new Request('http://localhost/stripe-webhook', { method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload }))
  assertEquals(res.status, 200)
  await captureErrors(() => Promise.all(tasks))
  setBackgroundRunner(null)
  assertEquals(rpcCalls.map((c) => c.fn), ['fulfill_order', 'claim_email_batch', 'mark_email_result'])
  assertEquals(rpcCalls[1].args, { p_limit: 20, p_outbox_id: OUTBOX_ID })
})
