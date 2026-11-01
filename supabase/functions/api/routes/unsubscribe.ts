import { RpcError, rpcRow } from '../../_shared/admin.ts'
import { unsubscribePlunkContact } from '../../_shared/email.ts'
import { env } from '../../_shared/env.ts'
import { HttpError, isContentType, isUuid, json, readJsonObject, readText, redirect } from '../../_shared/http.ts'
import { verifyUnsubscribeToken } from '../../_shared/tokens.ts'

// Descadastro em 1 clique (RFC 8058), autenticado pelo token de propósito u (docs/api-contract.md 6.10). Desde
// 2026-11-01 também pelo id do contato no Plunk: o link do rodapé dos e-mails dele chega à página de preferências do site.

const invalid = () => new HttpError(400, 'INVALID_TOKEN', 'Link de descadastro inválido.')

// GET não muda nada (leitores de e-mail abrem links): leva à página pública de preferências, que confirma e chama o POST.
export function unsubscribePage(_req: Request, url: URL): Response {
  const token = url.searchParams.get('token') ?? ''
  return redirect(`${env.siteUrl()}/email/preferencias?token=${encodeURIComponent(token)}`)
}

type Link = { token: string } | { contact: string; emailId?: string }

// Token na query (List-Unsubscribe-Post) ou no corpo: JSON { token } ou formulário (token=...). O link do Plunk vem em
// JSON { contact, email_id }: os ids do contato e do e-mail de origem (opcional) no Plunk.
async function linkFrom(req: Request, url: URL): Promise<Link> {
  const query = url.searchParams.get('token')
  if (query) return { token: query }
  if (isContentType(req, 'application/json')) {
    const body = await readJsonObject(req)
    if (typeof body.token === 'string') return { token: body.token }
    if (isUuid(body.contact)) return { contact: body.contact.toLowerCase(), emailId: isUuid(body.email_id) ? body.email_id.toLowerCase() : undefined }
  } else if (isContentType(req, 'application/x-www-form-urlencoded')) {
    const token = new URLSearchParams(await readText(req)).get('token')
    if (token) return { token }
  }
  throw invalid()
}

// POST: revoga o consentimento na hora (unsubscribe) e cancela o marketing na fila; idempotente.
export async function unsubscribe(req: Request, url: URL): Promise<Response> {
  const link = await linkFrom(req, url)
  if ('contact' in link) {
    // Sai da lista no Plunk e, na hora, também no site, pelo caminho do webhook dele (record_plunk_unsubscribe só age se
    // o site ainda tem a pessoa inscrita, então o aviso que o Plunk manda depois não muda nada).
    const email = await unsubscribePlunkContact(link.contact, link.emailId)
    if (email) await rpcRow('record_plunk_unsubscribe', { p_email: email })
    return json({ status: 'unsubscribed' })
  }
  const verified = await verifyUnsubscribeToken(link.token)
  if (!verified.ok) throw invalid()
  try {
    await rpcRow('unsubscribe', { p_user_id: verified.claims.u, p_source: 'unsubscribe_link' })
  } catch (error) {
    // Com o token válido, KT001 só vem de conta excluída (D-28): ela já não recebe nada.
    if (!(error instanceof RpcError && error.code === 'KT001')) throw error
  }
  return json({ status: 'unsubscribed' })
}
