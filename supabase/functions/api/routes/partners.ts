import { rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { HttpError, isUuid, json, readJsonObject } from '../../_shared/http.ts'
import { livemode } from '../../_shared/stripe.ts'
import { signReferralToken } from '../../_shared/tokens.ts'
import { reasonOf, settle } from './outcome.ts'

// Parceiros e indicações (2026-10-24, decisões do responsável): o cadastro (o apelido do link não muda depois), os
// números por mês, a comissão (0%: amigo ou pago por fora; as vendas contam, a comissão não), o repasse de um mês
// fechado e a planilha do mês sem dado de cliente. A visita pelo link (pública) conta e devolve o código do parceiro.

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Parceiro não encontrado.')
const invalid = (message: string) => new HttpError(400, 'INVALID_REQUEST', message)

const textField = (value: unknown, min: number, max: number, label: string, required = false): string | null => {
  if (!required && (value === null || value === undefined || value === '')) return null
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < min || text.length > max) throw invalid(`${label}: de ${min} a ${max} caracteres.`)
  return text
}

function partnerBody(body: Record<string, unknown>, creating: boolean) {
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (creating && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw invalid('O apelido do link tem letras minúsculas, números e hífens, como ana-souza.')
  if (creating && (slug.length < 2 || slug.length > 30)) throw invalid('O apelido do link tem de 2 a 30 caracteres.')
  const commission = body.commission_percent ?? 0
  if (typeof commission !== 'number' || commission < 0 || commission > 100 || Math.round(commission * 100) !== commission * 100) {
    throw invalid('A comissão é um percentual de 0 a 100 (0: amigo ou pago por fora).')
  }
  const status = body.status ?? 'active'
  if (status !== 'active' && status !== 'paused') throw invalid('A situação é active ou paused.')
  return {
    slug, name: textField(body.name, 2, 80, 'Nome', true), handle: textField(body.handle, 2, 80, 'Rede'),
    contact: textField(body.contact, 3, 120, 'Contato'), commission_percent: commission, status, notes: textField(body.notes, 1, 500, 'Observações'),
  }
}

// GET /admin/partners: os parceiros com visitas (30 dias), vendas, receita e os códigos.
export async function adminPartners(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const result = await rpcRow<{ outcome: string; result: unknown[] | null }>('admin_list_partners', { p_user_id: user.id, p_livemode: livemode() })
  settle(result.outcome)
  return json({ partners: result.result })
}

// GET /admin/partners/:id: a ficha (os meses com a comissão e o repasse, os cupons, as últimas vendas).
export async function adminPartner(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  if (!isUuid(params.id)) throw notFound()
  const result = await rpcRow<{ outcome: string; result: unknown }>('admin_get_partner', { p_user_id: user.id, p_id: params.id, p_livemode: livemode() })
  settle(result.outcome, { not_found: notFound })
  return json(result.result)
}

// POST /admin/partners e POST /admin/partners/:id { slug, name, handle, contact, commission_percent, status, notes, reason }.
export async function adminSavePartner(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const id = params.id ?? null
  if (id !== null && !isUuid(id)) throw notFound()
  const body = await readJsonObject(req)
  const partner = partnerBody(body, id === null)
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string; id: string | null }>('admin_save_partner', { p_user_id: user.id, p_id: id, p_partner: partner, p_reason: reason })
  settle(result.outcome, { not_found: notFound, slug_taken: () => new HttpError(409, 'CATALOG_CONFLICT', 'Esse apelido de link já é de outro parceiro.') })
  return json({ id: result.id }, id === null ? 201 : 200)
}

const monthOf = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw invalid('O mês é AAAA-MM.')
  return `${value}-01`
}

// POST /admin/partners/:id/payouts { month: AAAA-MM, note, reason }: a comissão de um mês fechado foi paga.
export async function adminPartnerPayout(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  if (!isUuid(params.id)) throw notFound()
  const body = await readJsonObject(req)
  const month = monthOf(body.month)
  const note = textField(body.note, 1, 300, 'Observação')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string; amount: number | null }>('admin_mark_partner_paid', {
    p_user_id: user.id, p_id: params.id, p_month: month, p_note: note, p_reason: reason, p_livemode: livemode(),
  })
  const done = (message: string) => () => new HttpError(409, 'CATALOG_CONFLICT', message)
  settle(result.outcome, {
    not_found: notFound, not_closed: done('O mês ainda não fechou.'), already_paid: done('Este mês já está pago.'),
    nothing_due: done('Não há comissão a pagar neste mês.'),
  })
  return json({ amount: result.amount })
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const reais = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

// GET /admin/partners/:id/export?month=AAAA-MM: as vendas do mês em CSV (ponto e vírgula, para o Excel em português),
// sem e-mail nem nome de cliente.
export async function adminPartnerExport(req: Request, url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  if (!isUuid(params.id)) throw notFound()
  const month = monthOf(url.searchParams.get('month'))
  const result = await rpcRow<{ outcome: string; result: { partner: { slug: string; name: string; commission_percent: number } | null; orders: { ref: string; paid_at: string; amount_total: number; amount_discount: number; promotion_code: string | null }[] } | null }>(
    'admin_partner_orders', { p_user_id: user.id, p_id: params.id, p_month: month, p_livemode: livemode() })
  settle(result.outcome)
  const data = result.result!
  if (!data.partner) throw notFound()
  const percent = Number(data.partner.commission_percent)
  const lines = [['Pedido', 'Pago em', 'Total cobrado (R$)', 'Desconto (R$)', 'Cupom', `Comissão ${String(percent).replace('.', ',')}% (R$)`].join(';')]
  let total = 0
  for (const order of data.orders) {
    total += order.amount_total
    lines.push([order.ref, order.paid_at, reais(order.amount_total), reais(order.amount_discount), order.promotion_code ?? '', reais(Math.round(order.amount_total * percent / 100))].map(csvCell).join(';'))
  }
  lines.push(['Total', '', reais(total), '', '', reais(Math.round(total * percent / 100))].join(';'))
  return new Response(`\ufeff${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="parceiro-${data.partner.slug}-${month.slice(0, 7)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

// POST /referral/visit { partner } (pública): quem abriu o link do parceiro. Conta a visita do dia e devolve o nome e o
// código ativo dele, para a faixa e o pagamento, e o comprovante assinado da visita (token), que o checkout exige para
// atribuir a venda ao parceiro (2026-10-25). Parceiro pausado ou que não existe: 404.
export async function referralVisit(req: Request): Promise<Response> {
  const body = await readJsonObject(req)
  const slug = typeof body.partner === 'string' ? body.partner.trim().toLowerCase() : ''
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 30) throw notFound()
  const result = await rpcRow<{ outcome: string; slug: string; name: string; code: string | null; percent_off: number | null }>('record_partner_visit', { p_slug: slug })
  if (result.outcome !== 'ok') throw notFound()
  return json({
    partner: result.slug, name: result.name, code: result.code, percent_off: result.percent_off === null ? null : Number(result.percent_off),
    token: await signReferralToken(result.slug),
  })
}
