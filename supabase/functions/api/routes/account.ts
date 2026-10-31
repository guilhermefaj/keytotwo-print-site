import { deleteAuthUser, rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { forgetEmailContact } from '../../_shared/email.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'

// Mesmo formato do CHECK de marketing_consents.text_version (data-contract 2.4).
const TEXT_VERSION = /^[A-Za-z0-9._-]{1,40}$/
// Origens aceitas do site; signup_prompt e free_games só concedem (data-contract 2.4).
const SOURCES = ['account', 'signup_prompt', 'free_games'] as const
type Source = typeof SOURCES[number]

interface Account {
  email: string | null
  marketing: { opted_in: boolean; updated_at: string | null; text_version: string | null; prompted_at: string | null }
  free_games_unlocked: boolean
  orders: unknown[]
}

async function loadAccount(userId: string): Promise<Account> {
  const account = await rpc<Account | null>('get_account', { p_user_id: userId })
  return account ?? {
    email: null,
    marketing: { opted_in: false, updated_at: null, text_version: null, prompted_at: null },
    free_games_unlocked: false,
    orders: [],
  }
}

// GET /account: e-mail, preferência de marketing e pedidos com itens.
export async function getAccount(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  return json(await loadAccount(user.id))
}

// PUT /account/marketing { granted, source, text_version }
export async function putMarketing(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const body = await readJsonObject(req)
  const { granted, source, text_version: textVersion } = body
  if (typeof granted !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'Informe granted como true ou false.')
  if (typeof source !== 'string' || !SOURCES.includes(source as Source)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Origem do consentimento inválida.')
  }
  if (!granted && source !== 'account') {
    throw new HttpError(400, 'INVALID_REQUEST', 'A preferência só é retirada pela conta.')
  }
  if (textVersion !== undefined && textVersion !== null && (typeof textVersion !== 'string' || !TEXT_VERSION.test(textVersion))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Versão do texto inválida.')
  }
  if (granted && !textVersion) throw new HttpError(400, 'INVALID_REQUEST', 'Informe a versão do texto aceito.')
  await rpcRow('set_marketing_consent', {
    p_user_id: user.id,
    p_granted: granted,
    p_source: source,
    p_text_version: textVersion ?? null,
  })
  return json({ marketing: (await loadAccount(user.id)).marketing })
}

// GET /account/export: a cópia dos dados da conta (LGPD, art. 18), salva pelo site como arquivo JSON.
export async function exportAccount(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const data = await rpc<Record<string, unknown>>('export_account_data', { p_user_id: user.id })
  return json(data)
}

const DELETION_BLOCKED: Record<string, string> = {
  payment_pending: 'Há um pagamento em andamento nesta conta. Tente de novo quando ele terminar.',
  checkout_open: 'Há um pagamento em andamento nesta conta. Tente de novo quando ele terminar.',
  dispute_open: 'Há uma contestação de pagamento aberta nesta conta. Tente de novo quando ela terminar.',
}

// Exclusão recusada (pela própria pessoa ou pelo admin): o motivo vai em details para o site explicar.
export function deletionBlocked(reason: string | null): HttpError {
  const known = reason && Object.hasOwn(DELETION_BLOCKED, reason) ? reason : 'payment_pending'
  return new HttpError(409, 'ACCOUNT_DELETION_BLOCKED', DELETION_BLOCKED[known], { details: { reason: reason ?? known } })
}

// POST /account/delete { confirmation: "EXCLUIR" }: anonimiza os pedidos e apaga o resto (delete_account_data);
// depois apaga o usuário no Auth e, no Plunk, o contato do e-mail. Se o Auth falhar, repetir é seguro: a RPC é idempotente.
export async function deleteAccount(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const { confirmation } = await readJsonObject(req)
  if (typeof confirmation !== 'string' || confirmation.trim().toUpperCase() !== 'EXCLUIR') {
    throw new HttpError(400, 'INVALID_REQUEST', 'Digite EXCLUIR para confirmar a exclusão da conta.')
  }
  const result = await rpcRow<{ outcome: string; reason: string | null; orders_anonymized: number }>('delete_account_data', { p_user_id: user.id })
  if (result.outcome === 'blocked') throw deletionBlocked(result.reason)
  if (result.outcome !== 'deleted') throw new Error(`delete_account_data: outcome inesperado (${result.outcome})`)
  await deleteAuthUser(user.id)
  forgetEmailContact(user.email)
  return json({ deleted: true })
}
