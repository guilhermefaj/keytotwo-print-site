import { HttpError } from '../../_shared/http.ts'

// As RPCs de admin respondem com outcome: ok segue; os comuns a todas e os próprios de cada rota
// viram erro. Outcome que ninguém previu é defeito: vira 500, não uma resposta inventada.

const notAdmin = () => new HttpError(403, 'NOT_ADMIN', 'Esta área é só para a equipe da KeyToTwo.')

const COMMON: Record<string, () => HttpError> = {
  forbidden: notAdmin,
  not_found: () => new HttpError(404, 'NOT_FOUND', 'Conta não encontrada. Ela pode ter sido excluída.'),
  protected: () => new HttpError(409, 'PROTECTED_ACCOUNT', 'Isso não vale para a sua própria conta nem para a de outro admin.'),
}

export function settle(outcome: string, own: Record<string, () => HttpError> = {}): void {
  if (outcome === 'ok' || outcome === 'deleted') return
  if (Object.hasOwn(own, outcome)) throw own[outcome]()
  if (Object.hasOwn(COMMON, outcome)) throw COMMON[outcome]()
  throw new Error(`admin: outcome inesperado (${outcome})`)
}
