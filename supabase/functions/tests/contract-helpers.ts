import { handleRequest } from '../api/router.ts'

// Ambiente dos testes de contrato: sem rede e sem banco. As sessões são JWT ES256 assinados aqui,
// com o JWKS servido pelo fetch simulado; RPCs e preços da Stripe também são simulados.
// Com KT_INTEGRATION=1 este módulo fica inerte (não grava env nem troca o fetch) e os testes de contrato são
// ignorados: env e fetch valem para o processo inteiro, e as integrações do mesmo processo usariam os fictícios.
const integrationMode = Deno.env.get('KT_INTEGRATION') === '1'

const SUPABASE_URL = 'http://supabase.teste'
export const SECRET_KEY = 'chave-secreta-de-teste'
export const WEBHOOK_SECRET = 'segredo-webhook-de-teste'
export const TERMS_VERSION = 'termos-teste-1'
export const LINK_SECRET = 'segredo-dos-links-de-teste'
const MAILPIT_URL = 'http://mailpit.teste'
export const BREVO_WEBHOOK_SECRET = 'segredo-webhook-brevo-teste'

const contractEnv: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'chave-publica-de-teste' }),
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET_KEY }),
  STRIPE_SECRET_KEY: 'stripe-chave-de-teste',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  SITE_URL: 'http://127.0.0.1:5176',
  ADMIN_URL: 'http://127.0.0.1:5179',
  TERMS_VERSION,
  ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
  // I4: B2, links HMAC e e-mail (valores fictícios).
  B2_ENDPOINT: 's3.teste-001.backblazeb2.com',
  B2_REGION: 'teste-001',
  B2_BUCKET: 'bucket-de-teste',
  B2_READ_KEY_ID: 'chave-leitura-teste',
  B2_READ_APPLICATION_KEY: 'segredo-leitura-teste',
  // Blog: bucket público das imagens, com a chave de escrita só dele.
  B2_BLOG_BUCKET: 'blog-de-teste',
  B2_BLOG_KEY_ID: 'chave-blog-teste',
  B2_BLOG_APPLICATION_KEY: 'segredo-blog-teste',
  EMAIL_LINK_SECRET: LINK_SECRET,
  API_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1/api',
  EMAIL_FROM: 'acesso@example.com',
  EMAIL_FROM_NAME: 'KeyToTwo',
  EMAIL_LOG_MAILPIT_URL: MAILPIT_URL,
  // I5: webhook da Brevo.
  BREVO_WEBHOOK_SECRET,
}
if (!integrationMode) for (const [name, value] of Object.entries(contractEnv)) Deno.env.set(name, value)

// Teste de contrato: ignorado no modo de integração (ver acima).
export function contractTest(name: string, fn: () => void | Promise<void>): void {
  Deno.test({ name, ignore: integrationMode, fn })
}

const KID = 'chave-teste'
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: KID, alg: 'ES256', use: 'sig' }

const encoder = new TextEncoder()
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

export async function sessionToken(claims: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID })))
  const payload = base64url(encoder.encode(JSON.stringify({
    sub: crypto.randomUUID(), role: 'authenticated', aud: 'authenticated', email: 'teste@example.com',
    iat: now, exp: now + 600, is_anonymous: false, ...claims,
  })))
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(`${header}.${payload}`))
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
}

export function userId(token: string): string {
  return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub
}

// Adultera um token <payload>.<assinatura> de forma determinística: troca um caractere do meio da
// assinatura por outro diferente dele, o que muda os bytes decodificados e derruba o HMAC sempre.
// (Mexer nos últimos caracteres, como `${token.slice(0, -2)}AA`, nem sempre invalida: quando o
// penúltimo já é 'A' e o último carrega 4 bits significativos já zerados, o token "adulterado"
// decodifica igual e continua válido — era a causa de flake no CI, resposta 200 em vez de 400.)
export function tampered(token: string): string {
  const dot = token.lastIndexOf('.')
  const signature = token.slice(dot + 1)
  const i = signature.length >> 1
  return `${token.slice(0, dot + 1)}${signature.slice(0, i)}${signature[i] === 'A' ? 'B' : 'A'}${signature.slice(i + 1)}`
}

