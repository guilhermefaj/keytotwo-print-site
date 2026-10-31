// I5 contra o banco local (migração do I5: record_email_event, enqueue_followups, dispatch_tick) e o Mailpit.
// A Stripe é simulada (stripe-fake.ts). O tempo é simulado chamando private.enqueue_followups(p_now) pelo psql do
// contêiner local (só aqui, no teste): o banco grava scheduled_at = least(p_now, now()), e o claim pega na hora.
// E-mail só em modo log (cópia no Mailpit local); nada sai para fora.
//   KT_INTEGRATION=1 npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json \
//     --allow-env --allow-read --allow-net --allow-run=docker supabase/functions/tests/followups.integration.test.ts
// O passo do Lastro supabase/local/aplicar-dispatch-vault.mjs precisa ter rodado (Vault com URL e chave do despacho).
import { assert, assertEquals, assertMatch } from '@std/assert'
import { enabled, lastMail, mailCount, MAILPIT_URL, removeTestUsers, settle, sleep } from './integration-helpers.ts'
import { buyer, call, deliver, pay, sessionObject, startCheckout } from './stripe-fake.ts'
import { handleBrevoWebhook } from '../brevo-webhook/handler.ts'
import { handleEmailDispatch } from '../email-dispatch/handler.ts'
import { signUnsubscribeToken } from '../_shared/tokens.ts'

const DB_CONTAINER = 'supabase_db_keytotwo-print-site'
const FUNCTIONS_URL = `${Deno.env.get('API_URL') || 'http://127.0.0.1:54321'}/functions/v1`
// Assunto do lembrete desde 2026-10-31: "<item> ficou na sacola" com um item. A busca do Mailpit é por trecho.
const REMINDER = 'ficou na sacola'
const POST_PURCHASE = 'Já rolou a primeira partida?'

if (enabled) {
  const wanted = ['EMAIL_LINK_SECRET', 'API_PUBLIC_URL', 'EMAIL_FROM', 'EMAIL_FROM_NAME', 'BREVO_WEBHOOK_SECRET']
  for (const line of (await Deno.readTextFile(new URL('../.env', import.meta.url))).split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m && wanted.includes(m[1]) && m[2].trim()) Deno.env.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''))
  }
  Deno.env.set('EMAIL_MODE', 'log')
  Deno.env.set('EMAIL_LOG_MAILPIT_URL', MAILPIT_URL)
}

// SQL só de teste, no banco local (ids e estados; nenhum segredo).
async function sql(query: string): Promise<string[]> {
  const out = await new Deno.Command('docker', { args: ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query] }).output()
  if (!out.success) throw new Error(`psql falhou: ${new TextDecoder().decode(out.stderr).slice(0, 300)}`)
  return new TextDecoder().decode(out.stdout).split('\n').filter(Boolean)
}

const uid = (token: string) => JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string
const enqueue = async (ahead: string) => Number((await sql(`select private.enqueue_followups(now() + interval '${ahead}')`))[0])
// Linhas de marketing do usuário: id|kind|status|skip_reason|dedupe_key
const outbox = async (userId: string) =>
  (await sql(`select id||'|'||kind||'|'||status||'|'||coalesce(skip_reason,'')||'|'||dedupe_key from public.email_outbox where user_id = '${userId}' and kind <> 'delivery' order by created_at`))
    .map((line) => {
      const [id, kind, status, reason, dedupe] = line.split('|')
      return { id, kind, status, reason, dedupe }
    })

async function dispatchOne(outboxId: string) {
  const res = await handleEmailDispatch(new Request('http://localhost/email-dispatch', {
    method: 'POST', headers: { apikey: Deno.env.get('SUPABASE_SECRET_KEY')!, 'Content-Type': 'application/json' }, body: JSON.stringify({ outbox_id: outboxId }),
  }))
  return await res.json()
}

async function optedInBuyer(name: string) {
  const b = await buyer(name)
  const res = await call('/account/marketing', b.token, 'PUT', { granted: true, source: 'account', text_version: 'consentimento-teste-1' })
  assertEquals(res.status, 200, JSON.stringify(res.body))
  return { ...b, id: uid(b.token) }
}

const addToCart = async (token: string) => assertEquals((await call('/cart/items', token, 'POST', { product_code: 'P001' })).status, 200)

