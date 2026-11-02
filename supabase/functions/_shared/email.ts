import { rpc, rpcRow } from './admin.ts'
import { runInBackground } from './background.ts'
import { type Message, type OutboxRow, PermanentEmailError, render } from './email-templates.ts'
import { env } from './env.ts'
import { sendSes } from './ses.ts'

// Fila de e-mail por RPC (data-contract 6.7): claim → envio → mark_email_result. O banco decide novas tentativas
// e confere de novo, no claim, o opt-in, a confirmação do e-mail e a supressão dos e-mails de marketing.
// Os modelos das mensagens ficam em email-templates.ts.

interface DispatchSummary {
  claimed: number
  sent: number
  failed: number
  rejected: number
}

class TransientEmailError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TransientEmailError'
  }
}

// Modo log: nada sai para fora. Resumo no console (sem e-mail nem token) e cópia no Mailpit local, se configurado.
async function sendLog(message: Message, rowId: string): Promise<string> {
  console.log(`email-dispatch: [log] ${message.tag} ${rowId}`)
  const mailpit = env.emailLogMailpitUrl()
  if (!mailpit) return `log-${crypto.randomUUID()}`
  const from = env.emailFrom()
  const res = await fetch(`${mailpit}/api/v1/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: { Email: from.email, Name: from.name }, To: [{ Email: message.to }], Subject: message.subject,
      HTML: message.html, Text: message.text, Tags: [message.tag], Headers: message.headers ?? {},
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new TransientEmailError(`mailpit_http_${res.status}`)
  const body = await res.json().catch(() => ({}))
  return `log-${body.ID ?? crypto.randomUUID()}`
}

// Modo plunk: API do Plunk na VPS (POST /v1/send), que envia pelo Amazon SES. Contato novo entra lá como não inscrito,
// e os headers da mensagem (o List-Unsubscribe do site) passam por cima dos do Plunk. Fora da produção, só para a lista
// de teste. O texto simples o Plunk tira do HTML.
async function sendPlunk(message: Message): Promise<string> {
  const allowed = env.emailAllowedRecipients()
  if (allowed.length && !allowed.includes(message.to.toLowerCase())) throw new PermanentEmailError('fora_da_lista_de_teste')
  const from = env.emailFrom()
  const res = await fetch(`${env.plunkApiUrl()}/v1/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.plunkSecretKey()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: message.to, subject: message.subject, body: message.html, from: { email: from.email, name: from.name },
      ...(message.headers ? { headers: message.headers } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  const id = body?.data?.emails?.[0]?.email
  if (res.ok && body.success === true && typeof id === 'string') return id
  const code = `plunk_http_${res.status}`
  // 401/403 são configuração (chave, Plunk fora do ar atrás do proxy): a fila tenta de novo depois da correção.
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) throw new TransientEmailError(code)
  throw new PermanentEmailError(code)
}

// Alertas dos admins pelo Amazon SES (2026-11-01): com a VPS fora, o Plunk também está, e o aviso de fora do ar não
// sairia. Só no modo plunk (no log, nada sai para fora). Se o SES falhar (chave errada, envio pausado), o alerta vai
// pelo Plunk, como antes.
async function sendAlertSes(message: Message): Promise<string | null> {
  const config = env.sesAlerts()
  if (!config || message.tag !== 'admin_alert' || env.emailMode() !== 'plunk') return null
  const allowed = env.emailAllowedRecipients()
  if (allowed.length && !allowed.includes(message.to.toLowerCase())) throw new PermanentEmailError('fora_da_lista_de_teste')
  try {
    const result = await sendSes(config, { from: env.emailFrom(), to: message.to, subject: message.subject, html: message.html, text: message.text })
    if (result.messageId) return result.messageId
    console.error(`email-dispatch: alerta pelo SES falhou (ses_http_${result.status} ${result.error}); vai pelo Plunk`)
  } catch (e) {
    console.error(`email-dispatch: alerta pelo SES falhou (${e instanceof Error ? e.name : 'erro'}); vai pelo Plunk`)
  }
  return null
}

// Envia pelo modo configurado (EMAIL_MODE) e devolve o id do provedor.
async function sendMessage(message: Message, rowId: string): Promise<string> {
  const ses = await sendAlertSes(message)
  if (ses) return ses
  switch (env.emailMode()) {
    case 'plunk': return await sendPlunk(message)
    default: return await sendLog(message, rowId)
  }
}

const plunkHeaders = () => ({ Authorization: `Bearer ${env.plunkSecretKey()}`, Accept: 'application/json' })

// Apaga no Plunk o contato do e-mail, com o histórico de envios dele. A busca do Plunk é por trecho do e-mail: só o
// endereço exato é apagado.
async function deletePlunkContact(email: string): Promise<void> {
  const target = email.trim().toLowerCase()
  const base = env.plunkApiUrl()
  const found = await fetch(`${base}/contacts?${new URLSearchParams({ search: target, limit: '100' })}`, { headers: plunkHeaders(), signal: AbortSignal.timeout(10_000) })
  if (!found.ok) throw new Error(`plunk_busca_http_${found.status}`)
  const list = (await found.json().catch(() => ({})))?.data
  const contact = Array.isArray(list) ? list.find((c) => typeof c?.email === 'string' && c.email.toLowerCase() === target) : undefined
  if (!contact || typeof contact.id !== 'string') return
  const res = await fetch(`${base}/contacts/${encodeURIComponent(contact.id)}`, { method: 'DELETE', headers: plunkHeaders(), signal: AbortSignal.timeout(10_000) })
  if (!res.ok && res.status !== 404) throw new Error(`plunk_exclusao_http_${res.status}`)
}

// Exclusão de conta (LGPD): apaga o contato no Plunk em segundo plano e sem falhar a exclusão; se não der, a limpeza
// diária do Plunk (deploy/plunk/limpar.sh) apaga em até 90 dias.
export function forgetEmailContact(email: string | null | undefined): void {
  const target = email?.trim().toLowerCase()
  if (!target || !env.plunkConfigured()) return
  runInBackground('plunk-contato', () => deletePlunkContact(target))
}

// Saída pelo rodapé de um e-mail do Plunk (2026-11-01): a página de preferências do site manda o id do contato. Lê o
// e-mail dele e chama o descadastro de 1 clique do Plunk, o mesmo do List-Unsubscribe: só age se o contato ainda está
// inscrito (sem repetir o evento contact.unsubscribed) e atribui a saída ao e-mail de origem (?e=). As duas rotas são
// públicas no Plunk; o id do contato é a credencial. Contato que não existe mais: null.
export async function unsubscribePlunkContact(contactId: string, emailId?: string): Promise<string | null> {
  const base = env.plunkApiUrl()
  const id = encodeURIComponent(contactId)
  const found = await fetch(`${base}/contacts/public/${id}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (found.status === 404) return null
  if (!found.ok) throw new Error(`plunk_contato_http_${found.status}`)
  const email = (await found.json().catch(() => ({})))?.email
  if (typeof email !== 'string' || !email.includes('@')) throw new Error('plunk_contato_sem_email')
  const query = emailId ? `?${new URLSearchParams({ e: emailId })}` : ''
  const res = await fetch(`${base}/unsubscribe/${id}${query}`, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`plunk_descadastro_http_${res.status}`)
  return email
}

// Contatos de marketing no Plunk (2026-10-31, fase 4): o banco marca quem mudou (private.marketing_contacts) e aqui vai o
// estado atual de cada um, pela atualização do contato (POST /contacts). Na primeira inscrição vai também o evento
// "inscricao" (POST /events/track, com o id do contato), que começa as boas-vindas no Plunk. O /v1/track do Plunk não
// serve: ele só aceita a chave pública. Quando a pessoa trocou de e-mail, o contato antigo sai
// de lá. Só no modo plunk (nos outros a marca fica esperando); fora da produção, só a lista de teste.
export const WELCOME_EVENT = 'inscricao'

interface ContactRow {
  user_id: string
  email: string
  previous_email: string | null
  subscribed: boolean
  push_subscribed: boolean
  welcome: boolean
  data: Record<string, unknown>
}

async function plunkPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${env.plunkApiUrl()}${path}`, {
    method: 'POST',
    headers: { ...plunkHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`plunk${path.replace(/\W+/g, '_')}_http_${res.status}`)
  return await res.json().catch(() => ({}))
}

export async function syncMarketingContacts(limit = 20): Promise<{ claimed: number; synced: number; failed: number } | null> {
  if (env.emailMode() !== 'plunk') return null
  const rows = (await rpc<ContactRow[] | null>('claim_marketing_contacts', { p_limit: limit })) ?? []
  const allowed = env.emailAllowedRecipients()
  const summary = { claimed: rows.length, synced: 0, failed: 0 }
  for (const row of rows) {
    // a inscrição mandada: true nas boas-vindas; senão a do lote, ou nenhuma (o Plunk guarda a que tem)
    const subscribed = row.welcome ? true : row.push_subscribed ? row.subscribed : null
    try {
      if (allowed.length && !allowed.includes(row.email)) throw new Error('fora_da_lista_de_teste')
      if (row.previous_email) await deletePlunkContact(row.previous_email)
      const contact = await plunkPost('/contacts', { email: row.email, data: row.data, ...(subscribed === null ? {} : { subscribed }) })
      if (row.welcome) {
        if (typeof contact.id !== 'string') throw new Error('plunk_contato_sem_id')
        await plunkPost('/events/track', { name: WELCOME_EVENT, contactId: contact.id })
      }
      await rpc('mark_marketing_contact', { p_user_id: row.user_id, p_email: row.email, p_subscribed: subscribed, p_welcomed: row.welcome })
      summary.synced++
    } catch (e) {
      const error = e instanceof Error ? e.message : 'erro'
      console.error(`email-dispatch: contato ${row.user_id} não foi ao Plunk (${error})`)
      await rpc('mark_marketing_contact', { p_user_id: row.user_id, p_error: error })
      summary.failed++
    }
  }
  return summary
}

export async function dispatchEmails(options: { limit?: number; outboxId?: string } = {}): Promise<DispatchSummary> {
  const rows = (await rpc<OutboxRow[] | null>('claim_email_batch', { p_limit: options.limit ?? 20, p_outbox_id: options.outboxId ?? null })) ?? []
  const summary: DispatchSummary = { claimed: rows.length, sent: 0, failed: 0, rejected: 0 }
  for (const row of rows) {
    let status: 'sent' | 'failed' | 'rejected'
    let messageId: string | null = null
    let error: string | null = null
    try {
      messageId = await sendMessage(await render(row), row.id)
      status = 'sent'
    } catch (e) {
      status = e instanceof PermanentEmailError ? 'rejected' : 'failed'
      error = e instanceof PermanentEmailError || e instanceof TransientEmailError ? e.code : e instanceof Error ? e.name : 'erro'
      console.error(`email-dispatch: ${row.kind} ${row.id} ${status} (${error})`)
    }
    await rpcRow('mark_email_result', { p_id: row.id, p_status: status, p_provider_message_id: messageId, p_error: error })
    summary[status]++
  }
  return summary
}

// Envia já, em segundo plano e depois do commit, o e-mail que a RPC acabou de pôr na fila. Se falhar, a agenda reenvia.
export function dispatchSoon(label: string, outboxId: string | null | undefined): void {
  if (outboxId) runInBackground(label, () => dispatchEmails({ outboxId }))
}
