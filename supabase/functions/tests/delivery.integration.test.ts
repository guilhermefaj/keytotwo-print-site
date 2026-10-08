// I4 contra o banco local (migrações do I4 e seed com os 5 PDFs de TESTE), o bucket de TESTE do B2 e o Mailpit.
// A Stripe é simulada (stripe-fake.ts). B2_*, EMAIL_LINK_SECRET, API_PUBLIC_URL e EMAIL_FROM* vêm de supabase/functions/.env,
// lidos sem imprimir valores. E-mail só em modo log (cópia no Mailpit local); nada sai para fora.
//   KT_INTEGRATION=1 npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json \
//     --allow-env --allow-read --allow-net supabase/functions/tests/delivery.integration.test.ts
import { assert, assertEquals, assertMatch } from '@std/assert'
import { enabled, fetchRetry, lastMail, mailCount, MAILPIT_URL, removeTestUsers, settle } from './integration-helpers.ts'
import { buyer, call, deliver, pay, sessionObject, startCheckout } from './stripe-fake.ts'
import { handleRequest } from '../api/router.ts'
import { handleEmailDispatch } from '../email-dispatch/handler.ts'
import { presignUrl, readOnlyConfig } from '../_shared/b2.ts'
import { signDeliveryToken, verifyDeliveryToken } from '../_shared/tokens.ts'

// Conteúdo esperado dos PDFs fictícios (gerados por upload-test-pdfs.ts).
const SHA256: Record<string, string> = {
  'TESTE-J01-v1.0.pdf': '35454cce258badc63d530a5744c9a2d46d1d6fd5a718f2adedbcf310194fd7da',
  'TESTE-J02-v1.0.pdf': '1f3251b5a26fd0efaae5f159e450f731923a7c4e862391571e5efc29d2b5a95f',
  'TESTE-J03-v1.0.pdf': 'd8165f721e1fd0acdc545dc4624785f04842d1ae0c1c3d46d0d95173de76dc0d',
  'TESTE-J04-v1.0.pdf': '98dd7189dd01904bcc4479a104aa4feb86466f0ff0dc42a6ea0f934c3673ed64',
  'TESTE-J05-v1.0.pdf': '40207c1576721c3e2fbdf4fc4c6822b4238033733dbd7d0914a4ed5a72bcf372',
}
const SUBJECT = 'Seus jogos chegaram'

const claimedOutbox: string[] = []
if (enabled) {
  const wanted = ['B2_ENDPOINT', 'B2_REGION', 'B2_BUCKET', 'B2_READ_KEY_ID', 'B2_READ_APPLICATION_KEY', 'EMAIL_LINK_SECRET', 'API_PUBLIC_URL', 'EMAIL_FROM', 'EMAIL_FROM_NAME']
  for (const line of (await Deno.readTextFile(new URL('../.env', import.meta.url))).split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m && wanted.includes(m[1]) && m[2].trim()) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''))
  }
  Deno.env.set('EMAIL_MODE', 'log')
  Deno.env.set('EMAIL_LOG_MAILPIT_URL', MAILPIT_URL)
  // Despacho em segundo plano: os testes aguardam as tarefas; o outbox de cada despacho fica registrado.
  const inner = globalThis.fetch
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/rest/v1/rpc/claim_email_batch')) {
      const id = JSON.parse(String(init?.body ?? '{}')).p_outbox_id
      if (id) claimedOutbox.push(id)
    }
    return inner(input, init)
  }
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

// Baixa do B2 e confere status, tipo, anexo e conteúdo.
async function fetchPdf(url: string) {
  const res = await fetchRetry(url)
  const body = await res.arrayBuffer()
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition') ?? '',
    size: body.byteLength,
    sha256: hex(await crypto.subtle.digest('SHA-256', body)),
  }
}

async function link(token: string) {
  const res = await handleRequest(new Request(`http://localhost/api/d/${token}`))
  const location = res.headers.get('Location')
  const body = res.status === 302 ? null : await res.json()
  return { status: res.status, location, body }
}

