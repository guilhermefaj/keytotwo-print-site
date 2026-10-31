import { deleteAuthUser, rpcRow, setAuthUserBan } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { dispatchSoon, forgetEmailContact } from '../../_shared/email.ts'
import { HttpError, isUuid, json, readJsonObject } from '../../_shared/http.ts'
import { livemode } from '../../_shared/stripe.ts'
import { deletionBlocked } from './account.ts'
import { PRODUCT_CODE } from './cart.ts'
import { reasonOf, settle } from './outcome.ts'

// Usuários no admin (2026-10-23, Fase 4): buscar contas, ver a ficha de cada pessoa e agir. O banco confere o admin em
// cada chamada e guarda cada ação, com o motivo, em private.admin_events. Bloquear, excluir e retirar jogo não valem
// para a própria conta nem para a de outro admin (409 PROTECTED_ACCOUNT).

const PAGE_SIZE = 50
const FILTERS = ['all', 'buyers', 'newsletter', 'blocked', 'admins']

const notFound = (message = 'Conta não encontrada. Ela pode ter sido excluída.') => new HttpError(404, 'NOT_FOUND', message)
const notConfirmed = () => new HttpError(409, 'TARGET_NOT_CONFIRMED', 'Esta conta nunca confirmou o e-mail: não tem compras nem dados de conta para isso.')

function param(params: Record<string, string>, key: string, missing?: string): string {
  if (!isUuid(params[key])) throw notFound(missing)
  return params[key]
}

// GET /admin/users?q=&filter=all|buyers|newsletter|blocked|admins&page=1: 50 contas por página, a mais nova primeiro.
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

// POST /admin/users/:id/gifts { product_codes, reason, notify }: um pedido de cortesia de R$ 0 com até 10 produtos.
// Com notify, um e-mail do presente sai na hora (e, se falhar, pela fila). Nas recusas, details.products diz quais.
export async function adminGiftProduct(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const body = await readJsonObject(req)
  const codes = Array.isArray(body.product_codes) ? body.product_codes : []
  if (!codes.length || codes.length > 10 || codes.some((code) => typeof code !== 'string' || !PRODUCT_CODE.test(code)) || new Set(codes).size !== codes.length) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Escolha de 1 a 10 jogos para o presente.')
  }
  if (typeof body.notify !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'Diga se a pessoa recebe o e-mail do presente.')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string; order_id: string | null; outbox_id: string | null; products: string[] | null }>('admin_gift_products', {
    p_user_id: user.id, p_target: target, p_product_codes: codes, p_reason: reason, p_notify: body.notify, p_livemode: livemode(),
  })
  const products = result.products ?? []
  const list = products.join(', ')
  settle(result.outcome, {
    product_unavailable: () => new HttpError(409, 'PRODUCT_UNAVAILABLE', `Fora da venda agora, não dá para dar de presente: ${list}.`, { details: { products } }),
    already_owned: () => new HttpError(409, 'ALREADY_OWNED', `A pessoa já tem todos os jogos de: ${list}.`, { details: { products } }),
    overlap: () => new HttpError(409, 'GIFT_OVERLAP', `Estes têm jogo em comum (um pacote e um jogo que já vem nele): ${list}. Escolha só um.`, { details: { products } }),
  })
  dispatchSoon('admin: e-mail do presente', result.outbox_id)
  return json({ order_id: result.order_id, email_queued: Boolean(result.outbox_id), products }, 201)
}

// POST /admin/users/:id/admin { admin, reason }: promove a admin ou tira o admin. Vale no banco na hora; no admin da
// pessoa, quando ela entrar de novo (ou a sessão renovar, até 1 hora). Quem vira admin cadastra o segundo fator.
export async function adminSetAdmin(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const target = param(params, 'id')
  const body = await readJsonObject(req)
  if (typeof body.admin !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'Diga se a conta vira admin ou deixa de ser.')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string }>('admin_set_admin', { p_user_id: user.id, p_target: target, p_admin: body.admin, p_reason: reason })
  settle(result.outcome, {
    unchanged: () => new HttpError(409, 'ADMIN_UNCHANGED', body.admin ? 'Esta conta já é admin.' : 'Esta conta não é admin.'),
    self: () => new HttpError(409, 'PROTECTED_ACCOUNT', 'Você não pode tirar o seu próprio admin. Peça para outra pessoa da equipe.'),
    last_admin: () => new HttpError(409, 'LAST_ADMIN', 'A equipe precisa de pelo menos um admin.'),
    not_confirmed: () => new HttpError(409, 'TARGET_NOT_CONFIRMED', 'Só vira admin uma conta com o e-mail confirmado.'),
    blocked: () => new HttpError(409, 'ACCOUNT_BLOCKED', 'Desbloqueie o login desta conta antes de torná-la admin.'),
  })
  return json({ admin: body.admin })
}

// GET /admin/follow-up: quem precisa de atenção (sacola esquecida, comprou e não baixou, entrega com problema e conta
// sem confirmação), cada lista com o total e até 100 pessoas.
export async function adminFollowUp(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const result = await rpcRow<{ outcome: string; result: Record<string, unknown> | null }>('admin_follow_up', { p_user_id: user.id })
  settle(result.outcome)
  return json(result.result)
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
  dispatchSoon('admin: reenvio do acesso', result.outbox_id)
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
  return json(result.data)
}

// POST /admin/users/:id/delete { reason, confirm_email }: a exclusão a pedido (LGPD), a mesma da própria pessoa: o banco
// anonimiza os pedidos e apaga o resto, o Auth apaga a conta e o Plunk, o contato (o e-mail confirmado é o da conta).
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
  settle(result.outcome, {
    confirmation_mismatch: () => new HttpError(400, 'INVALID_REQUEST', 'O e-mail digitado não é o desta conta.'),
    not_confirmed: notConfirmed,
    blocked: () => deletionBlocked(result.reason),
  })
  await deleteAuthUser(target)
  forgetEmailContact(body.confirm_email)
  return json({ deleted: true, orders_anonymized: result.orders_anonymized ?? 0 })
}
