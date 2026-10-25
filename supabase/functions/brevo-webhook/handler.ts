import { RpcError, rpcRow } from '../_shared/admin.ts'
import { sameSecret } from '../_shared/compare.ts'
import { env } from '../_shared/env.ts'
import { HttpError, json, postOnly, readJson, toErrorResponse } from '../_shared/http.ts'
import { countCall } from '../_shared/usage.ts'

// brevo-webhook (I5): eventos transacionais da Brevo → record_email_event (docs/api-contract.md 8.1).
// Autenticação: Authorization: Bearer <BREVO_WEBHOOK_SECRET> (webhook criado com auth.type = bearer).
// Aceita um evento ou, com batched = true, uma lista. O e-mail do payload nunca vai para o log.

type Reason = 'hard_bounce' | 'complaint' | 'unsubscribe'

const EVENTS: Record<string, Reason> = {
  hard_bounce: 'hard_bounce',
  invalid_email: 'hard_bounce',
  blocked: 'hard_bounce',
  spam: 'complaint',
  unsubscribed: 'unsubscribe',
}

// Lote de até 5 minutos de eventos.
const MAX_BODY_BYTES = 1024 * 1024

interface BrevoEvent {
  event?: unknown
  email?: unknown
  'message-id'?: unknown
  ts_event?: unknown
  ts?: unknown
}

interface WebhookSummary {
  received: number
  recorded: number
  ignored: number
}

// Data do evento; fora do que uma data aceita (lixo no payload), fica sem data e o banco usa a hora do registro.
function occurredAt(event: BrevoEvent): string | null {
  const seconds = typeof event.ts_event === 'number' ? event.ts_event : typeof event.ts === 'number' ? event.ts : null
  const date = seconds === null ? null : new Date(seconds * 1000)
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null
}

async function record(event: BrevoEvent): Promise<boolean> {
  const reason = typeof event.event === 'string' ? EVENTS[event.event] : undefined
  if (!reason || typeof event.email !== 'string' || !event.email.trim()) return false
  const messageId = typeof event['message-id'] === 'string' ? event['message-id'].slice(0, 200) : null
  try {
    await rpcRow('record_email_event', {
      p_email: event.email.trim().toLowerCase(),
      p_event: reason,
      p_provider_message_id: messageId,
      ...(occurredAt(event) ? { p_occurred_at: occurredAt(event) } : {}),
    })
    return true
  } catch (error) {
    // KT001 (e-mail fora do padrão): reenviar não resolve; os demais erros sobem e viram 500 para a Brevo reenviar.
    if (error instanceof RpcError && error.code === 'KT001') {
      console.error(`brevo-webhook: evento ${reason} ignorado (KT001)`)
      return false
    }
    throw error
  }
}

export async function handleBrevoWebhook(req: Request): Promise<Response> {
  countCall('webhooks')
  if (req.method !== 'POST') return postOnly()
  try {
    const auth = req.headers.get('Authorization') ?? ''
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? ''
    if (!(await sameSecret(token, env.brevoWebhookSecret()))) throw new HttpError(401, 'UNAUTHENTICATED', 'Credencial inválida.')
    const body = await readJson(req, MAX_BODY_BYTES)
    const events = (Array.isArray(body) ? body : [body]).filter((e): e is BrevoEvent => Boolean(e) && typeof e === 'object' && !Array.isArray(e))
    if (!events.length) throw new HttpError(400, 'INVALID_REQUEST', 'Nenhum evento no corpo.')
    const summary: WebhookSummary = { received: events.length, recorded: 0, ignored: 0 }
    // Em sequência: o RPC é idempotente por (e-mail, motivo), então o reenvio da Brevo após um 500 é seguro.
    for (const event of events) {
      if (await record(event)) summary.recorded++
      else summary.ignored++
    }
    return json(summary)
  } catch (error) {
    return toErrorResponse(error)
  }
}
