import { rpc } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { env } from '../../_shared/env.ts'
import { json } from '../../_shared/http.ts'

interface Library {
  games: unknown[]
  pending: unknown[]
  founder?: boolean
}

// GET /library: Meus jogos por jogo, com produtos de origem e pedidos em processamento. Quem comprou ao menos um jogo
// pago (founder) recebe também o convite do grupo dos Fundadores no WhatsApp (2026-11-04); o link fica só no segredo
// da função, nunca no site nem no banco. Sem o segredo, ou para os demais, community_url é null.
export async function library(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const { founder = false, ...data } = (await rpc<Library | null>('get_library', { p_user_id: user.id })) ?? { games: [], pending: [] }
  return json({ ...data, community_url: founder ? env.communityUrl() : null })
}
