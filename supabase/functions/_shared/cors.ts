import { env } from './env.ts'

const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info'
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS'

// Devolve o Origin da requisição quando ele está em ALLOWED_ORIGINS; senão null.
export function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get('Origin')
  return origin && env.allowedOrigins().includes(origin) ? origin : null
}

// Sem origem permitida a resposta sai sem headers de CORS, e o navegador a bloqueia.
export function preflight(origin: string | null): Response {
  const headers = new Headers({ Vary: 'Origin' })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
    headers.set('Access-Control-Max-Age', '600')
  }
  return new Response(null, { status: 204, headers })
}

export function withCors(response: Response, origin: string | null): Response {
  response.headers.append('Vary', 'Origin')
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin)
  return response
}