interface RpcCall {
  fn: string
  args: Record<string, unknown>
  secretKeyOk: boolean
  hasAuthorization: boolean
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> }

// Respostas simuladas: um corpo qualquer, ou a lista de uma linha das RPCs "returns table".
export const ok = (body: unknown): Reply => ({ status: 200, body })
export const row = (body: Record<string, unknown>) => ok([body])
export const rpcCalls: RpcCall[] = []
let rpcReply: (fn: string, args: Record<string, unknown>) => Reply = () => ({ status: 200, body: null })
let priceReply: (id: string) => Reply = () => ({ status: 404, body: {} })

export function onRpc(reply: (fn: string, args: Record<string, unknown>) => Reply) {
  rpcCalls.length = 0
  rpcReply = reply
}

export function onPrice(reply: (id: string) => Reply) {
  priceReply = reply
}

// Chamadas à API da Stripe (fora de /v1/prices): método, caminho, parâmetros (form ou query) e chave de idempotência.
export interface StripeCall {
  method: string
  path: string
  params: URLSearchParams
  idempotencyKey: string | null
}

export const stripeCalls: StripeCall[] = []
let stripeReply: (call: StripeCall) => Reply = () => ({ status: 404, body: { error: { type: 'invalid_request_error', code: 'resource_missing' } } })

export function onStripe(reply: (call: StripeCall) => Reply) {
  stripeCalls.length = 0
  stripeReply = reply
}

// Auth admin (exclusão de conta e bloqueio): método, id do usuário, se veio com a chave secreta e o corpo, quando há.
interface AuthAdminCall {
  method: string
  userId: string
  secretKeyOk: boolean
  body?: unknown
}

export const authAdminCalls: AuthAdminCall[] = []
let authAdminReply: (call: AuthAdminCall) => Reply = () => ({ status: 200, body: {} })

export function onAuthAdmin(reply: (call: AuthAdminCall) => Reply) {
  authAdminCalls.length = 0
  authAdminReply = reply
}

// Outros serviços externos (Brevo, Mailpit): URL, corpo JSON e headers.
interface ExternalCall {
  url: string
  body: Record<string, unknown>
  headers: Headers
}

export const externalCalls: ExternalCall[] = []
let externalReply: (call: ExternalCall) => Reply = () => ({ status: 500, body: {} })

export function onExternal(reply: (call: ExternalCall) => Reply) {
  externalCalls.length = 0
  externalReply = reply
}

// Chamadas ao B2 (imagens do blog): método, host, chave, query, tipo e tamanho. Corpo em texto responde como XML;
// HEAD, 204 e corpo null respondem sem corpo, com os headers da resposta simulada (x-amz-version-id, por exemplo).
interface B2Call {
  method: string
  host: string
  key: string
  query: URLSearchParams
  contentType: string | null
  size: number
}

export const b2Calls: B2Call[] = []
let b2Reply: (call: B2Call) => Reply = () => ({ status: 200, body: {} })

export function onB2(reply: (call: B2Call) => Reply) {
  b2Calls.length = 0
  b2Reply = reply
}

