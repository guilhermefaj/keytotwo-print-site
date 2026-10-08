import { sameSecret } from '../_shared/compare.ts'
import { dispatchEmails } from '../_shared/email.ts'
import { env } from '../_shared/env.ts'
import { errorResponse, HttpError, json, toErrorResponse } from '../_shared/http.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// email-dispatch (interna): chamada pelo pg_cron/pg_net e em segundo plano pela api e pelo webhook.
export async function handleEmailDispatch(req: Request): Promise<Response> {
  if (req.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', { headers: { Allow: 'POST' } })
  try {
    if (!(await sameSecret(req.headers.get('apikey') ?? '', env.dispatchKey()))) throw new HttpError(401, 'UNAUTHENTICATED', 'Chave inválida.')
    const text = await req.text()
    const body = text ? JSON.parse(text) : {}
    const limit = body.limit === undefined ? 20 : body.limit
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'INVALID_REQUEST', 'limit entre 1 e 100.')
    if (body.outbox_id !== undefined && (typeof body.outbox_id !== 'string' || !UUID.test(body.outbox_id))) {
      throw new HttpError(400, 'INVALID_REQUEST', 'outbox_id inválido.')
    }
    return json(await dispatchEmails({ limit, outboxId: body.outbox_id }))
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(400, 'INVALID_REQUEST', 'Corpo JSON inválido.')
    return toErrorResponse(error)
  }
}
