import { env } from './env.ts'
import { DELIVERY_TTL_SECONDS, signDeliveryToken, signUnsubscribeToken } from './tokens.ts'

// Modelos dos e-mails da fila (data-contract 6.7): de cada linha da email_outbox sai a mensagem pronta para enviar.

type Named = { code: string; name: string | null }

// Um alerta como a varredura do banco fotografa (private.alert_json).
type Alert = { kind: string; order_id: string | null; order_ref: string | null; livemode: boolean | null; details: Record<string, unknown>; resolved_at?: string | null }

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
    back?: boolean
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

// Falha que um novo envio não resolve (ex.: 4xx do Plunk, destinatário fora da lista de teste).
export class PermanentEmailError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'PermanentEmailError'
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Visual "Bilhete de recorte" (2026-10-31, aprovado pelo responsável): folha de papel com a linha de recorte tracejada,
// um traço de marca-texto atrás de uma palavra do título, o Kito em três quartos só no marketing e só o tema claro. Cores
// do site (tokens.css) e fontes da marca com reserva para os clientes que não carregam fonte. Estilos inline e tabelas.
const INK = '#123a3d'
const INK_SOFT = '#345b5d'
const ACTION = '#006970'
const LINE = '#1bb8c4'
const MARK = '#ffb866'
const SKY = '#ecfaf7'
const RULE = '#d1dbdb'
const CREME = '#fff8eb'
const DISPLAY = "'Bricolage Grotesque','Trebuchet MS',Arial,sans-serif"
const FONT = "'DM Sans',Arial,Helvetica,sans-serif"
const MONO = "'IBM Plex Mono','Courier New',monospace"
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=DM+Sans:wght@400;700&family=IBM+Plex+Mono:wght@500&display=swap'
const SUPPORT_EMAIL = 'contato@keytotwo.com.br'
const LEGAL = 'KeyToTwo é uma marca da Chalk Labs Consultoria em TI Ltda., CNPJ 66.782.936/0001-20.'
// Validade dos links de baixar, a mesma do token de entrega.
const LINK_DAYS = DELIVERY_TTL_SECONDS / 86_400

