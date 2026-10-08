import { rpc } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { json } from '../../_shared/http.ts'

interface Library {
  games: unknown[]
  pending: unknown[]
}

// GET /library: Meus jogos por jogo, com produtos de origem e pedidos em processamento.
export async function library(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const data = await rpc<Library | null>('get_library', { p_user_id: user.id })
  return json(data ?? { games: [], pending: [] })
}
