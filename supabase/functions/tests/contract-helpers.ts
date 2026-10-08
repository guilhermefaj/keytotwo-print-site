// Ambiente dos testes de contrato: sem rede e sem banco. As sessões são JWT ES256 assinados aqui,
// com o JWKS servido pelo fetch simulado; RPCs e preços da Stripe também são simulados.
export const SUPABASE_URL = 'http://supabase.teste'
export const SECRET_KEY = 'chave-secreta-de-teste'

Deno.env.set('SUPABASE_URL', SUPABASE_URL)
Deno.env.set('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'chave-publica-de-teste' }))
Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: SECRET_KEY }))
Deno.env.set('STRIPE_SECRET_KEY', 'stripe-chave-de-teste')
export const WEBHOOK_SECRET = 'segredo-webhook-de-teste'
Deno.env.set('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET)
Deno.env.set('SITE_URL', 'http://127.0.0.1:5176')
export const TERMS_VERSION = 'termos-teste-1'
Deno.env.set('TERMS_VERSION', TERMS_VERSION)
Deno.env.set('ALLOWED_ORIGINS', 'http://127.0.0.1:5173')
// I4: B2, links HMAC e e-mail (valores fictícios).
Deno.env.set('B2_ENDPOINT', 's3.teste-001.backblazeb2.com')
Deno.env.set('B2_REGION', 'teste-001')
Deno.env.set('B2_BUCKET', 'bucket-de-teste')
Deno.env.set('B2_READ_KEY_ID', 'chave-leitura-teste')
Deno.env.set('B2_READ_APPLICATION_KEY', 'segredo-leitura-teste')
export const LINK_SECRET = 'segredo-dos-links-de-teste'
Deno.env.set('EMAIL_LINK_SECRET', LINK_SECRET)
Deno.env.set('API_PUBLIC_URL', 'http://127.0.0.1:54321/functions/v1/api')
Deno.env.set('EMAIL_FROM', 'acesso@example.com')
Deno.env.set('EMAIL_FROM_NAME', 'KeyToTwo')
export const MAILPIT_URL = 'http://mailpit.teste'
Deno.env.set('EMAIL_LOG_MAILPIT_URL', MAILPIT_URL)
// I5: webhook da Brevo.
export const BREVO_WEBHOOK_SECRET = 'segredo-webhook-brevo-teste'
Deno.env.set('BREVO_WEBHOOK_SECRET', BREVO_WEBHOOK_SECRET)

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

export interface RpcCall {
  fn: string
  args: Record<string, unknown>
  secretKeyOk: boolean
  hasAuthorization: boolean
}

type Reply = { status: number; body: unknown }
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

// Outros serviços externos (Brevo, Mailpit): URL, corpo JSON e headers.
export interface ExternalCall {
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

const respond = ({ status, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
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
  if (url.origin === 'https://api.stripe.com' && url.pathname.startsWith('/v1/prices/')) {
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
  return Promise.reject(new Error(`fetch não simulado: ${url.origin}${url.pathname}`))
}

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
