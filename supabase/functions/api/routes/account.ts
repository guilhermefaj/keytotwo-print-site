import { deleteAuthUser, rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { forgetEmailContact } from '../../_shared/email.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'

// Mesmo formato do CHECK de marketing_consents.text_version (data-contract 2.4).
const TEXT_VERSION = /^[A-Za-z0-9._-]{1,40}$/
// Origens aceitas do site; signup_prompt e free_games só concedem (data-contract 2.4).
const SOURCES = ['account', 'signup_prompt', 'free_games'] as const
type Source = typeof SOURCES[number]

interface Profile {
  name: string | null
  birth_date: string | null
  whatsapp: string | null
  saved: boolean
}

interface Account {
  email: string | null
  profile: Profile
  marketing: { opted_in: boolean; updated_at: string | null; text_version: string | null; prompted_at: string | null }
  free_games_unlocked: boolean
  orders: unknown[]
}

async function loadAccount(userId: string): Promise<Account> {
  const account = await rpc<Account | null>('get_account', { p_user_id: userId })
  return account ?? {
    email: null,
    profile: { name: null, birth_date: null, whatsapp: null, saved: false },
    marketing: { opted_in: false, updated_at: null, text_version: null, prompted_at: null },
    free_games_unlocked: false,
    orders: [],
  }
}

// GET /account: e-mail, perfil, preferência de marketing e pedidos com itens.
export async function getAccount(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  return json(await loadAccount(user.id))
}

// Perfil (2026-11-01): as mesmas regras de set_account_profile (migração 20261101120000), que confere de novo.
const NAME_MAX = 80
const WHATSAPP = /^\+[1-9]\d{7,14}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function invalidField(field: string, message: string): HttpError {
  return new HttpError(400, 'INVALID_REQUEST', message, { details: { field } })
}

function profileName(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalidField('name', 'Nome inválido.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) return null
  if ([...name].length > NAME_MAX || /\p{Cc}/u.test(name)) throw invalidField('name', `Use até ${NAME_MAX} letras no nome.`)
  return name
}

// A maior data aceita: 18 anos antes de hoje, no dia de Brasília (29/02 vira 28/02 num ano que não é bissexto).
export function adultBirthLimit(now = new Date()): string {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now).split('-').map(Number)
  const limit = new Date(Date.UTC(year - 18, month - 1, day))
  if (limit.getUTCMonth() !== month - 1) limit.setUTCDate(0)
  return limit.toISOString().slice(0, 10)
}

function birthDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const valid = typeof value === 'string' && ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  if (!valid || value < '1900-01-01') throw invalidField('birth_date', 'Data de nascimento inválida.')
  if (value > adultBirthLimit()) throw invalidField('birth_date', 'A conta é só para maiores de 18 anos.')
  return value
}

function whatsapp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !WHATSAPP.test(value)) throw invalidField('whatsapp', 'WhatsApp no formato internacional, como +5511912345678.')
  return value
}

// PUT /account/profile { name, birth_date, whatsapp }: grava os três de uma vez (nulo ou vazio apaga) e devolve o perfil.
// O site manda o WhatsApp já no formato internacional (E.164).
export async function putProfile(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const body = await readJsonObject(req)
  const profile = await rpc<Profile>('set_account_profile', {
    p_user_id: user.id,
    p_full_name: profileName(body.name),
    p_birth_date: birthDate(body.birth_date),
    p_whatsapp: whatsapp(body.whatsapp),
  })
  return json({ profile })
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
