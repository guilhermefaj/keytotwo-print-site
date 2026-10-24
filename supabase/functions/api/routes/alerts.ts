import { rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { reasonOf, settle } from './outcome.ts'

// Alertas do admin (2026-10-24): o que precisa de atenção (contestação, entrega que não saiu, pedido parado, aviso da
// Stripe sem pedido, fila de e-mail parada, backup atrasado). A varredura do banco abre e fecha; aqui só se lê e se
// resolve à mão, com motivo, o que não fecha sozinho.

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Alerta não encontrado.')

// GET /admin/alerts: { open, resolved } (resolvidos nos últimos 30 dias).
export async function adminAlerts(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const result = await rpcRow<{ outcome: string; alerts: Record<string, unknown> | null }>('admin_list_alerts', { p_user_id: user.id })
  settle(result.outcome)
  return json(result.alerts)
}

// POST /admin/alerts/:id/resolve { reason }: fila parada e backup atrasado não se resolvem à mão (409).
export async function adminResolveAlert(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  if (!/^[1-9][0-9]{0,14}$/.test(params.id)) throw notFound()
  const reason = reasonOf(await readJsonObject(req))
  const result = await rpcRow<{ outcome: string }>('admin_resolve_alert', { p_user_id: user.id, p_alert_id: Number(params.id), p_reason: reason })
  settle(result.outcome, {
    not_found: notFound,
    not_resolvable: () => new HttpError(409, 'ALERT_NOT_RESOLVABLE', 'Este alerta já foi resolvido ou fecha sozinho quando o problema passa.'),
  })
  return json({ resolved: true })
}
