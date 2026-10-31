import { rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { HttpError, json } from '../../_shared/http.ts'
import { livemode } from '../../_shared/stripe.ts'
import { settle } from './outcome.ts'

// Períodos do painel: os últimos 7 ou 30 dias do calendário de Brasília, contando hoje.
const PERIODS = [7, 30]

// GET /admin/metrics?days=7|30 (sessão de admin com segundo fator): as métricas do painel no modo da chave da Stripe,
// com os cupons, parceiros e campanhas do período em `marketing` (2026-10-24) e o uso da infraestrutura em `usage`
// (2026-10-25: as chamadas do mês e dos dias, o banco e as contas que entraram). Desde 2026-10-31 (revisão de UX do
// admin), também os mais vendidos do período em `top_products` e, em `previous`, os pedidos, a receita e as contas novas
// dos mesmos dias logo antes do período (da série diária do dobro do período). Sem o segundo fator, 403 MFA_REQUIRED
// antes do banco; o banco confere o admin (app_metadata.admin) e nega com 403.
type Day = { orders?: number; revenue?: number; accounts?: number }

export async function adminMetrics(req: Request, url: URL): Promise<Response> {
  const user = await requireAdminSession(req)
  const days = Number(url.searchParams.get('days') ?? '7')
  if (!PERIODS.includes(days)) throw new HttpError(400, 'INVALID_REQUEST', 'Período inválido: use 7 ou 30 dias.')
  const args = { p_user_id: user.id, p_days: days, p_livemode: livemode() }
  const [result, marketing, usage, products, doubled] = await Promise.all([
    rpcRow<{ outcome: string; metrics: Record<string, unknown> }>('get_admin_metrics', args),
    rpcRow<{ outcome: string; result: unknown }>('admin_marketing_metrics', args),
    rpcRow<{ outcome: string; result: unknown }>('admin_usage_metrics', { p_user_id: user.id, p_days: days }),
    rpcRow<{ outcome: string; result: unknown }>('admin_product_sales', args),
    rpcRow<{ outcome: string; metrics: Record<string, unknown> }>('get_admin_metrics', { ...args, p_days: days * 2 }),
  ])
  settle(result.outcome)
  settle(marketing.outcome)
  settle(usage.outcome)
  settle(products.outcome)
  settle(doubled.outcome)
  const series = Array.isArray(doubled.metrics?.daily) ? doubled.metrics.daily as Day[] : []
  const before = series.slice(0, Math.max(0, series.length - days))
  const sum = (key: keyof Day) => before.reduce((total, day) => total + (Number(day[key]) || 0), 0)
  const previous = { orders: sum('orders'), revenue: sum('revenue'), accounts: sum('accounts') }
  return json({ ...result.metrics, marketing: marketing.result, usage: usage.result, top_products: products.result, previous })
}
