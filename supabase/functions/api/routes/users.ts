import { deleteAuthUser, rpcRow, setAuthUserBan } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { runInBackground } from '../../_shared/background.ts'
import { dispatchEmails } from '../../_shared/email.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { livemode } from '../../_shared/stripe.ts'
import { DELETION_BLOCKED } from './account.ts'

// Usuários no admin (2026-10-23, Fase 4): buscar contas, ver a ficha de cada pessoa e agir. O banco confere o admin em
// cada chamada e guarda cada ação, com o motivo, em private.admin_events. Bloquear, excluir e retirar jogo não valem
// para a própria conta nem para a de outro admin (409 PROTECTED_ACCOUNT).

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SIZE = 50
const FILTERS = ['all', 'buyers', 'newsletter', 'blocked']

const notAdmin = () => new HttpError(403, 'NOT_ADMIN', 'Esta área é só para a equipe da KeyToTwo.')
const notFound = (message = 'Conta não encontrada. Ela pode ter sido excluída.') => new HttpError(404, 'NOT_FOUND', message)
const notConfirmed = () => new HttpError(409, 'TARGET_NOT_CONFIRMED', 'Esta conta nunca confirmou o e-mail: não tem compras nem dados de conta para isso.')

// O resultado de uma RPC de admin vira resposta: ok segue; os comuns a todas e os próprios de cada rota viram erro.
function settle(outcome: string, own: Record<string, () => HttpError> = {}): void {
  if (outcome === 'ok' || outcome === 'deleted') return
  if (Object.hasOwn(own, outcome)) throw own[outcome]()
  if (outcome === 'forbidden') throw notAdmin()
  if (outcome === 'not_found') throw notFound()
  if (outcome === 'protected') throw new HttpError(409, 'PROTECTED_ACCOUNT', 'Isso não vale para a sua própria conta nem para a de outro admin.')
  throw new Error(`admin de usuários: outcome inesperado (${outcome})`)
}

function param(params: Record<string, string>, key: string, missing?: string): string {
  if (!ID.test(params[key] ?? '')) throw notFound(missing)
  return params[key]
}

// Motivo de toda ação que muda algo: de 3 a 300 caracteres (o banco confere de novo).
function reasonOf(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3 || reason.length > 300) throw new HttpError(400, 'INVALID_REQUEST', 'Escreva o motivo, de 3 a 300 caracteres.')
  return reason
}

// GET /admin/users?q=&filter=all|buyers|newsletter|blocked&page=1: 50 contas por página, a mais nova primeiro.
export async function adminUsers(req: Request, url: URL): Promise<Response> {
  const user = await requireAdminSession(req)
  const query = (url.searchParams.get('q') ?? '').trim()
  const filter = url.searchParams.get('filter') ?? 'all'
  const page = Number(url.searchParams.get('page') ?? '1')
  if (query.length > 200 || !FILTERS.includes(filter) || !Number.isInteger(page) || page < 1 || page > 20_000) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Busca inválida.')
  }
  const result = await rpcRow<{ outcome: string; result: Record<string, unknown> | null }>('admin_list_users', {
    p_user_id: user.id, p_query: query || null, p_filter: filter, p_offset: (page - 1) * PAGE_SIZE,
  })
  settle(result.outcome)
  return json({ ...result.result, page })
}

// GET /admin/users/:id: a ficha (conta, novidades, jogos, pedidos, e-mails, histórico do admin e o que dá de presente).
export async function adminUser(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const result = await rpcRow<{ outcome: string; result: Record<string, unknown> | null }>('admin_get_user', { p_user_id: user.id, p_target: param(params, 'id') })
  settle(result.outcome)
  return json(result.result)
}

// POST /admin/users/:id/gifts { product_code, reason, notify }: pedido de cortesia de R$ 0 com o produto. Com notify, o
// e-mail do presente sai na hora (e, se falhar, pela fila).
export async function adminGiftProduct(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const body = await readJsonObject(req)
  const product = typeof body.product_code === 'string' ? body.product_code.trim() : ''
  if (!/^[A-Z][A-Z0-9-]{1,23}$/.test(product)) throw new HttpError(400, 'INVALID_REQUEST', 'Escolha o jogo do presente.')
  if (typeof body.notify !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'Diga se a pessoa recebe o e-mail do presente.')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string; order_id: string | null; outbox_id: string | null }>('admin_gift_product', {
    p_user_id: user.id, p_target: target, p_product_code: product, p_reason: reason, p_notify: body.notify, p_livemode: livemode(),
  })
  settle(result.outcome, {
    product_unavailable: () => new HttpError(409, 'PRODUCT_UNAVAILABLE', 'Este jogo não está à venda agora, então não dá para dar de presente.'),
    already_owned: () => new HttpError(409, 'ALREADY_OWNED', 'A pessoa já tem todos os jogos deste produto.'),
  })
  const outboxId = result.outbox_id
  if (outboxId) runInBackground('admin: e-mail do presente', () => dispatchEmails({ outboxId }))
  return json({ order_id: result.order_id, email_queued: Boolean(outboxId) }, 201)
}

