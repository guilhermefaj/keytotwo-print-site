import { RpcError, rpcRow } from '../_shared/admin.ts'
import { env } from '../_shared/env.ts'
import { HttpError, json, postOnly, readText, toErrorResponse } from '../_shared/http.ts'
import { countCall } from '../_shared/usage.ts'

// ses-events: avisos do Amazon SES (os e-mails que o Plunk envia) → record_email_event com origem ses_events
// (docs/api-contract.md 8.3). Chegam pelo Amazon SNS, que assina cada mensagem: a assinatura (SignatureVersion 2,
// RSA-SHA256) é conferida com o certificado do próprio SNS, da região do tópico, e só vale o tópico configurado
// (SES_EVENTS_TOPIC_ARN). A inscrição no SNS já filtra bounces e reclamações; aqui só o bounce definitivo e a
// reclamação viram supressão, como no webhook da Brevo. O e-mail do payload nunca vai para o log.

type Reason = 'hard_bounce' | 'complaint'

// O SNS manda até 256 KB por mensagem.
const MAX_BODY_BYTES = 512 * 1024

interface SnsMessage {
  Type?: unknown
  MessageId?: unknown
  TopicArn?: unknown
  Subject?: unknown
  Message?: unknown
  Timestamp?: unknown
  Token?: unknown
  SubscribeURL?: unknown
  SignatureVersion?: unknown
  Signature?: unknown
  SigningCertURL?: unknown
}

// Só os campos lidos do evento do SES; o resto (cabeçalhos, diagnóstico do servidor) fica de fora.
interface SesEvent {
  eventType?: unknown
  notificationType?: unknown
  mail?: { messageId?: unknown } | null
  bounce?: { bounceType?: unknown; bouncedRecipients?: unknown; timestamp?: unknown } | null
  complaint?: { complainedRecipients?: unknown; timestamp?: unknown } | null
}

interface EventSummary {
  received: number
  recorded: number
  ignored: number
}

// Um elemento do DER (tag, comprimento, conteúdo): onde o conteúdo começa e onde o elemento acaba.
function derItem(der: Uint8Array, at: number): { tag: number; start: number; end: number } {
  if (at + 2 > der.length) throw new Error('certificado_der')
  const tag = der[at]
  let length = der[at + 1]
  let start = at + 2
  if (length & 0x80) {
    const bytes = length & 0x7f
    if (bytes < 1 || bytes > 4) throw new Error('certificado_der')
    length = 0
    for (let i = 0; i < bytes; i++) length = length * 256 + der[start + i]
    start += bytes
  }
  const end = start + length
  if (end > der.length) throw new Error('certificado_der')
  return { tag, start, end }
}

