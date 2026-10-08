import { rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { presignUrl, readOnlyConfig } from '../../_shared/b2.ts'
import { env } from '../../_shared/env.ts'
import { errorResponse, HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { verifyDeliveryToken } from '../../_shared/tokens.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Retorno de resolve_download, resolve_delivery e resolve_free_download (data-contract 6.8).
export interface ResolvedFile {
  outcome: string
  bucket: string | null
  object_key: string | null
  filename: string | null
  content_type: string | null
  size_bytes: number | null
}

export function fileId(body: Record<string, unknown>): string {
  if (typeof body.file_id !== 'string' || !UUID.test(body.file_id)) throw new HttpError(400, 'INVALID_REQUEST', 'Arquivo inválido.')
  return body.file_id
}

// Content-Disposition (RFC 6266): nome ASCII seguro e filename* em UTF-8.
export function attachment(filename: string): string {
  const ascii = filename.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_').trim() || 'arquivo.pdf'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

// URL assinada no bucket configurado (chave só leitura, restrita a ele); vale cerca de 300 s.
// O B2 responde sempre como anexo e com o tipo do banco, independente do metadado do upload.
export async function signedUrl(file: ResolvedFile): Promise<{ url: string; expiresAt: string }> {
  if (!file.object_key) throw new Error('arquivo sem object_key')
  const filename = file.filename || file.object_key.split('/').pop()!
  return await presignUrl(readOnlyConfig(), {
    key: file.object_key,
    query: { 'response-content-disposition': attachment(filename), 'response-content-type': file.content_type || 'application/pdf' },
  })
}

// POST /download-url { file_id }: confere sessão e direito na hora, e assina.
export async function downloadUrl(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const id = fileId(await readJsonObject(req))
  const file = await rpcRow<ResolvedFile>('resolve_download', { p_user_id: user.id, p_file_id: id })
  switch (file.outcome) {
    case 'ok': {
      const { url, expiresAt } = await signedUrl(file)
      return json({ url, expires_at: expiresAt, filename: file.filename })
    }
    case 'not_entitled':
      throw new HttpError(403, 'NOT_ENTITLED', 'Você não tem acesso a este arquivo.')
    case 'unavailable':
      throw new HttpError(503, 'FILE_UNAVAILABLE', 'Arquivo temporariamente indisponível. Tente de novo em instantes.')
    default:
      throw new HttpError(404, 'FILE_NOT_FOUND', 'Arquivo não encontrado. Recarregue Meus jogos.')
  }
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

// GET /d/{token}: link do e-mail de entrega. O direito é conferido de novo no clique.
export async function deliveryLink(_req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const verified = await verifyDeliveryToken(params.token ?? '')
  if (!verified.ok && verified.reason === 'invalid') {
    return errorResponse(401, 'INVALID_TOKEN', 'Link inválido.', { headers: { 'Referrer-Policy': 'no-referrer' } })
  }
  const library = `${env.siteUrl()}/meus-jogos`
  if (!verified.ok) return redirect(`${library}?link=expirado`)
  const file = await rpcRow<ResolvedFile>('resolve_delivery', { p_entitlement_id: verified.claims.e, p_game_id: verified.claims.g })
  if (file.outcome !== 'ok') return redirect(`${library}?link=indisponivel`)
  return redirect((await signedUrl(file)).url)
}
