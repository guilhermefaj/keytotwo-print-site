import { rpc, rpcRow } from './admin.ts'
import { env } from './env.ts'
import { signDeliveryToken, signUnsubscribeToken } from './tokens.ts'

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

// Visual da marca (DESIGN.md › E-mails): Papel, Tinta, Turquesa profundo nas ações, a linha de recorte
// tracejada em Turquesa J001 e o Céu só na faixa do topo. Estilos inline e tabelas, para os clientes de e-mail.
const INK = '#123a3d'
const INK_SOFT = '#345b5d'
const ACTION = '#006970'
const LINE = '#1bb8c4'
const SKY = '#ecfaf7'
const RULE = '#d1dbdb'
const FONT = 'Arial,Helvetica,sans-serif'
export const SUPPORT_EMAIL = 'contato@keytotwo.com.br'

const button = (href: string, label: string) =>
  `<p style="margin:0 0 12px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 22px;background:${ACTION};color:#ffffff;text-decoration:none;border-radius:6px;font-family:${FONT};font-size:16px;font-weight:bold;">${escapeHtml(label)}</a></p>`

const paragraph = (html: string, muted = false) =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:${muted ? 14 : 16}px;line-height:1.6;color:${muted ? INK_SOFT : INK};">${html}</p>`

const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${ACTION};font-weight:bold;">${escapeHtml(label)}</a>`

const displayName = (item: Named) => item.name ?? item.code

// "A", "A e B", "A, B e C"
function listNames(items: Named[]): string {
  const names = items.map(displayName)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

// Assinatura: a frase do Kito só nos e-mails de marketing (os que têm rodapé de descadastro); nos de
// serviço (código, confirmação, senha e entrega) a linha neutra, para não competir com o conteúdo.
const KITO_SIGNATURE = 'Um pinguim numa tela pedindo para vocês saírem dela.'
const SERVICE_SIGNATURE = 'KeyToTwo: jogos para casais imprimirem em casa.'

function layout(subject: string, heading: string, body: string, footer = ''): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT};color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;border:2px solid ${LINE};border-radius:14px;">
      <tr><td style="background:${SKY};padding:24px 28px 20px;border-radius:12px 12px 0 0;">
        <p style="margin:0;font-family:${FONT};font-size:22px;font-weight:bold;letter-spacing:-0.5px;color:${INK};">KeyToTwo</p>
        <p style="margin:2px 0 0;font-family:${FONT};font-size:13px;color:${INK_SOFT};">jogos para casais</p>
      </td></tr>
      <tr><td style="border-top:2px dashed ${LINE};padding:28px 28px 12px;">
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:1.2;letter-spacing:-0.3px;color:${INK};">${escapeHtml(heading)}</h1>
        ${body}
        ${footer}
      </td></tr>
      <tr><td style="padding:16px 28px 24px;border-top:1px solid ${RULE};">
        <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:1.5;color:${INK_SOFT};">${footer ? KITO_SIGNATURE : SERVICE_SIGNATURE}</p>
        <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${INK_SOFT};">Dúvidas? Escrevam para ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>
</html>`
}

// Assinatura do texto puro, a mesma do rodapé em HTML.
const textSignature = ['', '--', 'KeyToTwo: jogos para casais', `Dúvidas? ${SUPPORT_EMAIL}`]

// Rodapé e headers de descadastro de todo e-mail de marketing (RFC 8058: POST em 1 clique pelo provedor;
// o link do rodapé abre a página de preferências, que confirma e chama o POST).
async function unsubscribeParts(row: OutboxRow) {
  if (!row.user_id) throw new PermanentEmailError('marketing_sem_usuario')
  const token = encodeURIComponent(await signUnsubscribeToken(row.user_id))
  const page = `${env.siteUrl()}/email/preferencias?token=${token}`
  const account = `${env.siteUrl()}/conta`
  const footer = `<hr style="margin:24px 0 16px;border:0;border-top:2px dashed ${LINE};">
    ${paragraph(`Você recebe este e-mail porque aceitou receber novidades da KeyToTwo. Para parar, é só ${link(page, 'descadastrar')} (vale na hora) ou ajustar em ${link(account, 'Minha conta')}.`, true)}`
  const text = ['', '--', 'Você recebe este e-mail porque aceitou receber novidades da KeyToTwo.', `Descadastrar (vale na hora): ${page}`, `Minha conta: ${account}`]
  const headers = {
    'List-Unsubscribe': `<${env.apiPublicUrl()}/email/unsubscribe?token=${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  return { footer, text, headers }
}

// Um link de baixar por jogo do pedido (/d/{token}, válido por 30 dias), para a entrega e o presente.
async function downloadLinks(row: OutboxRow, apiBase: string, missing: string) {
  const games = (row.payload.games ?? []).filter((g) => g.entitlement_id && Number.isSafeInteger(g.game_id))
  if (!games.length) throw new PermanentEmailError(missing)
  return await Promise.all(games.map(async (game) => ({
    name: displayName(game),
    url: `${apiBase}/d/${await signDeliveryToken(game.entitlement_id!, game.game_id!)}`,
  })))
}

