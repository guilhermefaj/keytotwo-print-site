import { rpc, rpcRow } from '../../_shared/admin.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { fileId, type ResolvedFile, signedUrl } from './downloads.ts'

interface FreeGame {
  available: boolean
  game?: { code: string; name: string }
  file?: { id: string; version: string; size_bytes: number; filename: string }
}

// GET /free-game (pública): available=false enquanto não houver jogo gratuito publicado (D12).
export async function freeGame(): Promise<Response> {
  const data = await rpc<FreeGame | null>('get_free_game')
  if (!data?.available || !data.game || !data.file) return json({ available: false })
  return json({
    available: true,
    game: { name: data.game.name },
    file: { id: data.file.id, version: data.file.version, size_bytes: data.file.size_bytes },
  })
}

// POST /free-download { file_id } (pública): só arquivo gratuito publicado; qualquer outro id é 404.
export async function freeDownload(req: Request): Promise<Response> {
  const id = fileId(await readJsonObject(req))
  const file = await rpcRow<ResolvedFile>('resolve_free_download', { p_file_id: id })
  if (file.outcome !== 'ok') throw new HttpError(404, 'FILE_NOT_FOUND', 'Arquivo não encontrado.')
  const { url, expiresAt } = await signedUrl(file)
  return json({ url, expires_at: expiresAt })
}
