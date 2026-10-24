import { required as get } from './env.ts'

// URL pré-assinada S3 (SigV4, autenticação por query) para o Backblaze B2, sem SDK.
// Estilo virtual-hosted: https://<bucket>.<endpoint>/<chave>. Só o header host é assinado; corpo UNSIGNED-PAYLOAD.

export interface B2Config {
  endpoint: string // ex.: s3.<região>.backblazeb2.com
  region: string
  bucket: string
  keyId: string
  secret: string
}

const DOWNLOAD_TTL_SECONDS = 300

const endpoint = () => get('B2_ENDPOINT').replace(/^https?:\/\//, '').replace(/\/+$/, '')

// Chave SÓ LEITURA do bucket dos jogos (as funções nunca recebem a de escrita dele).
export function readOnlyConfig(): B2Config {
  return {
    endpoint: endpoint(),
    region: get('B2_REGION'),
    bucket: get('B2_BUCKET'),
    keyId: get('B2_READ_KEY_ID'),
    secret: get('B2_READ_APPLICATION_KEY'),
  }
}

// Imagens do blog: outro bucket, PÚBLICO (keytotwo-print-blog), na mesma conta e região, com uma chave de escrita
// restrita a ele. Nada dos jogos passa por aqui.
export function blogConfig(): B2Config {
  return {
    endpoint: endpoint(),
    region: get('B2_REGION'),
    bucket: get('B2_BLOG_BUCKET'),
    keyId: get('B2_BLOG_KEY_ID'),
    secret: get('B2_BLOG_APPLICATION_KEY'),
  }
}

// Endereço público das imagens do blog (o bucket é público): <base>/<chave>.
export const blogMediaBase = () => `https://${get('B2_BLOG_BUCKET')}.${endpoint()}`

const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

// ArrayBuffer próprio: o Web Crypto não aceita views sobre buffer compartilhável (tipos do TypeScript recente).
const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

async function hmac(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

// RFC 3986: só letras, dígitos e - _ . ~ ficam como estão.
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const amzDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

interface PresignOptions {
  method?: 'GET' | 'HEAD' | 'PUT' | 'DELETE'
  key: string
  expiresIn?: number
  now?: Date
  query?: Record<string, string>
}

export async function presignUrl(config: B2Config, options: PresignOptions): Promise<{ url: string; expiresAt: string }> {
  const method = options.method ?? 'GET'
  const expiresIn = options.expiresIn ?? DOWNLOAD_TTL_SECONDS
  const now = options.now ?? new Date()
  const stamp = amzDate(now)
  const day = stamp.slice(0, 8)
  const host = `${config.bucket}.${config.endpoint}`
  const path = '/' + options.key.split('/').map(encodeRfc3986).join('/')
  const scope = `${day}/${config.region}/s3/aws4_request`

  const params: Record<string, string> = {
    ...options.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.keyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  }
  const query = Object.keys(params).sort().map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(params[k])}`).join('&')
  const canonicalRequest = [method, path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n')

  let key = toBuffer(encoder.encode(`AWS4${config.secret}`))
  for (const part of [day, config.region, 's3', 'aws4_request']) key = await hmac(key, part)
  const signature = hex(await hmac(key, stringToSign))

  return {
    url: `https://${host}${path}?${query}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
  }
}

interface StoredObject {
  key: string
  size: number
  lastModified: string
}

// Content-Disposition (RFC 6266): nome ASCII seguro e filename* em UTF-8. Vale para o download e para o upload dos PDFs.
export function attachment(filename: string): string {
  const ascii = filename.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_').trim() || 'arquivo.pdf'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const xmlText = (xml: string, tag: string) =>
  (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '').replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => entities[name])

// Lista o bucket (ListObjectsV2, 1000 por página) pelo endereço pré-assinado. Para em `maxPages` páginas e avisa.
export async function listObjects(config: B2Config, maxPages = 5): Promise<{ objects: StoredObject[]; truncated: boolean }> {
  const objects: StoredObject[] = []
  let token = ''
  for (let page = 0; page < maxPages; page++) {
    const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) }
    const { url } = await presignUrl(config, { method: 'GET', key: '', expiresIn: 60, query })
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    const xml = await response.text()
    if (!response.ok) throw new Error(`B2 LIST falhou (HTTP ${response.status})`)
    for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      objects.push({ key: xmlText(item, 'Key'), size: Number(xmlText(item, 'Size')), lastModified: xmlText(item, 'LastModified') })
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(xml, 'NextContinuationToken') : ''
    if (!token) return { objects, truncated: false }
  }
  return { objects, truncated: true }
}

// Apaga um objeto de vez. O B2 guarda versões: um DELETE sem versão só esconderia o arquivo (e ele seguiria cobrado),
// então apaga versão por versão (HEAD dá a atual) até o arquivo não existir mais. Já ausente conta como feito.
export async function deleteObject(config: B2Config, key: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const head = await fetch((await presignUrl(config, { method: 'HEAD', key, expiresIn: 60 })).url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) })
    await head.body?.cancel()
    if (head.status === 404) return
    if (!head.ok) throw new Error(`B2 HEAD falhou (HTTP ${head.status})`)
    const versionId = head.headers.get('x-amz-version-id')
    const { url } = await presignUrl(config, { method: 'DELETE', key, expiresIn: 60, query: versionId ? { versionId } : undefined })
    const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(20_000) })
    await response.body?.cancel()
    if (!response.ok) throw new Error(`B2 DELETE falhou (HTTP ${response.status})`)
    if (!versionId) return
  }
  throw new Error('B2: o arquivo ainda existe depois de 10 versões apagadas')
}

// Grava um objeto pelo endereço pré-assinado (PUT de 60 s). O Content-Type vai junto, fora da assinatura.
export async function putObject(config: B2Config, key: string, body: Uint8Array, contentType: string): Promise<void> {
  const { url } = await presignUrl(config, { method: 'PUT', key, expiresIn: 60 })
  const response = await fetch(url, { method: 'PUT', body: toBuffer(body), headers: { 'Content-Type': contentType }, signal: AbortSignal.timeout(20_000) })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`B2 PUT falhou (HTTP ${response.status})`)
}
