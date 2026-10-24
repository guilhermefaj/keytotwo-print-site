import { env } from './env.ts'
import { DELIVERY_TTL_SECONDS, signDeliveryToken, signUnsubscribeToken } from './tokens.ts'

// Modelos dos e-mails da fila (data-contract 6.7): de cada linha da email_outbox sai a mensagem pronta para enviar.

type Named = { code: string; name: string | null }

// Um alerta como a varredura do banco fotografa (private.alert_json).
type Alert = { kind: string; order_id: string | null; order_ref: string | null; livemode: boolean | null; details: Record<string, unknown> }

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
    amount_total?: number
    currency?: string
    items?: Named[]
    games?: (Named & { entitlement_id?: string; game_id?: number })[]
    alerts?: Alert[]
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

// Reembolso (transacional, 2026-10-24, Fase 3): o pedido inteiro devolvido, pelo admin ou direto na Stripe. Diz o valor,
// que volta pelo mesmo meio de pagamento, e que os jogos saíram de Meus jogos. O prazo é do banco ou do cartão.
async function refund(row: OutboxRow): Promise<Message> {
  const { order_ref: ref, amount_total: amount, currency } = row.payload
  if (!ref || !Number.isSafeInteger(amount) || !currency) throw new PermanentEmailError('reembolso_sem_valor')
  const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(amount! / 100)
  const names = listNames((row.payload.items ?? []).map(displayName))
  const help = `${env.siteUrl()}/ajuda`
  const subject = `Reembolso do pedido ${ref}`
  const heading = 'Reembolso feito'
  const intro = `Fizemos o reembolso do pedido ${ref}${names ? ` (${names})` : ''}. O valor de ${value} volta pelo mesmo meio de pagamento.`
  const timing = 'O prazo para aparecer no extrato ou na fatura depende do banco ou do cartão.'
  const access = 'Os jogos deste pedido saíram de Meus jogos, e os links de baixar não funcionam mais.'
  const html = layout(subject, heading, [
    paragraph(escapeHtml(intro)),
    paragraph(timing, true),
    paragraph(access),
    paragraph(`Precisa de ajuda? ${link(help, help)}`, true),
  ].join('\n    '))
  const text = ['KeyToTwo', '', heading, '', intro, '', timing, '', access, '', `Precisa de ajuda? ${help}`, ...textSignature(false)].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind }
}

// Alerta dos admins (transacional, 2026-10-24): o que abriu na varredura ou no webhook, uma linha por alerta com o que
// fazer e os links (o pedido no admin, a contestação ou o evento na Stripe). Sem e-mail nem nome de cliente.
const EMAIL_KINDS: Record<string, string> = { delivery: 'O e-mail de acesso', gift: 'O e-mail do presente', refund: 'O aviso de reembolso' }

function alertCopy(alert: Alert): { text: string; links: { href: string; label: string }[] } {
  const d = alert.details
  const ref = alert.order_ref ?? ''
  const stripe = `https://dashboard.stripe.com/${(d.livemode ?? alert.livemode) === false ? 'test/' : ''}`
  const links: { href: string; label: string }[] = alert.order_id ? [{ href: `${env.adminUrl()}/pedidos/${alert.order_id}`, label: 'Ver o pedido' }] : []
  switch (alert.kind) {
    case 'dispute': {
      const amount = Number.isSafeInteger(d.amount) && typeof d.currency === 'string'
        ? ` (${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: d.currency.toUpperCase() }).format((d.amount as number) / 100)})` : ''
      const due = typeof d.due_by === 'string'
        ? `até ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(d.due_by))}`
        : 'dentro do prazo que ela der'
      if (typeof d.dispute_id === 'string') links.push({ href: `${stripe}disputes/${d.dispute_id}`, label: 'Abrir na Stripe' })
      return { text: `Contestação no pedido ${ref}${amount}. Mande as provas na Stripe ${due}.`, links }
    }
    case 'delivery_failed': {
      const what = `${EMAIL_KINDS[String(d.email_kind)] ?? 'O e-mail'} do pedido ${ref}`
      const problem = d.cause === 'bounced' ? `${what} voltou: o endereço não recebe e-mails.` : `${what} não saiu.`
      const action = d.email_kind === 'refund' ? 'Avise a pessoa por outro caminho.' : 'Confira o e-mail da pessoa e use Reenviar na ficha do pedido.'
      return { text: `${problem} ${action}`, links }
    }
    case 'order_stuck':
      return { text: `O pedido ${ref} está aberto há mais de 26 horas: o aviso da Stripe não chegou. Use Conferir com a Stripe na ficha do pedido.`, links }
    case 'stripe_unmatched':
      if (typeof d.event_id === 'string') links.push({ href: `${stripe}events/${d.event_id}`, label: 'Abrir na Stripe' })
      return { text: `A Stripe avisou um pagamento (${String(d.type)}) de um pedido que não existe aqui. Confira o evento na Stripe.`, links }
    case 'email_queue_stuck':
      return { text: 'Os e-mails estão parados na fila há mais de 30 minutos.', links }
    case 'backup_late':
      return { text: 'A cópia de segurança do banco não roda há mais de 26 horas.', links }
    default:
      throw new PermanentEmailError('alerta_desconhecido')
  }
}

async function adminAlert(row: OutboxRow): Promise<Message> {
  const alerts = (row.payload.alerts ?? []).map(alertCopy)
  if (!alerts.length) throw new PermanentEmailError('alerta_sem_itens')
  const page = `${env.adminUrl()}/atencao`
  const count = alerts.length
  const subject = `Admin KeyToTwo: ${count} ${count > 1 ? 'alertas novos' : 'alerta novo'}`
  const heading = 'Precisa de atenção'
  const intro = count > 1 ? `Apareceram ${count} alertas novos no admin da KeyToTwo.` : 'Apareceu um alerta novo no admin da KeyToTwo.'
  const why = 'Você recebe este aviso porque é admin da KeyToTwo. Cada alerta avisa uma vez só.'
  const html = layout(subject, heading, [
    paragraph(escapeHtml(intro)),
    ...alerts.map((a) => paragraph(`${escapeHtml(a.text)}${a.links.map((l) => ` ${link(l.href, l.label)}`).join(' ·')}`)),
    button(page, 'Abrir Atenção no admin'),
    paragraph(why, true),
  ].join('\n    '))
  const text = [
    'KeyToTwo', '', heading, '', intro, '',
    ...alerts.flatMap((a) => [`- ${a.text}`, ...a.links.map((l) => `  ${l.label}: ${l.href}`)]), '',
    `Abrir Atenção no admin: ${page}`, '', why,
    ...textSignature(false),
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind }
}

const templates: Record<string, (row: OutboxRow) => Promise<Message>> = {
  delivery,
  gift,
  refund,
  admin_alert: adminAlert,
  cart_reminder: cartReminder,
  post_purchase: postPurchase,
}

export async function render(row: OutboxRow): Promise<Message> {
  if (!Object.hasOwn(templates, row.kind)) throw new PermanentEmailError('kind_desconhecido')
  return await templates[row.kind](row)
}