const brevo = (body: unknown, secret = Deno.env.get('BREVO_WEBHOOK_SECRET')!) =>
  handleBrevoWebhook(new Request('http://localhost/brevo-webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body),
  }))

async function mailHeaders(to: string, subject: string): Promise<Record<string, string[]>> {
  const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`)
  const { messages } = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)).json()
  return await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}/headers`)).json()
}

Deno.test({
  name: 'I5 integração: opt-in, descadastro na hora, compra cancela lembrete, dedupe por versão, supressões, webhook e agenda',
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const started = Date.now() - 5_000
    // O cron local (a cada 5 min) poderia despachar as linhas do teste no meio dele: desligado aqui, religado no fim.
    const scheduled = (await sql(`select count(*) from cron.job where jobname = 'email-dispatch-tick'`))[0] === '1'
    if (scheduled) await sql(`select cron.unschedule('email-dispatch-tick')`)
    try {
      await t.step('sem opt-in nada é enfileirado nem enviado', async () => {
        const b = await buyer('i5-sem-optin')
        await addToCart(b.token)
        await enqueue('4 hours')
        assertEquals(await outbox(uid(b.token)), [])
        assertEquals(await mailCount(b.email, REMINDER), 0)
      })

      await t.step('lembrete com opt-in: 1 por versão do carrinho, headers de descadastro e limite de 1 por 24 h', async () => {
        const b = await optedInBuyer('i5-dedupe')
        await addToCart(b.token)
        await enqueue('4 hours')
        await enqueue('5 hours')
        const first = await outbox(b.id)
        assertEquals(first.length, 1)
        assertMatch(first[0].dedupe, new RegExp(`^cart_reminder:${b.id}:\\d+$`))
        assertEquals((await dispatchOne(first[0].id)).sent, 1)
        const mail = await lastMail(b.email, started)
        assert(mail.subject.endsWith(` ${REMINDER}`), mail.subject)
        const headers = await mailHeaders(b.email, REMINDER)
        assertMatch(headers['List-Unsubscribe'][0], /^<http:\/\/127\.0\.0\.1:54321\/functions\/v1\/api\/email\/unsubscribe\?token=/)
        assertEquals(headers['List-Unsubscribe-Post'][0], 'List-Unsubscribe=One-Click')

        // carrinho mudou: nova versão, novo lembrete; o limite de 24 h adia em vez de enviar
        assertEquals((await call('/cart/items/P001', b.token, 'DELETE')).status, 200)
        await addToCart(b.token)
        await enqueue('4 hours')
        const second = (await outbox(b.id)).filter((r) => r.id !== first[0].id)
        assertEquals(second.length, 1)
        assert(second[0].dedupe !== first[0].dedupe)
        assertEquals((await dispatchOne(second[0].id)).claimed, 0)
        assertEquals((await outbox(b.id)).find((r) => r.id === second[0].id)!.status, 'queued')
        assertEquals(await mailCount(b.email, REMINDER), 1)
      })

      await t.step('descadastro em 1 clique bloqueia na hora (lembrete na fila cancelado, opt-in desligado)', async () => {
        const b = await optedInBuyer('i5-optout')
        await addToCart(b.token)
        await enqueue('4 hours')
        const [row] = await outbox(b.id)
        assertEquals(row.status, 'queued')
        const token = await signUnsubscribeToken(b.id)
        const res = await fetch(`${FUNCTIONS_URL}/api/email/unsubscribe?token=${encodeURIComponent(token)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
        })
        assertEquals([res.status, await res.json()], [200, { status: 'unsubscribed' }])
        assertEquals((await call('/account', b.token)).body.marketing.opted_in, false)
        assert(['canceled', 'skipped'].includes((await outbox(b.id))[0].status))
        assertEquals((await dispatchOne(row.id)).claimed, 0)
        await enqueue('8 hours')
        assertEquals((await outbox(b.id)).length, 1)
        assertEquals(await mailCount(b.email, REMINDER), 0)
      })

      await t.step('compra cancela o lembrete pendente', async () => {
        const b = await optedInBuyer('i5-compra')
        await addToCart(b.token)
        await enqueue('4 hours')
        const [row] = await outbox(b.id)
        assertEquals(row.status, 'queued')
        const session = await startCheckout(b.token)
        pay(session)
        assertEquals((await deliver('checkout.session.completed', sessionObject(session))).body.outcome, 'applied')
        await settle()
        const after = (await outbox(b.id)).find((r) => r.id === row.id)!
        assertEquals([after.status, after.reason], ['canceled', 'already_purchased'])
        assertEquals((await dispatchOne(row.id)).claimed, 0)
        assertEquals(await mailCount(b.email, REMINDER), 0)

        // pós-compra em D+3 (simulado), com descadastro pelo header do próprio e-mail
        await enqueue('4 days')
        const post = (await outbox(b.id)).find((r) => r.kind === 'post_purchase')
        assert(post, 'pós-compra não enfileirado')
        assertEquals((await dispatchOne(post.id)).sent, 1)
        await lastMail(b.email, started)
        assertEquals(await mailCount(b.email, POST_PURCHASE), 1)
        const unsubscribeUrl = /^<(.+)>$/.exec((await mailHeaders(b.email, POST_PURCHASE))['List-Unsubscribe'][0])![1]
        const oneClick = await fetch(unsubscribeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })
        assertEquals(oneClick.status, 200)
        await oneClick.body?.cancel()
        assertEquals((await call('/account', b.token)).body.marketing.opted_in, false)
      })

      await t.step('bounce suprime antes de enfileirar; reclamação cancela o que estava na fila e revoga o opt-in', async () => {
        const bounced = await optedInBuyer('i5-bounce')
        assertEquals(await (await brevo({ event: 'hard_bounce', email: bounced.email, 'message-id': '<b@relay>', ts_event: Math.floor(Date.now() / 1000) })).json(), { received: 1, recorded: 1, ignored: 0 })
        await addToCart(bounced.token)
        await enqueue('4 hours')
        assertEquals(await outbox(bounced.id), [])
        assertEquals((await call('/account', bounced.token)).body.marketing.opted_in, true)

        const complained = await optedInBuyer('i5-spam')
        await addToCart(complained.token)
        await enqueue('4 hours')
        const [row] = await outbox(complained.id)
        assertEquals(row.status, 'queued')
        assertEquals((await (await brevo([{ event: 'spam', email: complained.email.toUpperCase() }, { event: 'delivered', email: complained.email }])).json()).recorded, 1)
        assert(['canceled', 'skipped'].includes((await outbox(complained.id))[0].status))
        assertEquals((await call('/account', complained.token)).body.marketing.opted_in, false)
        assertEquals((await dispatchOne(row.id)).claimed, 0)
      })

      await t.step('brevo-webhook servido: segredo inválido 401, correto 200', async () => {
        const post = (secret: string) => fetch(`${FUNCTIONS_URL}/brevo-webhook`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ event: 'delivered', email: 'ninguem@example.com' }),
        })
        const wrong = await post('segredo-errado')
        await wrong.body?.cancel()
        assertEquals(wrong.status, 401)
        const right = await post(Deno.env.get('BREVO_WEBHOOK_SECRET')!)
        assertEquals([right.status, await right.json()], [200, { received: 1, recorded: 0, ignored: 1 }])
      })

      await t.step('agenda: dispatch_tick chama o email-dispatch servido pelo pg_net e o lembrete chega', async () => {
        assert(scheduled, 'job email-dispatch-tick não está agendado')
        const b = await optedInBuyer('i5-agenda')
        await addToCart(b.token)
        await enqueue('4 hours')
        const [row] = await outbox(b.id)
        await sql('select private.dispatch_tick()')
        for (let i = 0; i < 40 && (await outbox(b.id))[0].status !== 'sent'; i++) await sleep(500)
        assertEquals((await outbox(b.id)).find((r) => r.id === row.id)!.status, 'sent')
        const scheduled = (await lastMail(b.email, started)).subject
        assert(scheduled.endsWith(` ${REMINDER}`), scheduled)
      })
    } finally {
      if (scheduled) await sql(`select cron.schedule('email-dispatch-tick', '*/5 * * * *', 'select private.dispatch_tick()')`)
      const cleanup = await removeTestUsers()
      console.log(`usuários de teste removidos: ${cleanup.removed}; mantidos pelo banco: ${cleanup.kept}`)
    }
  },
})
