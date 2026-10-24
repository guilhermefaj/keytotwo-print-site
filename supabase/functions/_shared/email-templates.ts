import { env } from './env.ts'
import { DELIVERY_TTL_SECONDS, signDeliveryToken, signUnsubscribeToken } from './tokens.ts'

// Modelos dos e-mails da fila (data-contract 6.7): de cada linha da email_outbox sai a mensagem pronta para enviar.

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

// Falha que um novo envio não resolve (ex.: 4xx da Brevo, destinatário fora da lista de teste).
export class PermanentEmailError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'PermanentEmailError'
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
const SUPPORT_EMAIL = 'contato@keytotwo.com.br'
// Validade dos links de baixar, a mesma do token de entrega.
const LINK_DAYS = DELIVERY_TTL_SECONDS / 86_400

const button = (href: string, label: string) =>
  `<p style="margin:0 0 12px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 22px;background:${ACTION};color:#ffffff;text-decoration:none;border-radius:6px;font-family:${FONT};font-size:16px;font-weight:bold;">${escapeHtml(label)}</a></p>`

const paragraph = (html: string, muted = false) =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:${muted ? 14 : 16}px;line-height:1.6;color:${muted ? INK_SOFT : INK};">${html}</p>`

const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${ACTION};font-weight:bold;">${escapeHtml(label)}</a>`

const displayName = (item: Named) => item.name ?? item.code

// "A", "A e B", "A, B e C"
function listNames(names: string[]): string {
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

// Assinatura do texto puro, a mesma do rodapé em HTML (a do Kito só no marketing).
const textSignature = (marketing: boolean) => ['', '--', marketing ? KITO_SIGNATURE : SERVICE_SIGNATURE, `Dúvidas? Escrevam para ${SUPPORT_EMAIL}.`]

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

// Entrega e presente (transacionais, pt-BR): um botão por jogo (link /d/{token}) e o botão Meus jogos. O presente
// (2026-10-23, pedido de cortesia do admin) não fala em valor nem em pedido: não houve compra.
async function downloadsEmail(row: OutboxRow, copy: { subject: string; heading: string; missing: string; intro: (names: string[]) => string }): Promise<Message> {
  const games = (row.payload.games ?? []).filter((g) => g.entitlement_id && Number.isSafeInteger(g.game_id))
  if (!games.length) throw new PermanentEmailError(copy.missing)
  const api = env.apiPublicUrl()
  const links = await Promise.all(games.map(async (game) => ({
    name: displayName(game),
    url: `${api}/d/${await signDeliveryToken(game.entitlement_id!, game.game_id!)}`,
  })))
  const site = env.siteUrl()
  const library = `${site}/meus-jogos`
  const help = `${site}/ajuda`
  const intro = copy.intro(links.map((l) => l.name))
  const keep = `Os jogos ficam sempre em Meus jogos: é só entrar com este e-mail.`
  const html = layout(copy.subject, copy.heading, [
    paragraph(escapeHtml(intro)),
    links.map((l) => button(l.url, `Baixar ${l.name}`)).join('\n    '),
    paragraph(`Estes botões valem por ${LINK_DAYS} dias. ${keep}`, true),
    button(library, 'Abrir Meus jogos'),
    paragraph(`Precisa de ajuda? ${link(help, help)}`, true),
  ].join('\n    '))
  const text = [
    'KeyToTwo', '', copy.heading, '',
    intro, '',
    ...links.map((l) => `Baixar ${l.name}: ${l.url}`), '',
    `Estes links valem por ${LINK_DAYS} dias. ${keep}`,
    `Meus jogos: ${library}`, '',
    `Precisa de ajuda? ${help}`,
    ...textSignature(false),
  ].join('\n')
  return { to: row.to_email, subject: copy.subject, html, text, tag: row.kind }
}

function delivery(row: OutboxRow): Promise<Message> {
  const ref = row.payload.order_ref ?? ''
  return downloadsEmail(row, {
    subject: ref ? `Seus jogos chegaram (pedido ${ref})` : 'Seus jogos chegaram',
    heading: 'Seus jogos chegaram',
    missing: 'entrega_sem_jogos',
    intro: () => `O pagamento${ref ? ` do pedido ${ref}` : ''} foi confirmado e os jogos já são de vocês. É só baixar, imprimir e jogar.`,
  })
}

function gift(row: OutboxRow): Promise<Message> {
  const subject = 'Um jogo de presente para vocês'
  return downloadsEmail(row, {
    subject,
    heading: subject,
    missing: 'presente_sem_jogos',
    intro: (names) => `A KeyToTwo deu ${listNames(names)} para vocês. ${names.length > 1 ? 'Já são' : 'Já é'} de vocês: é só baixar, imprimir e jogar.`,
  })
}

// Lembrete de sacola (marketing): o que ficou na sacola e o botão de volta. Sem preço nem condição nova.
async function cartReminder(row: OutboxRow): Promise<Message> {
  const items = row.payload.items ?? []
  if (!items.length) throw new PermanentEmailError('lembrete_sem_itens')
  const cart = `${env.siteUrl()}/carrinho`
  const { footer, text: footerText, headers } = await unsubscribeParts(row)
  const subject = 'Esqueceram algo na sacola'
  const names = listNames(items.map(displayName))
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
    ...textSignature(true),
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers }
}

// Pós-compra (marketing): convite para jogar, Meus jogos e dicas de impressão.
async function postPurchase(row: OutboxRow): Promise<Message> {
  const games = row.payload.games ?? []
  if (!games.length) throw new PermanentEmailError('pos_compra_sem_jogos')
  const library = `${env.siteUrl()}/meus-jogos`
  const printing = `${env.siteUrl()}/ajuda#impressao`
  const { footer, text: footerText, headers } = await unsubscribeParts(row)
  const subject = 'Já rolou a primeira partida?'
  const names = listNames(games.map(displayName))
  const invite = `Se ainda não ${games.length > 1 ? 'saíram' : 'saiu'} da pasta de downloads, fica o convite: imprimam, escolham quem começa e deixem as notificações para depois.`
  const html = layout(subject, subject, [
    paragraph(`Faz alguns dias que ${escapeHtml(names)} ${games.length > 1 ? 'chegaram' : 'chegou'}. ${invite}`),
    button(library, 'Abrir Meus jogos'),
    paragraph(`Os arquivos ficam sempre em Meus jogos. Dicas para imprimir: ${link(printing, 'Ajuda')}.`, true),
  ].join('\n    '), footer)
  const text = [
    'KeyToTwo', '', subject, '',
    `Faz alguns dias que ${names} ${games.length > 1 ? 'chegaram' : 'chegou'}. ${invite}`, '',
    `Meus jogos: ${library}`,
    `Dicas para imprimir: ${printing}`,
    ...footerText,
    ...textSignature(true),
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers }
}

const templates: Record<string, (row: OutboxRow) => Promise<Message>> = {
  delivery,
  gift,
  cart_reminder: cartReminder,
  post_purchase: postPurchase,
}

export async function render(row: OutboxRow): Promise<Message> {
  if (!Object.hasOwn(templates, row.kind)) throw new PermanentEmailError('kind_desconhecido')
  return await templates[row.kind](row)
}
