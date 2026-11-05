import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { env } from '../../_shared/env.ts'
import { HttpError, json, readJsonObject, redirect } from '../../_shared/http.ts'
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

// Robôs que abrem o link só para montar a prévia (WhatsApp, Instagram e Facebook, Telegram etc.). Só nomes de robô:
// o navegador dentro do Instagram ou do Facebook (Instagram, FBAN) é gente e baixa normalmente.
const PREVIEW_BOTS = /facebookexternalhit|facebookcatalog|meta-externalagent|WhatsApp|TelegramBot|Twitterbot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Googlebot|bingbot|Applebot/i
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// GET /free/:slug (pública, 2026-11-05): o link da marca, keytotwo.com.br/baixar/<slug>, passa pelo nginx do site e
// chega aqui; vai direto para o PDF assinado (attachment), sem conta, e o download conta como 'free'. Robô de prévia e
// slug que não é de gratuito publicado vão para /gratuitos: a prévia mostra o cartão da página e não conta download.
export async function freeLink(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const page = `${env.siteUrl()}/gratuitos`
  const slug = params.slug ?? ''
  if (!SLUG.test(slug) || PREVIEW_BOTS.test(req.headers.get('user-agent') ?? '')) return redirect(page)
  const file = await rpcRow<ResolvedFile>('resolve_free_link', { p_slug: slug })
  if (file.outcome !== 'ok') return redirect(page)
  return redirect((await signedUrl(file)).url)
}