const button = (href: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;"><tr>
      <td align="center" bgcolor="${ACTION}" style="border-radius:6px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 26px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td>
    </tr></table>`

const paragraph = (html: string, muted = false, last = false) =>
  `<p style="margin:0 0 ${last ? 0 : muted ? 12 : 16}px;font-family:${FONT};font-size:${muted ? 14 : 16}px;line-height:1.65;color:${muted ? INK_SOFT : INK};">${html}</p>`

const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="font-family:${FONT};color:${ACTION};font-weight:700;text-decoration:underline;">${escapeHtml(label)}</a>`

// Título com um traço de marca-texto atrás de uma palavra (a regra do site: um por página); as palavras marcadas não se
// separam na quebra de linha. Os pedaços já vêm sem HTML.
const title = (before: string, marked: string, after = '') =>
  `<h1 style="margin:0 0 18px;font-family:${DISPLAY};font-size:30px;line-height:1.18;font-weight:800;letter-spacing:-0.6px;color:${INK};">${escapeHtml(before)}<span style="background:${MARK};color:${INK};padding:0 6px;border-radius:3px;white-space:nowrap;">${escapeHtml(marked)}</span>${escapeHtml(after)}</h1>`

// Abertura do marketing: o título à esquerda e o Kito em três quartos à direita, olhando para o texto.
const kitoTitle = (h1: string, pose: string, alt: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;"><tr>
      <td valign="bottom" style="padding:0 12px 0 0;">${h1}</td>
      <td valign="bottom" width="120" style="width:120px;padding:0 0 14px;"><img class="k-kito" src="${env.siteUrl()}/media/email/kito-${pose}.png" width="120" height="120" alt="${escapeHtml(alt)}" style="display:block;width:120px;height:120px;border:0;"></td>
    </tr></table>`

// Lista de jogos: o nome e, quando há, o link de baixar na mesma linha, separados por fio claro.
const gameRows = (items: { name: string; note?: string; href?: string }[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border-top:1px solid ${RULE};">
      ${items.map((item) => `<tr><td style="padding:14px 0;border-bottom:1px solid ${RULE};">
        <p style="margin:0;font-family:${DISPLAY};font-size:17px;font-weight:700;color:${INK};">${escapeHtml(item.name)}</p>${item.note ? `
        <p style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK_SOFT};">${escapeHtml(item.note)}</p>` : ''}
      </td>${item.href ? `<td align="right" valign="middle" style="padding:14px 0 14px 12px;border-bottom:1px solid ${RULE};white-space:nowrap;">${link(item.href, 'Baixar')}</td>` : ''}</tr>`).join('\n      ')}
    </table>`

const tips = (list: [string, string][]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
      ${list.map(([lead, rest], i) => `<tr><td valign="top" width="34" style="padding:0 0 14px;font-family:${MONO};font-size:14px;color:${ACTION};">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:0 0 14px;"><p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK};"><strong>${escapeHtml(lead)}</strong> ${escapeHtml(rest)}</p></td></tr>`).join('\n      ')}
    </table>`

// Cupom de recortar: o código em mono, sobre a creme, com borda de recorte.
const coupon = (code: string, note: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;"><tr>
      <td style="background:${CREME};border:2px dashed ${INK};border-radius:8px;padding:18px 20px;">
        <p style="margin:0 0 6px;font-family:${MONO};font-size:12px;letter-spacing:1.4px;color:${INK_SOFT};">CUPOM</p>
        <p style="margin:0 0 8px;font-family:${MONO};font-size:26px;font-weight:500;letter-spacing:3px;color:${INK};">${escapeHtml(code)}</p>
        <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${INK};">${escapeHtml(note)}</p>
      </td></tr></table>`

const ps = (html: string) => `<p style="margin:18px 0 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};"><strong>P.S.</strong> ${html}</p>`

const displayName = (item: Named) => item.name ?? item.code

// "A", "A e B", "A, B e C"
function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

// Assinatura: a frase do Kito só nos e-mails de marketing (os que têm rodapé de descadastro); nos de
// serviço (código, confirmação, senha e entrega) a linha neutra, para não competir com o conteúdo.
const KITO_SIGNATURE = 'Um pinguim numa tela pedindo para vocês saírem dela.'
const SERVICE_SIGNATURE = 'KeyToTwo: jogos para casais imprimirem em casa.'

interface Unsubscribe {
  html: string
  text: string[]
  headers: Record<string, string>
}

// Rodapé: no serviço, ajuda (responder cai no atendimento), assinatura e quem é a empresa; no marketing, a assinatura do
// Kito, as redes e, por último e em letra pequena, o motivo do envio e a saída da lista.
function footer(unsubscribe?: Unsubscribe): string {
  const small = (html: string, mb = 8) => `<p style="margin:0 0 ${mb}px;font-family:${FONT};font-size:13px;line-height:1.6;color:${INK_SOFT};">${html}</p>`
  if (!unsubscribe) {
    return [
      small(`Dúvidas? É só responder este e-mail ou escrever para ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}.`),
      small(SERVICE_SIGNATURE),
      small(LEGAL, 0),
    ].join('\n      ')
  }
  const site = env.siteUrl()
  return [
    `<p style="margin:0 0 12px;font-family:${DISPLAY};font-size:15px;font-weight:700;color:${INK};">${KITO_SIGNATURE}</p>`,
    small(`${link('https://www.instagram.com/keytotwo/', 'Instagram')} &nbsp;·&nbsp; ${link('https://www.tiktok.com/@keytotwo', 'TikTok')} &nbsp;·&nbsp; ${link(site, 'keytotwo.com.br')}`, 14),
    small(LEGAL, 18),
    unsubscribe.html,
  ].join('\n      ')
}

function layout(o: { subject: string; preheader: string; marker: string; body: string[]; unsubscribe?: Unsubscribe }): string {
  const outer = o.unsubscribe ? SKY : '#ffffff'
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(o.subject)}</title>
<link href="${FONTS_CSS}" rel="stylesheet">
<style>
  :root { color-scheme: light only; supported-color-schemes: light; }
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  @media (max-width:620px) { .k-sheet { padding:28px 22px 24px !important; } .k-wrap { padding:12px 8px !important; } h1 { font-size:25px !important; } .k-kito { width:88px !important; height:88px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${outer};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${outer};">${escapeHtml(o.preheader)}${'&#8199;&#65279;&#847; '.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${outer};"><tr><td align="center" class="k-wrap" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
    <tr><td style="padding:0 6px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:${DISPLAY};font-size:22px;font-weight:800;letter-spacing:-0.6px;color:${INK};"><a href="${env.siteUrl()}" style="color:${INK};text-decoration:none;">KeyToTwo</a></td>
        <td align="right" style="font-family:${MONO};font-size:12px;letter-spacing:0.6px;color:${INK_SOFT};">${escapeHtml(o.marker)}</td>
      </tr></table>
    </td></tr>
    <tr><td class="k-sheet" style="background:#ffffff;border-top:2px dashed ${LINE};border-bottom:2px dashed ${LINE};padding:36px 32px 28px;">
      ${o.body.join('\n      ')}
      <div style="margin:26px 0;border-top:2px dashed ${LINE};line-height:0;font-size:0;">&nbsp;</div>
      ${footer(o.unsubscribe)}
    </td></tr>
  </table>
</td></tr></table>
</body>
</html>`
}

// Assinatura do texto puro, a mesma do rodapé em HTML (a do Kito só no marketing).
const textSignature = (marketing: boolean) => ['', '--', marketing ? KITO_SIGNATURE : SERVICE_SIGNATURE, `Dúvidas? É só responder este e-mail ou escrever para ${SUPPORT_EMAIL}.`]

// Motivo do envio e descadastro de todo e-mail de marketing (RFC 8058: POST em 1 clique pelo provedor; o link do rodapé
// abre a página de preferências, que confirma e chama o POST). No HTML, a última linha, em letra pequena.
async function unsubscribeParts(row: OutboxRow): Promise<Unsubscribe> {
  if (!row.user_id) throw new PermanentEmailError('marketing_sem_usuario')
  const token = encodeURIComponent(await signUnsubscribeToken(row.user_id))
  const page = `${env.siteUrl()}/email/preferencias?token=${token}`
  const account = `${env.siteUrl()}/conta`
  const small = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="font-family:${FONT};color:${INK_SOFT};text-decoration:underline;">${label}</a>`
  const html = `<p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.5;color:${INK_SOFT};">Vocês recebem este e-mail porque aceitaram receber novidades da KeyToTwo. ${small(page, 'Sair da lista')} · ${small(account, 'Minha conta')}</p>`
  const text = ['', 'Vocês recebem este e-mail porque aceitaram receber novidades da KeyToTwo.', `Sair da lista (vale na hora): ${page}`, `Minha conta: ${account}`]
  const headers = {
    'List-Unsubscribe': `<${env.apiPublicUrl()}/email/unsubscribe?token=${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  return { html, text, headers }
}

// Entrega e presente (transacionais, sem imagem, voz neutra): uma linha por jogo com o link /d/{token} e o botão Meus
// jogos. O presente (2026-10-23, pedido de cortesia do admin) não fala em valor nem em pedido: não houve compra.
async function downloadsEmail(row: OutboxRow, copy: { subject: (names: string[]) => string; preheader: string; marker: string; missing: string; heading: (names: string[]) => [string, string, string]; intro: (names: string[]) => string }): Promise<Message> {
  const games = (row.payload.games ?? []).filter((g) => g.entitlement_id && Number.isSafeInteger(g.game_id))
  if (!games.length) throw new PermanentEmailError(copy.missing)
  const api = env.apiPublicUrl()
  const links = await Promise.all(games.map(async (game) => ({
    name: displayName(game),
    url: `${api}/d/${await signDeliveryToken(game.entitlement_id!, game.game_id!)}`,
  })))
  const site = env.siteUrl()
  const library = `${site}/meus-jogos`
  const printing = `${site}/ajuda#impressao`
  const names = links.map((l) => l.name)
  const subject = copy.subject(names)
  const intro = copy.intro(names)
  const validity = `Os botões deste e-mail valem por ${LINK_DAYS} dias. Em Meus jogos, os arquivos ficam sem prazo: é só entrar com este e-mail.`
  const print = 'Na hora de imprimir: A4 comum, tamanho real (100%) e uma face por folha.'
  const html = layout({
    subject, preheader: copy.preheader, marker: copy.marker,
    body: [
      title(...copy.heading(names)),
      paragraph(escapeHtml(intro)),
      gameRows(links.map((l) => ({ name: l.name, note: 'PDF para imprimir em A4', href: l.url }))),
      button(library, 'Abrir Meus jogos'),
      paragraph(validity, true),
      paragraph(`${print} O resto está no ${link(printing, 'guia de impressão')}.`, true, true),
    ],
  })
  const text = [
    'KeyToTwo', '', copy.heading(names).join(''), '',
    intro, '',
    ...links.map((l) => `Baixar ${l.name}: ${l.url}`), '',
    validity,
    `Meus jogos: ${library}`, '',
    `${print} Guia de impressão: ${printing}`,
    ...textSignature(false),
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind }
}

function delivery(row: OutboxRow): Promise<Message> {
  const ref = row.payload.order_ref ?? ''
  return downloadsEmail(row, {
    subject: () => (ref ? `Seus jogos chegaram (pedido ${ref})` : 'Seus jogos chegaram'),
    preheader: 'Os PDFs estão prontos para baixar e imprimir em A4.',
    marker: ref ? `PEDIDO ${ref}` : 'PEDIDO',
    missing: 'entrega_sem_jogos',
    heading: () => ['Pagamento confirmado. Os jogos já são ', 'de vocês', '.'],
    intro: () => `Recebemos o pagamento${ref ? ` do pedido ${ref}` : ''}. Cada jogo tem o seu botão de baixar logo abaixo.`,
  })
}

function gift(row: OutboxRow): Promise<Message> {
  return downloadsEmail(row, {
    subject: (names) => (names.length === 1 ? `${names[0]} foi liberado em Meus jogos` : 'Jogos de presente em Meus jogos'),
    preheader: 'É presente da KeyToTwo, sem nada a pagar.',
    marker: 'PRESENTE',
    missing: 'presente_sem_jogos',
    heading: (names) => [names.length === 1 ? 'Tem um jogo ' : 'Tem jogos ', 'de presente', ' em Meus jogos.'],
    intro: (names) => `A KeyToTwo deu ${listNames(names)} para vocês. É presente, sem nada a pagar: é só baixar, imprimir e jogar.`,
  })
}

// Lembrete de sacola (marketing, 1º toque): o que ficou na sacola, as dúvidas mais comuns e o botão de volta. Sem preço
// nem cupom (o cupom fica para o 2º toque, só para quem nunca comprou).
async function cartReminder(row: OutboxRow): Promise<Message> {
  const items = row.payload.items ?? []
  if (!items.length) throw new PermanentEmailError('lembrete_sem_itens')
  const cart = `${env.siteUrl()}/carrinho`
  const unsubscribe = await unsubscribeParts(row)
  const names = items.map(displayName)
  const subject = names.length === 1 ? `${names[0]} ficou na sacola` : 'Esqueceram algo na sacola'
  const waiting = `${items.length > 1 ? 'Estes jogos continuam' : 'Este jogo continua'} lá, esperando a próxima vez que alguém perguntar "o que a gente faz hoje?":`
  const doubts = 'Não precisa de impressora em casa: uma gráfica ou papelaria imprime o PDF em A4 comum. O pagamento é por Pix ou cartão, e os jogos aparecem em Meus jogos assim que ele é confirmado.'
  const help = 'Ficou alguma dúvida antes de pagar? É só responder este e-mail. Se já resolveram por outro caminho, podem ignorar.'
  const html = layout({
    subject, preheader: 'Pix ou cartão, e os PDFs ficam em Meus jogos sem prazo.', marker: 'SACOLA', unsubscribe,
    body: [
      kitoTitle(title('A sacola ficou ', 'esperando', '.'), 'na-caixa', 'Kito dentro de uma caixa de papelão'),
      paragraph(escapeHtml(waiting)),
      gameRows(names.map((name) => ({ name }))),
      paragraph(doubts),
      button(cart, 'Voltar à sacola'),
      paragraph(help, true, true),
    ],
  })
  const text = [
    'KeyToTwo', '', 'A sacola ficou esperando.', '',
    waiting, ...names.map((name) => `- ${name}`), '',
    doubts, '',
    `Voltar à sacola: ${cart}`, '',
    help,
    ...textSignature(true),
    ...unsubscribe.text,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers: unsubscribe.headers }
}

// Sacola, 2º toque (marketing, 2026-10-31): 24 h depois do 1º lembrete, só para quem nunca comprou (o banco confere), com
// o cupom da primeira compra. O cupom PRIMEIRA10 é o da loja (admin › Descontos): 10%, só na primeira compra.
export const FIRST_PURCHASE_COUPON = 'PRIMEIRA10'
async function cartReminderSecond(row: OutboxRow): Promise<Message> {
  const items = row.payload.items ?? []
  if (!items.length) throw new PermanentEmailError('lembrete_sem_itens')
  const cart = `${env.siteUrl()}/carrinho`
  const unsubscribe = await unsubscribeParts(row)
  const names = items.map(displayName)
  const subject = '10% na primeira compra de vocês'
  const intro = `${items.length > 1 ? 'Os jogos ainda estão' : 'O jogo ainda está'} na sacola. Como esta seria a primeira compra de vocês na KeyToTwo, o cupom abaixo tira 10%.`
  const note = 'Digitem o cupom no pagamento. Vale na primeira compra, para qualquer jogo da loja.'
  const help = 'Dúvida sobre impressão ou pagamento? É só responder este e-mail.'
  const html = layout({
    subject, preheader: `O cupom ${FIRST_PURCHASE_COUPON} vale para qualquer jogo da loja.`, marker: 'SACOLA · PRIMEIRA COMPRA', unsubscribe,
    body: [
      kitoTitle(title('Para a primeira compra, ', '10% a menos', '.'), 'biscoito', 'Kito comendo um biscoito'),
      paragraph(escapeHtml(intro)),
      coupon(FIRST_PURCHASE_COUPON, note),
      gameRows(names.map((name) => ({ name }))),
      button(cart, 'Usar o cupom na sacola'),
      paragraph(help, true, true),
    ],
  })
  const text = [
    'KeyToTwo', '', 'Para a primeira compra, 10% a menos.', '',
    intro, '',
    `Cupom: ${FIRST_PURCHASE_COUPON}`, note, '',
    ...names.map((name) => `- ${name}`), '',
    `Usar o cupom na sacola: ${cart}`, '',
    help,
    ...textSignature(true),
    ...unsubscribe.text,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers: unsubscribe.headers }
}

// Pós-compra (marketing, D+3): os lembretes de impressão e o convite para contar como foi, respondendo o e-mail.
async function postPurchase(row: OutboxRow): Promise<Message> {
  const games = row.payload.games ?? []
  if (!games.length) throw new PermanentEmailError('pos_compra_sem_jogos')
  const library = `${env.siteUrl()}/meus-jogos`
  const printing = `${env.siteUrl()}/ajuda#impressao`
  const unsubscribe = await unsubscribeParts(row)
  const subject = 'Já rolou a primeira partida?'
  const names = listNames(games.map(displayName))
  const many = games.length > 1
  const intro = `Faz alguns dias que ${names} ${many ? 'chegaram' : 'chegou'}. Se ainda ${many ? 'estão' : 'está'} na pasta de downloads, três lembretes do`
  const reminders: [string, string][] = [
    ['Papel A4 comum.', 'Não precisa de papel especial.'],
    ['Tamanho real (100%).', 'Nada de "Ajustar à página", para as peças saírem do tamanho certo.'],
    ['Uma face por folha.', 'Assim nada aparece no verso das cartas.'],
  ]
  const ask = 'Já jogaram? Respondam este e-mail e contem como foi: o que fez rir, onde travou, o que vocês mudariam. Quem lê é a equipe, e as respostas ajudam a fazer os próximos jogos.'
  const permission = 'Se um dia quisermos mostrar no site o que vocês escreveram, a gente pede antes.'
  const html = layout({
    subject, preheader: 'Se já jogaram, contem como foi. Se não, três lembretes para imprimir.', marker: row.payload.order_ref ? `PEDIDO ${row.payload.order_ref}` : 'PÓS-COMPRA', unsubscribe,
    body: [
      kitoTitle(title('Já rolou a ', 'primeira', ' partida?'), 'tabuleiro', 'Kito ao lado de uma mesinha com um jogo de tabuleiro'),
      paragraph(`${escapeHtml(intro)} ${link(printing, 'guia de impressão')}:`),
      tips(reminders),
      button(library, 'Abrir Meus jogos'),
      paragraph(ask, false, true),
      ps(permission),
    ],
  })
  const text = [
    'KeyToTwo', '', subject, '',
    `${intro} guia de impressão (${printing}):`,
    ...reminders.map(([lead, rest], i) => `${i + 1}. ${lead} ${rest}`), '',
    `Meus jogos: ${library}`, '',
    ask, '',
    `P.S. ${permission}`,
    ...textSignature(true),
    ...unsubscribe.text,
  ].join('\n')
  return { to: row.to_email, subject, html, text, tag: row.kind, headers: unsubscribe.headers }
}

// Reembolso (transacional, 2026-10-24, Fase 3): o pedido inteiro devolvido, pelo admin ou direto na Stripe. Diz o valor,
// que volta pelo mesmo meio de pagamento, e que os jogos saíram de Meus jogos. O prazo é do banco ou do cartão.
async function refund(row: OutboxRow): Promise<Message> {
  const { order_ref: ref, amount_total: amount, currency } = row.payload
  if (!ref || !Number.isSafeInteger(amount) || !currency) throw new PermanentEmailError('reembolso_sem_valor')
  const value = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(amount! / 100)
  const names = listNames((row.payload.items ?? []).map(displayName))
  const subject = `Reembolso do pedido ${ref}`
  const intro = `Fizemos o reembolso do pedido ${ref}${names ? ` (${names})` : ''}. O valor de ${value} volta pelo mesmo meio de pagamento.`
  const timing = 'O prazo para aparecer no extrato ou na fatura depende do banco ou do cartão.'
  const access = 'Os jogos deste pedido saíram de Meus jogos, e os links de baixar não funcionam mais.'
  const html = layout({
    subject, preheader: `O valor de ${value} volta pelo mesmo meio de pagamento.`, marker: `PEDIDO ${ref}`,
    body: [title('Reembolso ', 'feito', '.'), paragraph(escapeHtml(intro)), paragraph(timing, true), paragraph(access, false, true)],
  })
  const text = ['KeyToTwo', '', 'Reembolso feito.', '', intro, '', timing, '', access, ...textSignature(false)].join('\n')
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
    case 'plunk_backup_late':
      return { text: 'A cópia de segurança do Plunk (os contatos e o histórico dos e-mails) não roda há mais de 26 horas. Confira o backup.log na VPS.', links }
    case 'marketing_sync_stuck': {
      const count = typeof d.count === 'number' ? d.count : 1
      const who = count === 1 ? '1 pessoa que aceitou os e-mails não chegou' : `${count} pessoas que aceitaram os e-mails não chegaram`
      const problem = typeof d.error === 'string' && d.error ? ` (${d.error})` : ''
      return { text: `${who} ao Plunk há mais de 1 hora${problem}: ${count === 1 ? 'ela fica' : 'elas ficam'} sem as boas-vindas. Confira se o Plunk está no ar.`, links: [PLUNK] }
    }
    case 'terms_missing':
      return { text: `O pedido ${ref} foi pago sem o "Li e aceito" gravado: alguém destravou o formulário à mão. Guarde isto para um pedido de reembolso ou uma contestação.`, links }
    case 'site_down':
      return siteDownCopy(alert, false)
    default:
      throw new PermanentEmailError('alerta_desconhecido')
  }
}

// Fora do ar (2026-10-26): o que parou, desde quando e onde conferir; no e-mail de volta (back), quando voltou e mais ou
// menos quanto durou (a checagem roda a cada 5 minutos).
const STATUS_SUPABASE = { href: 'https://status.supabase.com', label: 'Status da Supabase' }
const STATUS_STRIPE = { href: 'https://status.stripe.com', label: 'Status da Stripe' }
const HOSTINGER = { href: 'https://hpanel.hostinger.com', label: 'Abrir a Hostinger' }
const PLUNK = { href: 'https://email.keytotwo.com.br', label: 'Abrir o Plunk' }
const moment = (value: unknown) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(String(value)))

function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  if (minutes < 60) return unit(minutes, 'minuto', 'minutos')
  const rest = minutes % 60
  return `${unit(Math.floor(minutes / 60), 'hora', 'horas')}${rest ? ` e ${unit(rest, 'minuto', 'minutos')}` : ''}`
}

function siteDownCopy(alert: Alert, back: boolean): { text: string; links: { href: string; label: string }[] } {
  const d = alert.details
  const since = moment(d.since)
  const problem = typeof d.error === 'string' && d.error ? ` (${d.error})` : ''
  const at = back ? moment(alert.resolved_at) : ''
  const lasted = back ? `, depois de cerca de ${duration(Date.parse(String(alert.resolved_at)) - Date.parse(String(d.since)))}` : ''
  switch (alert.kind === 'site_down' ? d.target : null) {
    case 'site':
      return back
        ? { text: `O site voltou a abrir em ${at}${lasted} fora do ar.`, links: [] }
        : { text: `O site não abre desde ${since}${problem}: ninguém consegue ver a loja. Confira a VPS no painel da Hostinger.`, links: [HOSTINGER] }
    case 'plunk':
      return back
        ? { text: `O Plunk voltou a responder em ${at}${lasted} fora do ar.`, links: [] }
        : { text: `O Plunk não responde desde ${since}${problem}: os e-mails de acesso aos jogos e as novidades não saem. Confira a VPS no painel da Hostinger.`, links: [HOSTINGER, PLUNK] }
    case 'store':
      return back
        ? { text: `A loja voltou a mostrar os produtos com preço em ${at}${lasted}.`, links: [] }
        : { text: `A loja não mostra os produtos com preço desde ${since}${problem}: ninguém consegue comprar. Confira o status da Supabase e da Stripe.`, links: [STATUS_SUPABASE, STATUS_STRIPE] }
    case 'monitor':
      return back
        ? { text: `A checagem automática do site voltou em ${at}.`, links: [] }
        : { text: `A checagem automática do site parou de chegar depois de ${since}: a API da loja pode estar fora do ar. Confira o status da Supabase.`, links: [STATUS_SUPABASE] }
    default:
      throw new PermanentEmailError('alerta_desconhecido')
  }
}

async function adminAlert(row: OutboxRow): Promise<Message> {
  const back = row.payload.back === true
  const list = row.payload.alerts ?? []
  const alerts = list.map((alert) => (back ? siteDownCopy(alert, true) : alertCopy(alert)))
  if (!alerts.length) throw new PermanentEmailError('alerta_sem_itens')
  const page = `${env.adminUrl()}/atencao`
  const count = alerts.length
  const outages = back ? [] : list.filter((alert) => alert.kind === 'site_down')
  const down = outages.length > 0
  const what = outages.every((alert) => alert.details.target === 'plunk') ? 'o Plunk' : 'o site'
  const subject = back ? 'Admin KeyToTwo: voltou a funcionar' : down ? `Admin KeyToTwo: ${what} está fora do ar` : `Admin KeyToTwo: ${count} ${count > 1 ? 'alertas novos' : 'alerta novo'}`
  const heading = back ? 'Voltou a funcionar' : 'Precisa de atenção'
  const intro = back ? 'O que estava fora do ar voltou a funcionar.' : count > 1 ? `Apareceram ${count} alertas novos no admin da KeyToTwo.` : 'Apareceu um alerta novo no admin da KeyToTwo.'
  const why = `Você recebe este aviso porque é admin da KeyToTwo.${back ? '' : down ? ' Outro e-mail avisa quando voltar.' : ' Cada alerta avisa uma vez só.'}`
  const html = layout({
    subject, preheader: intro, marker: 'ADMIN',
    body: [
      `<h1 style="margin:0 0 18px;font-family:${DISPLAY};font-size:30px;line-height:1.18;font-weight:800;letter-spacing:-0.6px;color:${INK};">${escapeHtml(heading)}</h1>`,
      paragraph(escapeHtml(intro)),
      ...alerts.map((a) => paragraph(`${escapeHtml(a.text)}${a.links.map((l) => ` ${link(l.href, l.label)}`).join(' ·')}`)),
      button(page, 'Abrir Atenção no admin'),
      paragraph(why, true, true),
    ],
  })
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
  cart_reminder_2: cartReminderSecond,
  post_purchase: postPurchase,
}

export async function render(row: OutboxRow): Promise<Message> {
  if (!Object.hasOwn(templates, row.kind)) throw new PermanentEmailError('kind_desconhecido')
  return await templates[row.kind](row)
}