const dispatch = async (body: unknown) =>
  await (await handleEmailDispatch(new Request('http://localhost/email-dispatch', {
    method: 'POST', headers: { apikey: Deno.env.get('SUPABASE_SECRET_KEY')!, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))).json()

const deliveryTokens = (text: string) => [...text.matchAll(/\/functions\/v1\/api\/d\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1])

Deno.test({
  name: 'I4 integração: entrega por e-mail única, downloads com e sem direito, B2 real, link do e-mail, revogação e gratuito',
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    try {
      // Despachos de outros arquivos do mesmo processo terminam antes; o registro passa a contar só este teste.
      await settle()
      claimedOutbox.length = 0
      const a = await buyer('i4-a')
      const started = Date.now() - 5_000
      const sessionA = await startCheckout(a.token)
      let tokens: string[] = []
      let games: { code: string; files: { id: string; kind: string }[] }[] = []

      await t.step('pagamento libera e o webhook despacha a entrega: 1 botão por jogo e Meus jogos', async () => {
        pay(sessionA)
        const res = await deliver('checkout.session.completed', sessionObject(sessionA))
        assertEquals([res.status, res.body.outcome], [200, 'applied'])
        await settle()
        assertEquals(claimedOutbox.length, 1, 'o webhook deveria despachar o outbox do pedido')
        const mail = await lastMail(a.email, started)
        assertMatch(mail.subject, new RegExp(`^${SUBJECT} \\(pedido [A-Z0-9]+\\)$`))
        games = (await call('/library', a.token)).body.games
        tokens = deliveryTokens(mail.text)
        assertEquals(tokens.length, games.length)
        assert(games.length >= 1)
        assert(mail.html.includes('/meus-jogos') && mail.text.includes('Meus jogos: http://127.0.0.1:5176/meus-jogos'))
        assert(!/eyJ[w-]+.eyJ[w-]+.[w-]+/.test(mail.text + mail.html), 'e-mail não deve levar JWT de sessão')
      })

      await t.step('entrega única: evento repetido, order-status e novo despacho do mesmo outbox não reenviam', async () => {
        const again = await deliver('checkout.session.completed', sessionObject(sessionA))
        assertEquals(again.body.outcome, 'noop')
        assertEquals((await call(`/order-status?session_id=${sessionA.id}`, a.token)).body.state, 'paid')
        await settle()
        assertEquals(claimedOutbox.length, 1)
        assertEquals(await dispatch({ outbox_id: claimedOutbox[0] }), { claimed: 0, sent: 0, failed: 0, rejected: 0 })
        assertEquals(await mailCount(a.email, SUBJECT), 1)
      })

      await t.step('liberação concorrente (webhook x4 + order-status) envia um e-mail só', async () => {
        const b = await buyer('i4-b')
        const sessionB = await startCheckout(b.token)
        pay(sessionB)
        await Promise.all([
          ...Array.from({ length: 4 }, () => deliver('checkout.session.completed', sessionObject(sessionB))),
          call(`/order-status?session_id=${sessionB.id}`, b.token),
        ])
        await settle()
        await lastMail(b.email, started)
        assertEquals(await mailCount(b.email, SUBJECT), 1)
      })

      await t.step('com direito: 200 application/pdf, anexo e conteúdo conferido no B2 (todos os jogos)', async () => {
        for (const game of games) {
          const file = game.files.find((f) => f.kind === 'pdf')
          assert(file, `jogo ${game.code} sem PDF publicado`)
          const res = await call('/download-url', a.token, 'POST', { file_id: file.id })
          assertEquals(res.status, 200, JSON.stringify(res.body))
          assert(Math.abs(Date.parse(res.body.expires_at) - Date.now() - 300_000) < 10_000)
          const pdf = await fetchPdf(res.body.url)
          assertEquals([pdf.status, pdf.type, pdf.size], [200, 'application/pdf', 699])
          assert(pdf.disposition.startsWith(`attachment; filename="${res.body.filename}"`), pdf.disposition)
          assertEquals(pdf.sha256, SHA256[res.body.filename])
        }
      })

      await t.step('sem direito 403, sem sessão 401, id inválido 400', async () => {
        const fileId = games[0].files[0].id
        const c = await buyer('i4-c')
        const denied = await call('/download-url', c.token, 'POST', { file_id: fileId })
        assertEquals([denied.status, denied.body.error.code], [403, 'NOT_ENTITLED'])
        assertEquals((await call('/download-url', null, 'POST', { file_id: fileId })).status, 401)
        assertEquals((await call('/download-url', a.token, 'POST', { file_id: 'x' })).status, 400)
        assertEquals((await call('/download-url', a.token, 'POST', { file_id: crypto.randomUUID() })).status, 404)
      })

      await t.step('URL vencida e URL adulterada são recusadas pelo B2', async () => {
        const res = await call('/download-url', a.token, 'POST', { file_id: games[0].files[0].id })
        const key = decodeURIComponent(new URL(res.body.url).pathname.slice(1))
        const old = await presignUrl(readOnlyConfig(), { key, now: new Date(Date.now() - 600_000), expiresIn: 300 })
        const expired = await fetchRetry(old.url)
        const text = await expired.text()
        // O B2 responde 401 com "Request has expired" para a assinatura vencida.
        assertEquals([expired.status, /expired/i.test(text)], [401, true], text.slice(0, 200))
        const forged = await fetchRetry(res.body.url.replace(/X-Amz-Signature=[0-9a-f]{4}/, 'X-Amz-Signature=0000'))
        const forgedText = await forged.text()
        assertEquals([forged.status, /signature/i.test(forgedText)], [403, true], forgedText.slice(0, 200))
      })

      await t.step('link do e-mail: válido baixa o PDF; adulterado 401; vencido vai a Meus jogos', async () => {
        const ok = await link(tokens[0])
        assertEquals(ok.status, 302)
        const pdf = await fetchPdf(ok.location!)
        assertEquals([pdf.status, pdf.type, pdf.disposition.startsWith('attachment')], [200, 'application/pdf', true])

        const tampered = await link(`${tokens[0].slice(0, -4)}AAAA`)
        assertEquals([tampered.status, tampered.body?.error.code], [401, 'INVALID_TOKEN'])

        const claims = await verifyDeliveryToken(tokens[0])
        assert(claims.ok)
        const old = await signDeliveryToken(claims.claims.e, claims.claims.g, Date.now() - 31 * 24 * 3600 * 1000)
        assertEquals((await link(old)).location, 'http://127.0.0.1:5176/meus-jogos?link=expirado')
      })

      await t.step('contestação revoga link e download; vencida devolve o acesso', async () => {
        const dispute = (status: string) => ({ id: `dp_${crypto.randomUUID().slice(0, 8)}`, object: 'dispute', payment_intent: `pi_${sessionA.id.slice(8)}`, reason: 'fraudulent', status })
        assertEquals((await deliver('charge.dispute.created', dispute('needs_response'))).body.outcome, 'applied')
        assertEquals((await link(tokens[0])).location, 'http://127.0.0.1:5176/meus-jogos?link=indisponivel')
        assertEquals((await call('/download-url', a.token, 'POST', { file_id: games[0].files[0].id })).status, 403)
        assertEquals((await deliver('charge.dispute.closed', dispute('won'))).body.outcome, 'applied')
        assertMatch((await link(tokens[0])).location!, /^https:\/\//)
      })

      await t.step('gratuito: indisponível e free-download não serve arquivo pago', async () => {
        assertEquals((await call('/free-game', null)).body, { available: false })
        const paid = await call('/free-download', null, 'POST', { file_id: games[0].files[0].id })
        assertEquals([paid.status, paid.body.error.code], [404, 'FILE_NOT_FOUND'])
      })
    } finally {
      const cleanup = await removeTestUsers()
      console.log(`usuários de teste removidos: ${cleanup.removed}; mantidos pelo banco: ${cleanup.kept}`)
    }
  },
})
