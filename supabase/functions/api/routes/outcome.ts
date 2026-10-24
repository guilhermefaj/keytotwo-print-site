import { HttpError } from '../../_shared/http.ts'

// As RPCs de admin respondem com outcome: ok segue; os comuns a todas e os próprios de cada rota
// viram erro. Outcome que ninguém previu é defeito: vira 500, não uma resposta inventada.

const notAdmin = () => new HttpError(403, 'NOT_ADMIN', 'Esta área é só para a equipe da KeyToTwo.')

const COMMON: Record<string, () => HttpError> = {
  forbidden: notAdmin,
  not_found: () => new HttpError(404, 'NOT_FOUND', 'Conta não encontrada. Ela pode ter sido excluída.'),
  protected: () => new HttpError(409, 'PROTECTED_ACCOUNT', 'Isso não vale para a sua própria conta nem para a de outro admin.'),
}

// Motivo de toda ação que muda algo: de 3 a 300 caracteres (o banco confere de novo).
export function reasonOf(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3 || reason.length > 300) throw new HttpError(400, 'INVALID_REQUEST', 'Escreva o motivo, de 3 a 300 caracteres.')
  return reason
}

export function settle(outcome: string, own: Record<string, () => HttpError> = {}): void {
  if (outcome === 'ok' || outcome === 'deleted') return
  if (Object.hasOwn(own, outcome)) throw own[outcome]()
  if (Object.hasOwn(COMMON, outcome)) throw COMMON[outcome]()
  throw new Error(`admin: outcome inesperado (${outcome})`)
}
