import { rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { HttpError, json } from '../../_shared/http.ts'
import { livemode } from '../../_shared/stripe.ts'
import { settle } from './outcome.ts'

// Períodos do painel: os últimos 7 ou 30 dias do calendário de Brasília, contando hoje.
const PERIODS = [7, 30]

// GET /admin/metrics?days=7|30 (sessão de admin com segundo fator): as métricas do painel no modo da chave da Stripe,
// com os cupons, parceiros e campanhas do período em `marketing` (2026-10-24). Sem o segundo fator, 403 MFA_REQUIRED
// antes do banco; o banco confere o admin (app_metadata.admin) e nega com 403.
export async function adminMetrics(req: Request, url: URL): Promise<Response> {
  const user = await requireAdminSession(req)
  const days = Number(url.searchParams.get('days') ?? '7')
  if (!PERIODS.includes(days)) throw new HttpError(400, 'INVALID_REQUEST', 'Período inválido: use 7 ou 30 dias.')
  const args = { p_user_id: user.id, p_days: days, p_livemode: livemode() }
  const [result, marketing] = await Promise.all([
    rpcRow<{ outcome: string; metrics: Record<string, unknown> }>('get_admin_metrics', args),
    rpcRow<{ outcome: string; result: unknown }>('admin_marketing_metrics', args),
  ])
  settle(result.outcome)
  settle(marketing.outcome)
  return json({ ...result.metrics, marketing: marketing.result })
}
