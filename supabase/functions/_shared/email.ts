import { rpc, rpcRow } from './admin.ts'
import { env } from './env.ts'
import { signDeliveryToken } from './tokens.ts'

// Fila de e-mail por RPC (data-contract 6.7): claim → envio → mark_email_result. O banco decide novas tentativas
// e confere de novo, no claim, o opt-in, a confirmação do e-mail e a supressão dos e-mails de marketing.

type Named = { code: string; name: string | null }

export interface OutboxRow {
  id: string
  kind: string
  category: string
  user_id: string | null
  order_id: string | null
  to_email: string
  payload: {
    order_ref?: string
    cart_version?: number
    items?: Named[]
    games?: (Named & { entitlement_id?: string; game_id?: number })[]
  }
  attempts: number
}

export interface Message {
  to: string
  subject: string
  html: string
  text: string
  tag: string
  headers?: Record<string, string>
}

export interface DispatchSummary {
  claimed: number
  sent: number
  failed: number
  rejected: number
}

// Falha que um novo envio não resolve (ex.: 4xx da Brevo, destinatário fora da lista de teste).
export class PermanentEmailError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'PermanentEmailError'
  }
}

export class TransientEmailError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TransientEmailError'
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const button = (href: string, label: string) =>
  `<p style="margin:0 0 12px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;background:#2b2622;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:bold;">${escapeHtml(label)}</a></p>`

const paragraph = (html: string, muted = false) =>
  `<p style="margin:0 0 16px;font-size:${muted ? 14 : 16}px;line-height:1.5;${muted ? 'color:#5c534b;' : ''}">${html}</p>`

const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:#2b2622;">${escapeHtml(label)}</a>`

const displayName = (item: Named) => item.name ?? item.code

function layout(subject: string, heading: string, body: string, footer = ''): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#2b2622;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 24px;font-size:20px;font-weight:bold;">KeyToTwo</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(heading)}</h1>
    ${body}
    ${footer}
  </div>
</body>
</html>`
}

// Entrega (transacional, pt-BR): um botão por jogo (link /d/{token}, válido por 30 dias) e o botão Meus jogos.
export async function renderDelivery(row: OutboxRow, apiBase: string): Promise<Message> {
  const site = env.siteUrl()
  const ref = row.payload.order_ref ?? ''
  const games = (row.payload.games ?? []).filter((g) => g.entitlement_id && Number.isSafeInteger(g.game_id))
  if (!games.length) throw new PermanentEmailError('entrega_sem_jogos')
  const links = await Promise.all(games.map(async (game) => ({
    name: displayName(game),
    url: `${apiBase}/d/${await signDeliveryToken(game.entitlement_id!, game.game_id!)}`,
  })))
  const library = `${site}/meus-jogos`
  const help = `${site}/ajuda`
  const subject = ref ? `Seus jogos chegaram (pedido ${ref})` : 'Seus jogos chegaram'
  const html = layout(subject, 'Seus jogos chegaram', [
    paragraph(`O pagamento${ref ? ` do pedido ${escapeHtml(ref)}` : ''} foi confirmado e os jogos já são de vocês. É só baixar, imprimir e jogar.`),
    links.map((l) => button(l.url, `Baixar ${l.name}`)).join('\n    '),
    paragraph('Estes botões valem por 30 dias. Os jogos ficam sempre em Meus jogos: é só entrar com este e-mail.', true),
    button(library, 'Abrir Meus jogos'),
    paragraph(`Precisa de ajuda? ${link(help, help)}`, true),
  ].join('\n    '))
  const text = [
    'KeyToTwo', '', 'Seus jogos chegaram', '',
    `O pagamento${ref ? ` do pedido ${ref}` : ''} foi confirmado e os jogos já são de vocês. É só baixar, imprimir e jogar.`, '',
    ...links.map((l) => `Baixar ${l.name}: ${l.url}`), '',
    'Estes links valem por 30 dias. Os jogos ficam sempre em Meus jogos: é só entrar com este e-mail.',
    `Meus jogos: ${library}`, '',
    `Precisa de ajuda? ${help}`,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind }
}

export async function render(row: OutboxRow): Promise<Message> {
  switch (row.kind) {
    case 'delivery':
      return await renderDelivery(row, env.apiPublicUrl())
    default:
      throw new PermanentEmailError('kind_desconhecido')
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
export async function sendMessage(message: Message, rowId: string): Promise<string> {
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