// POST /admin/users/:id/entitlements/:entitlement/revoke { reason }: o jogo sai da biblioteca; o pedido não muda.
export async function adminRevokeEntitlement(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const entitlement = param(params, 'entitlement', 'Jogo não encontrado nesta conta.')
  const reason = reasonOf(await readJsonObject(req))
  const result = await rpcRow<{ outcome: string }>('admin_revoke_entitlement', {
    p_user_id: user.id, p_target: target, p_entitlement_id: entitlement, p_reason: reason,
  })
  settle(result.outcome, {
    not_found: () => notFound('Jogo não encontrado nesta conta.'),
    not_active: () => new HttpError(409, 'ALREADY_REVOKED', 'Este jogo já foi retirado.'),
  })
  return json({ revoked: true })
}

// POST /admin/users/:id/orders/:order/resend: o e-mail de acesso de novo (do presente, num pedido de cortesia), para o
// e-mail atual da conta.
export async function adminResendDelivery(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const order = param(params, 'order', 'Pedido não encontrado nesta conta.')
  const result = await rpcRow<{ outcome: string; outbox_id: string | null }>('admin_resend_delivery', { p_user_id: user.id, p_target: target, p_order_id: order })
  settle(result.outcome, {
    not_found: () => notFound('Pedido não encontrado nesta conta.'),
    not_deliverable: () => new HttpError(409, 'ORDER_NOT_DELIVERABLE', 'Este pedido não está pago ou tem jogo retirado: não há acesso para reenviar.'),
    already_queued: () => new HttpError(409, 'EMAIL_ALREADY_QUEUED', 'O e-mail de acesso deste pedido ainda está na fila de envio.'),
  })
  const outboxId = result.outbox_id
  if (outboxId) runInBackground('admin: reenvio do acesso', () => dispatchEmails({ outboxId }))
  return json({ queued: true }, 202)
}

// POST /admin/users/:id/newsletter/off { reason }: tira das novidades a pedido (origem support no histórico).
export async function adminNewsletterOff(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const reason = reasonOf(await readJsonObject(req))
  const result = await rpcRow<{ outcome: string }>('admin_newsletter_off', { p_user_id: user.id, p_target: target, p_reason: reason })
  settle(result.outcome, { not_subscribed: () => new HttpError(409, 'NOT_SUBSCRIBED', 'Esta conta não recebe as novidades.') })
  return json({ newsletter: false })
}

// Bloquear e desbloquear: o banco confere a conta, o Auth troca o bloqueio e só então o histórico registra.
async function setBlocked(req: Request, params: Record<string, string>, blocked: boolean): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const reason = reasonOf(await readJsonObject(req))
  const current = await rpcRow<{ outcome: string; blocked: boolean | null }>('admin_check_user_block', { p_user_id: user.id, p_target: target })
  settle(current.outcome)
  if (current.blocked === blocked) {
    throw blocked
      ? new HttpError(409, 'ALREADY_BLOCKED', 'Esta conta já está bloqueada.')
      : new HttpError(409, 'NOT_BLOCKED', 'Esta conta não está bloqueada.')
  }
  await setAuthUserBan(target, blocked)
  settle((await rpcRow<{ outcome: string }>('admin_log_user_block', { p_user_id: user.id, p_target: target, p_blocked: blocked, p_reason: reason })).outcome)
  return json({ blocked })
}

// POST /admin/users/:id/block { reason } e POST /admin/users/:id/unblock { reason }.
export const adminBlockUser = (req: Request, _url: URL, params: Record<string, string>) => setBlocked(req, params, true)
export const adminUnblockUser = (req: Request, _url: URL, params: Record<string, string>) => setBlocked(req, params, false)

// GET /admin/users/:id/export: a mesma cópia dos dados que a pessoa baixa em Minha conta (LGPD), para baixar.
export async function adminExportUser(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const result = await rpcRow<{ outcome: string; data: Record<string, unknown> | null }>('admin_export_user', { p_user_id: user.id, p_target: target })
  settle(result.outcome, { not_confirmed: notConfirmed })
  return json(result.data, 200, { 'Content-Disposition': `attachment; filename="keytotwo-dados-${target.slice(0, 8)}.json"` })
}

// POST /admin/users/:id/delete { reason, confirm_email }: a exclusão a pedido (LGPD), a mesma da própria pessoa: o banco
// anonimiza os pedidos e apaga o resto, e o Auth apaga a conta.
export async function adminDeleteUser(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const body = await readJsonObject(req)
  const reason = reasonOf(body)
  if (typeof body.confirm_email !== 'string' || !body.confirm_email.trim()) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Digite o e-mail da conta para confirmar a exclusão.')
  }
  const result = await rpcRow<{ outcome: string; reason: string | null; orders_anonymized: number | null }>('admin_delete_user', {
    p_user_id: user.id, p_target: target, p_reason: reason, p_confirm_email: body.confirm_email,
  })
  const blockedReason = result.reason ?? 'payment_pending'
  settle(result.outcome, {
    confirmation_mismatch: () => new HttpError(400, 'INVALID_REQUEST', 'O e-mail digitado não é o desta conta.'),
    not_confirmed: notConfirmed,
    blocked: () => new HttpError(409, 'ACCOUNT_DELETION_BLOCKED', DELETION_BLOCKED[blockedReason] ?? DELETION_BLOCKED.payment_pending, { details: { reason: blockedReason } }),
  })
  await deleteAuthUser(target)
  return json({ deleted: true, orders_anonymized: result.orders_anonymized ?? 0 })
}
