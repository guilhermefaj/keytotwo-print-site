import { rpcRow } from '../_shared/admin.ts'
import { sameSecret } from '../_shared/compare.ts'
import { env } from '../_shared/env.ts'
import { HttpError, json, postOnly, readJson, toErrorResponse } from '../_shared/http.ts'
import { countCall } from '../_shared/usage.ts'

// plunk-webhook (2026-10-31, fase 4): a automação "Descadastro no Plunk" chama aqui quando alguém sai da lista pelo
// rodapé de um e-mail do Plunk (evento contact.unsubscribed). Autenticação: Authorization: Bearer <PLUNK_WEBHOOK_SECRET>,
// o mesmo valor do passo de webhook da automação. Corpo: { email, motivo }, com o motivo do evento ("snooze" quando a
// pessoa só pausou os e-mails no Plunk: aí o site não muda nada). O e-mail nunca vai para o log.
const MAX_BODY_BYTES = 16 * 1024

export async function handlePlunkWebhook(req: Request): Promise<Response> {
  countCall('webhooks')
  if (req.method !== 'POST') return postOnly()
  try {
    const auth = req.headers.get('Authorization') ?? ''
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? ''
    if (!(await sameSecret(token, env.plunkWebhookSecret()))) throw new HttpError(401, 'UNAUTHENTICATED', 'Credencial inválida.')
    const body = await readJson(req, MAX_BODY_BYTES)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'INVALID_REQUEST', 'Corpo JSON inválido.')
    const { email, motivo } = body as { email?: unknown; motivo?: unknown }
    if (typeof email !== 'string' || !email.includes('@')) throw new HttpError(400, 'INVALID_REQUEST', 'E-mail ausente.')
    if (motivo === 'snooze') return json({ outcome: 'ignored' })
    const result = await rpcRow<{ outcome: string }>('record_plunk_unsubscribe', { p_email: email })
    return json({ outcome: result.outcome })
  } catch (error) {
    return toErrorResponse(error)
  }
}
