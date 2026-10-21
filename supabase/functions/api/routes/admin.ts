import { rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { HttpError, json } from '../../_shared/http.ts'
import { livemode } from '../../_shared/stripe.ts'

// Períodos do painel: os últimos 7 ou 30 dias do calendário de Brasília, contando hoje.
const PERIODS = [7, 30]

// GET /admin/metrics?days=7|30 (sessão de admin): as métricas do painel no modo da chave da Stripe.
// O banco confere o admin a cada chamada (app_metadata.admin); quem não é admin recebe 403.
export async function adminMetrics(req: Request, url: URL): Promise<Response> {
  const user = await requireSessionUser(req)
  const days = Number(url.searchParams.get('days') ?? '7')
  if (!PERIODS.includes(days)) throw new HttpError(400, 'INVALID_REQUEST', 'Período inválido: use 7 ou 30 dias.')
  const result = await rpcRow<{ outcome: string; metrics: unknown }>('get_admin_metrics', {
    p_user_id: user.id,
    p_days: days,
    p_livemode: livemode(),
  })
  if (result.outcome !== 'ok') throw new HttpError(403, 'NOT_ADMIN', 'Esta área é só para a equipe da KeyToTwo.')
  return json(result.metrics)
}
