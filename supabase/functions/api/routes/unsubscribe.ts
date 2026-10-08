import { rpcRow } from '../../_shared/admin.ts'
import { env } from '../../_shared/env.ts'
import { HttpError, isContentType, json, readJsonObject, readText } from '../../_shared/http.ts'
import { verifyUnsubscribeToken } from '../../_shared/tokens.ts'

// Descadastro em 1 clique (RFC 8058), autenticado pelo token de propósito u (docs/api-contract.md 6.10).

const invalid = () => new HttpError(400, 'INVALID_TOKEN', 'Link de descadastro inválido.')

// GET não muda nada (leitores de e-mail abrem links): leva à página pública de preferências, que confirma e chama o POST.
export function unsubscribePage(_req: Request, url: URL): Response {
  const token = url.searchParams.get('token') ?? ''
  const target = `${env.siteUrl()}/email/preferencias?token=${encodeURIComponent(token)}`
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

// Token na query (List-Unsubscribe-Post) ou no corpo: JSON { token } ou formulário (token=...).
async function tokenFrom(req: Request, url: URL): Promise<string> {
  const query = url.searchParams.get('token')
  if (query) return query
  if (isContentType(req, 'application/json')) {
    const body = await readJsonObject(req)
    if (typeof body.token === 'string') return body.token
  } else if (isContentType(req, 'application/x-www-form-urlencoded')) {
    const token = new URLSearchParams(await readText(req)).get('token')
    if (token) return token
  }
  throw invalid()
}

// POST: revoga o consentimento na hora (unsubscribe) e cancela o marketing na fila; idempotente.
export async function unsubscribe(req: Request, url: URL): Promise<Response> {
  const verified = await verifyUnsubscribeToken(await tokenFrom(req, url))
  if (!verified.ok) throw invalid()
  await rpcRow('unsubscribe', { p_user_id: verified.claims.u, p_source: 'unsubscribe_link' })
  return json({ status: 'unsubscribed' })
}
