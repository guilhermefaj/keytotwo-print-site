import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { fileId, type ResolvedFile, signedUrl } from './downloads.ts'

interface FreeGame {
  code: string
  name: string
  file: { id: string; version: string; size_bytes: number; filename: string }
}

// GET /free-games (pública): os gratuitos publicados, sem chave do B2; lista vazia enquanto não houver nenhum.
export async function freeGames(): Promise<Response> {
  const games = await rpc<FreeGame[] | null>('list_free_games')
  return json({
    games: (games ?? []).map(({ code, name, file }) => ({ code, name, file: { id: file.id, version: file.version, size_bytes: file.size_bytes } })),
  })
}

// POST /free-download { file_id } (com sessão): só arquivo gratuito publicado, para quem já aceitou os e-mails alguma
// vez (locked → 403). Qualquer outro id é 404.
export async function freeDownload(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const id = fileId(await readJsonObject(req))
  const file = await rpcRow<ResolvedFile>('resolve_free_download', { p_user_id: user.id, p_file_id: id })
  if (file.outcome === 'locked') throw new HttpError(403, 'FREE_GAMES_LOCKED', 'Para baixar os gratuitos, aceite receber nossos e-mails.')
  if (file.outcome !== 'ok') throw new HttpError(404, 'FILE_NOT_FOUND', 'Arquivo não encontrado.')
  const { url, expiresAt } = await signedUrl(file)
  return json({ url, expires_at: expiresAt })
}