const respond = ({ status, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const contractFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (url.href === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) {
    return Promise.resolve(respond({ status: 200, body: { keys: [publicJwk] } }))
  }
  const rpcMatch = url.href.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`) ? url.pathname.split('/').pop()! : null
  if (rpcMatch) {
    const headers = new Headers(init?.headers)
    const args = JSON.parse(String(init?.body ?? '{}'))
    rpcCalls.push({ fn: rpcMatch, args, secretKeyOk: headers.get('apikey') === SECRET_KEY, hasAuthorization: headers.has('Authorization') })
    return Promise.resolve(respond(rpcReply(rpcMatch, args)))
  }
  if (url.href.startsWith(`${SUPABASE_URL}/auth/v1/admin/users/`)) {
    const headers = new Headers(init?.headers)
    const call: AuthAdminCall = { method: (init?.method ?? 'GET').toUpperCase(), userId: decodeURIComponent(url.pathname.split('/').pop()!), secretKeyOk: headers.get('apikey') === SECRET_KEY }
    if (typeof init?.body === 'string') call.body = JSON.parse(init.body)
    authAdminCalls.push(call)
    return Promise.resolve(respond(authAdminReply(call)))
  }
  // Ler um Price (prices.ts, sem o SDK) é o onPrice; criar e arquivar passam pelo onStripe, como o resto da Stripe.
  if (url.origin === 'https://api.stripe.com' && url.pathname.startsWith('/v1/prices/') && (init?.method ?? 'GET').toUpperCase() === 'GET') {
    return Promise.resolve(respond(priceReply(decodeURIComponent(url.pathname.slice('/v1/prices/'.length)))))
  }
  if (url.origin === 'https://api.stripe.com') {
    const headers = new Headers(init?.headers)
    const method = (init?.method ?? 'GET').toUpperCase()
    const params = method === 'GET' ? url.searchParams : new URLSearchParams(String(init?.body ?? ''))
    const call = { method, path: url.pathname, params, idempotencyKey: headers.get('Idempotency-Key') }
    stripeCalls.push(call)
    return Promise.resolve(respond(stripeReply(call)))
  }
  if (url.origin === 'https://api.brevo.com' || url.origin === MAILPIT_URL) {
    const call = { url: url.href, body: JSON.parse(String(init?.body ?? '{}')), headers: new Headers(init?.headers) }
    externalCalls.push(call)
    return Promise.resolve(respond(externalReply(call)))
  }
  if (url.hostname.endsWith('.backblazeb2.com')) {
    const body = init?.body
    const size = body instanceof ArrayBuffer ? body.byteLength : body instanceof Uint8Array ? body.byteLength : 0
    const call = { method: (init?.method ?? 'GET').toUpperCase(), host: url.hostname, key: decodeURIComponent(url.pathname.slice(1)), query: url.searchParams, contentType: new Headers(init?.headers).get('Content-Type'), size }
    b2Calls.push(call)
    const reply = b2Reply(call)
    const empty = call.method === 'HEAD' || reply.status === 204 || reply.body === null
    const text = typeof reply.body === 'string'
    return Promise.resolve(new Response(empty ? null : text ? String(reply.body) : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': text ? 'application/xml' : 'application/json', ...reply.headers },
    }))
  }
  return Promise.reject(new Error(`fetch não simulado: ${url.origin}${url.pathname}`))
}
if (!integrationMode) globalThis.fetch = contractFetch

export function request(path: string, options: { method?: string; token?: string; body?: unknown; headers?: HeadersInit } = {}): Request {
  const headers = new Headers(options.headers)
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  return new Request(`http://localhost/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

// email-dispatch: o claim devolve estas linhas e cada mark_email_result é aceito.
export function dispatchRpc(rows: unknown[]) {
  onRpc((fn) => (fn === 'claim_email_batch' ? ok(rows) : row({ outcome: 'applied', status: 'sent', next_attempt_at: null })))
}

// Rotas de admin: sessão com o segundo fator e a resposta já lida.
export const adminToken = () => sessionToken({ aal: 'aal2' })
export async function send(path: string, options: { method?: string; token?: string; body?: unknown; headers?: HeadersInit }) {
  const res = await handleRequest(request(path, options))
  return { status: res.status, headers: res.headers, body: await res.json() }
}

// Erros esperados (500 simulados) não poluem a saída; os testes conferem o conteúdo do log.
export async function captureErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const original = console.error
  const logs: string[] = []
  console.error = (...args: unknown[]) => logs.push(args.join(' '))
  try {
    return { result: await fn(), logs }
  } finally {
    console.error = original
  }
}
