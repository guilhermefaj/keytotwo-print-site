// Amazon SES direto (2026-11-01): o e-mail dos alertas dos admins sai por aqui, sem passar pelo Plunk na VPS, para o
// aviso de fora do ar sair mesmo com a VPS parada. API v2 (SendEmail, conteúdo simples), assinada com SigV4 nos
// headers, sem SDK. A chave é de um usuário IAM que só envia, só do domínio e só com o remetente do site
// (docs/deploy.md, "Alertas pelo SES").

export interface SesConfig {
  region: string
  keyId: string
  secret: string
}

export interface SesMessage {
  from: { email: string; name: string }
  to: string
  subject: string
  html: string
  text: string
}

const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

async function hmac(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

const amzDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

interface SignInput {
  method: string
  host: string
  path: string
  region: string
  service: string
  // assinados junto com host e x-amz-date (nomes em minúsculas)
  headers?: Record<string, string>
  body?: string
  keyId: string
  secret: string
  now?: Date
}

// SigV4 nos headers, para caminho sem caracteres a codificar e sem query. Devolve os headers a mandar (os assinados,
// x-amz-date e Authorization).
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const stamp = amzDate(input.now ?? new Date())
  const day = stamp.slice(0, 8)
  const headers: Record<string, string> = { ...input.headers, host: input.host, 'x-amz-date': stamp }
  const names = Object.keys(headers).sort()
  const signed = names.join(';')
  const canonical = [
    input.method, input.path, '',
    names.map((name) => `${name}:${headers[name].trim()}\n`).join(''),
    signed, await sha256Hex(input.body ?? ''),
  ].join('\n')
  const scope = `${day}/${input.region}/${input.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonical)].join('\n')
  let key: ArrayBuffer = encoder.encode(`AWS4${input.secret}`).buffer as ArrayBuffer
  for (const part of [day, input.region, input.service, 'aws4_request']) key = await hmac(key, part)
  const signature = hex(await hmac(key, toSign))
  // o host o fetch põe sozinho (pela URL)
  const sent = Object.fromEntries(names.filter((name) => name !== 'host').map((name) => [name, headers[name]]))
  return { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${input.keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}` }
}

// Envia e devolve o status e o MessageId (200) ou o código de erro da AWS. O nome do remetente vai entre aspas.
export async function sendSes(config: SesConfig, message: SesMessage): Promise<{ status: number; messageId?: string; error?: string }> {
  const host = `email.${config.region}.amazonaws.com`
  const path = '/v2/email/outbound-emails'
  const content = (data: string) => ({ Data: data, Charset: 'UTF-8' })
  const body = JSON.stringify({
    FromEmailAddress: `"${message.from.name.replace(/["\\]/g, '')}" <${message.from.email}>`,
    Destination: { ToAddresses: [message.to] },
    Content: { Simple: { Subject: content(message.subject), Body: { Html: content(message.html), Text: content(message.text) } } },
  })
  const headers = await signRequest({
    method: 'POST', host, path, region: config.region, service: 'ses',
    headers: { 'content-type': 'application/json' }, body, keyId: config.keyId, secret: config.secret,
  })
  const res = await fetch(`https://${host}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) })
  const reply = await res.json().catch(() => ({}))
  if (res.ok && typeof reply?.MessageId === 'string') return { status: res.status, messageId: reply.MessageId }
  const type = res.headers.get('x-amzn-ErrorType')?.split(':')[0] ?? reply?.__type ?? ''
  return { status: res.status, error: String(type).replace(/\W+/g, '_').slice(0, 60) }
}
