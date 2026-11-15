import { rpc } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { env } from '../../_shared/env.ts'
import { json } from '../../_shared/http.ts'

interface Library {
  games: unknown[]
  pending: unknown[]
  founder?: boolean
}

// GET /library: Meus jogos por jogo, com produtos de origem e pedidos em processamento, e o convite do grupo da
// KeyToTwo no WhatsApp. O grupo era só de quem comprou um jogo pago (founder, 2026-11-04); desde 2026-11-15 é de toda
// conta (o get_library já exige e-mail confirmado), para quem cria conta ou pega um gratuito também entrar. O link fica
// só no segredo da função, nunca no site nem no banco; sem o segredo, community_url é null. O founder do banco não sai.
export async function library(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const data = (await rpc<Library | null>('get_library', { p_user_id: user.id })) ?? { games: [], pending: [] }
  delete data.founder
  return json({ ...data, community_url: env.communityUrl() })
}
