import { rpc, rpcRow } from './admin.ts'
import { runInBackground } from './background.ts'
import { type Message, type OutboxRow, PermanentEmailError, render } from './email-templates.ts'
import { env } from './env.ts'

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

// Modo brevo: API v3 (as funções não podem usar SMTP). Só com chave v3 e, fora da produção, só para a lista de teste.
async function sendBrevo(message: Message): Promise<string> {
  const key = env.brevoApiKey()
  if (!key.startsWith('xkeysib-')) throw new PermanentEmailError('brevo_chave_nao_v3')
  const allowed = env.emailAllowedRecipients()
  if (allowed.length && !allowed.includes(message.to.toLowerCase())) throw new PermanentEmailError('fora_da_lista_de_teste')
  const from = env.emailFrom()
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from.email, name: from.name }, to: [{ email: message.to }], subject: message.subject,
      htmlContent: message.html, textContent: message.text, tags: [message.tag], ...(message.headers ? { headers: message.headers } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await res.json().catch(() => ({}))
  if (res.ok && typeof body.messageId === 'string') return body.messageId
  const code = `brevo_http_${res.status}${typeof body.code === 'string' ? `_${body.code}` : ''}`
  // 401/403 são configuração (chave, IP não autorizado): a fila tenta de novo depois da correção.
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) throw new TransientEmailError(code)
  throw new PermanentEmailError(code)
}

// Envia pelo modo configurado (EMAIL_MODE) e devolve o id do provedor.
async function sendMessage(message: Message, rowId: string): Promise<string> {
  return env.emailMode() === 'brevo' ? await sendBrevo(message) : await sendLog(message, rowId)
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
