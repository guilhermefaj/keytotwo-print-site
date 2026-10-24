// Cupons e parceiros no admin (2026-10-24): o formato de GET /admin/discounts, /admin/partners e /admin/partners/:id e
// os nomes que a tela mostra.
export interface DiscountStats { orders: number; revenue: number; discount: number }
export interface Discount {
  id: string
  code: string
  percent_off: number
  product_codes: string[] | null
  starts_at: string | null
  ends_at: string | null
  max_redemptions: number | null
  first_time_only: boolean
  minimum_amount: number | null
  campaign: string | null
  banner: string | null
  partner: { id: string; slug: string; name: string } | null
  state: 'scheduled' | 'active' | 'paused' | 'ended'
  effective_state: 'scheduled' | 'starting' | 'active' | 'paused' | 'ended' | 'expired'
  created_at: string
  stats: DiscountStats
}
export interface DiscountList {
  discounts: Discount[]
  partners: { id: string; slug: string; name: string; status: 'active' | 'paused' }[]
  products: { code: string; name: string | null; stripe_product: string | null }[]
}

export interface PartnerFields { slug: string; name: string; handle: string | null; contact: string | null; commission_percent: number; status: 'active' | 'paused'; notes: string | null }
export interface PartnerRow extends PartnerFields { id: string; created_at: string; visits_30d: number; orders: number; revenue: number; codes: string[] }
export interface PartnerMonth { month: string; orders: number; revenue: number; commission: number; closed: boolean; payout: { amount: number; orders: number; paid_at: string; note: string | null } | null }
export interface PartnerDetail {
  partner: PartnerFields & { id: string; created_at: string }
  months: PartnerMonth[]
  visits: { last_30_days: number; total: number }
  discounts: Discount[]
  orders: { id: string; ref: string; paid_at: string; amount_total: number; promotion_code: string | null; source: 'code' | 'link' }[]
}

const STATES: Record<Discount['effective_state'], { label: string; tone: 'published' | '' }> = {
  scheduled: { label: 'Agendado', tone: '' }, starting: { label: 'Começando', tone: '' }, active: { label: 'Valendo', tone: 'published' },
  paused: { label: 'Pausado', tone: '' }, ended: { label: 'Encerrado', tone: '' }, expired: { label: 'Prazo terminou', tone: '' },
}
export const discountState = (discount: Discount) => STATES[discount.effective_state]

export const percent = (value: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value))}%`
export const commissionLabel = (value: number) => Number(value) > 0 ? `${percent(value)} de comissão` : 'sem comissão'

// O dia de Brasília (sem horário de verão desde 2019): começa à 0h e termina às 23h59 do dia escolhido.
export const startOfDay = (date: string) => `${date}T00:00:00-03:00`
export const endOfDay = (date: string) => `${date}T23:59:59-03:00`
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' })
export function discountWindow(discount: Pick<Discount, 'starts_at' | 'ends_at'>) {
  const from = discount.starts_at ? dayFormat.format(new Date(discount.starts_at)) : null
  const to = discount.ends_at ? dayFormat.format(new Date(discount.ends_at)) : null
  if (from && to) return `de ${from} a ${to}`
  if (from) return `a partir de ${from}`
  return to ? `até ${to}` : 'sem prazo'
}

// O mês de Brasília (AAAA-MM-01) por extenso: "outubro de 2026".
export const monthLabel = (month: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month.slice(0, 10)}T12:00:00Z`))

export const partnerLink = (siteUrl: string, slug: string) => `${siteUrl.replace(/\/+$/, '')}/?p=${slug}`