// A chave pública (SubjectPublicKeyInfo) de um certificado X.509 em PEM, só com o DER e sem node:crypto, que o runtime
// das funções pode não ter: Certificate → tbsCertificate → [versão], série, algoritmo, emissor, validade, titular → chave.
export function spkiFromPem(pem: string): Uint8Array<ArrayBuffer> {
  const der = Uint8Array.from(atob(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const cert = derItem(der, 0)
  const tbs = derItem(der, cert.start)
  if (cert.tag !== 0x30 || tbs.tag !== 0x30) throw new Error('certificado_der')
  let at = tbs.start
  if (der[at] === 0xa0) at = derItem(der, at).end
  for (let field = 0; field < 5; field++) at = derItem(der, at).end
  const spki = derItem(der, at)
  if (spki.tag !== 0x30 || spki.end > tbs.end) throw new Error('certificado_der')
  return der.slice(at, spki.end)
}

// Chave pública do certificado do SNS. Os testes trocam fromPem, porque assinam com uma chave gerada na hora.
export const snsKeys = {
  fromPem: async (pem: string): Promise<CryptoKey> =>
    await crypto.subtle.importKey('spki', spkiFromPem(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
}

// Um certificado por endereço, em memória enquanto a função vive; falhou, a próxima mensagem baixa de novo.
const keys = new Map<string, Promise<CryptoKey>>()

function certKey(href: string): Promise<CryptoKey> {
  let key = keys.get(href)
  if (!key) {
    key = (async () => {
      const res = await fetch(href, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`sns_certificado_http_${res.status}`)
      return await snsKeys.fromPem(await res.text())
    })()
    keys.set(href, key)
    key.catch(() => keys.delete(href))
  }
  return key
}

// Endereço do SNS da região do tópico, só HTTPS: o do certificado e o da confirmação da inscrição.
function snsUrl(value: unknown, region: string): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === `sns.${region}.amazonaws.com` ? url : null
  } catch {
    return null
  }
}

// O texto que o SNS assina: os campos do tipo da mensagem, em ordem, cada um como "nome\nvalor\n".
function signedText(message: SnsMessage): string | null {
  const fields = message.Type === 'Notification'
    ? ['Message', 'MessageId', ...(typeof message.Subject === 'string' ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  let text = ''
  for (const field of fields) {
    const value = message[field as keyof SnsMessage]
    if (typeof value !== 'string') return null
    text += `${field}\n${value}\n`
  }
  return text
}

async function signatureOk(message: SnsMessage, region: string): Promise<boolean> {
  const cert = snsUrl(message.SigningCertURL, region)
  const text = signedText(message)
  if (message.SignatureVersion !== '2' || typeof message.Signature !== 'string' || !cert?.pathname.endsWith('.pem') || text === null) return false
  let signature: Uint8Array<ArrayBuffer>
  try {
    signature = Uint8Array.from(atob(message.Signature), (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  // Falha ao baixar o certificado sobe e vira 500: o SNS manda de novo.
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await certKey(cert.href), signature, new TextEncoder().encode(text))
}

async function record(email: unknown, reason: Reason, messageId: string | null, occurredAt: string | null): Promise<boolean> {
  if (typeof email !== 'string' || !email.trim()) return false
  try {
    await rpcRow('record_email_event', {
      p_email: email.trim().toLowerCase(),
      p_event: reason,
      p_provider_message_id: messageId,
      ...(occurredAt ? { p_occurred_at: occurredAt } : {}),
      p_source: 'ses_events',
    })
    return true
  } catch (error) {
    // KT001 (e-mail fora do padrão): reenviar não resolve; os demais erros sobem e viram 500 para o SNS reenviar.
    if (error instanceof RpcError && error.code === 'KT001') {
      console.error(`ses-events: evento ${reason} ignorado (KT001)`)
      return false
    }
    throw error
  }
}

// O evento do SES (formato da publicação de eventos; o das notificações da identidade usa notificationType).
async function recordEvent(raw: string): Promise<EventSummary> {
  let event: SesEvent | null
  try {
    event = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Evento do SES inválido.')
  }
  if (!event || typeof event !== 'object') throw new HttpError(400, 'INVALID_REQUEST', 'Evento do SES inválido.')
  const type = event.eventType ?? event.notificationType
  const detail = type === 'Bounce' && event.bounce?.bounceType === 'Permanent'
    ? { reason: 'hard_bounce' as const, list: event.bounce.bouncedRecipients, when: event.bounce.timestamp }
    : type === 'Complaint'
    ? { reason: 'complaint' as const, list: event.complaint?.complainedRecipients, when: event.complaint?.timestamp }
    : null
  if (!detail || !Array.isArray(detail.list)) return { received: 0, recorded: 0, ignored: 1 }
  const messageId = typeof event.mail?.messageId === 'string' ? event.mail.messageId.slice(0, 200) : null
  const date = typeof detail.when === 'string' ? new Date(detail.when) : null
  const occurredAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : null
  const summary: EventSummary = { received: detail.list.length, recorded: 0, ignored: 0 }
  // Em sequência: o RPC é idempotente por (e-mail, motivo), então o reenvio do SNS após um 500 é seguro.
  for (const recipient of detail.list as Array<{ emailAddress?: unknown } | null>) {
    if (await record(recipient?.emailAddress, detail.reason, messageId, occurredAt)) summary.recorded++
    else summary.ignored++
  }
  return summary
}

export async function handleSesEvents(req: Request): Promise<Response> {
  countCall('webhooks')
  if (req.method !== 'POST') return postOnly()
  try {
    // O SNS manda text/plain com JSON dentro.
    let message: SnsMessage
    try {
      message = JSON.parse(await readText(req, MAX_BODY_BYTES))
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(400, 'INVALID_REQUEST', 'Corpo JSON inválido.')
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new HttpError(400, 'INVALID_REQUEST', 'Corpo JSON inválido.')
    const topic = env.sesEventsTopicArn()
    const region = topic.split(':')[3] ?? ''
    if (message.TopicArn !== topic || !(await signatureOk(message, region))) {
      throw new HttpError(400, 'INVALID_SIGNATURE', 'Assinatura do SNS inválida.')
    }
    switch (message.Type) {
      case 'SubscriptionConfirmation': {
        const url = snsUrl(message.SubscribeURL, region)
        if (!url) throw new HttpError(400, 'INVALID_REQUEST', 'Endereço de confirmação inválido.')
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`sns_confirmacao_http_${res.status}`)
        return json({ confirmed: true })
      }
      case 'Notification':
        return json(await recordEvent(typeof message.Message === 'string' ? message.Message : ''))
      case 'UnsubscribeConfirmation':
        return json({ received: 0, recorded: 0, ignored: 1 })
      default:
        throw new HttpError(400, 'INVALID_REQUEST', 'Tipo de mensagem do SNS desconhecido.')
    }
  } catch (error) {
    return toErrorResponse(error)
  }
}