// Entrega (transacional, pt-BR): um botão por jogo (link /d/{token}, válido por 30 dias) e o botão Meus jogos.
export async function renderDelivery(row: OutboxRow, apiBase: string): Promise<Message> {
  const site = env.siteUrl()
  const ref = row.payload.order_ref ?? ''
  const links = await downloadLinks(row, apiBase, 'entrega_sem_jogos')
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
    ...textSignature,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind }
}

// Presente (transacional, 2026-10-23): o jogo que a KeyToTwo deu pelo admin (pedido de cortesia), com os mesmos botões
// da entrega. Sem valor nem pedido: não houve compra.
export async function renderGift(row: OutboxRow, apiBase: string): Promise<Message> {
  const site = env.siteUrl()
  const links = await downloadLinks(row, apiBase, 'presente_sem_jogos')
  const library = `${site}/meus-jogos`
  const help = `${site}/ajuda`
  const subject = 'Um jogo de presente para vocês'
  const names = listNames(links.map((l) => ({ code: l.name, name: l.name })))
  const intro = `A KeyToTwo deu ${names} para vocês. ${links.length > 1 ? 'Já são' : 'Já é'} de vocês: é só baixar, imprimir e jogar.`
  const html = layout(subject, subject, [
    paragraph(escapeHtml(intro)),
    links.map((l) => button(l.url, `Baixar ${l.name}`)).join('\n    '),
    paragraph('Estes botões valem por 30 dias. Os jogos ficam sempre em Meus jogos: é só entrar com este e-mail.', true),
    button(library, 'Abrir Meus jogos'),
    paragraph(`Precisa de ajuda? ${link(help, help)}`, true),
  ].join('\n    '))
  const text = [
    'KeyToTwo', '', subject, '',
    intro, '',
    ...links.map((l) => `Baixar ${l.name}: ${l.url}`), '',
    'Estes links valem por 30 dias. Os jogos ficam sempre em Meus jogos: é só entrar com este e-mail.',
    `Meus jogos: ${library}`, '',
    `Precisa de ajuda? ${help}`,
    ...textSignature,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind }
}

// Lembrete de sacola (marketing): o que ficou na sacola e o botão de volta. Sem preço nem condição nova.
export async function renderCartReminder(row: OutboxRow): Promise<Message> {
  const items = row.payload.items ?? []
  if (!items.length) throw new PermanentEmailError('lembrete_sem_itens')
  const cart = `${env.siteUrl()}/carrinho`
  const { footer, text: footerText, headers } = await unsubscribeParts(row)
  const subject = 'Esqueceram algo na sacola'
  const names = listNames(items)
  const waiting = `${items.length > 1 ? 'continuam' : 'continua'} na sacola, esperando a próxima vez que alguém perguntar "o que a gente faz hoje?".`
  const html = layout(subject, subject, [
    paragraph(`${escapeHtml(names)} ${waiting}`),
    button(cart, 'Voltar à sacola'),
    paragraph('Se já resolveram isso por outro caminho, podem ignorar este e-mail.', true),
  ].join('\n    '), footer)
  const text = [
    'KeyToTwo', '', subject, '',
    `${names} ${waiting}`, '',
    `Voltar à sacola: ${cart}`, '',
    'Se já resolveram isso por outro caminho, podem ignorar este e-mail.',
    ...footerText,
    ...textSignature,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers }
}

// Pós-compra (marketing): convite para jogar, Meus jogos e dicas de impressão.
export async function renderPostPurchase(row: OutboxRow): Promise<Message> {
  const games = row.payload.games ?? []
  if (!games.length) throw new PermanentEmailError('pos_compra_sem_jogos')
  const library = `${env.siteUrl()}/meus-jogos`
  const printing = `${env.siteUrl()}/ajuda#impressao`
  const { footer, text: footerText, headers } = await unsubscribeParts(row)
  const subject = 'Já rolou a primeira partida?'
  const names = listNames(games)
  const invite = `Se ainda não ${games.length > 1 ? 'saíram' : 'saiu'} da pasta de downloads, fica o convite: imprimam, escolham quem começa e deixem as notificações para depois.`
  const html = layout(subject, 'Já rolou a primeira partida?', [
    paragraph(`Faz alguns dias que ${escapeHtml(names)} ${games.length > 1 ? 'chegaram' : 'chegou'}. ${invite}`),
    button(library, 'Abrir Meus jogos'),
    paragraph(`Os arquivos ficam sempre em Meus jogos. Dicas para imprimir: ${link(printing, 'Ajuda')}.`, true),
  ].join('\n    '), footer)
  const text = [
    'KeyToTwo', '', 'Já rolou a primeira partida?', '',
    `Faz alguns dias que ${names} ${games.length > 1 ? 'chegaram' : 'chegou'}. ${invite}`, '',
    `Meus jogos: ${library}`,
    `Dicas para imprimir: ${printing}`,
    ...footerText,
    ...textSignature,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers }
}

export async function render(row: OutboxRow): Promise<Message> {
  switch (row.kind) {
    case 'delivery':
      return await renderDelivery(row, env.apiPublicUrl())
    case 'gift':
      return await renderGift(row, env.apiPublicUrl())
    case 'cart_reminder':
      return await renderCartReminder(row)
    case 'post_purchase':
      return await renderPostPurchase(row)
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
