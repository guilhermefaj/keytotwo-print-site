import { allowedOrigin, preflight, withCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, toErrorResponse } from '../_shared/http.ts'

type Handler = (req: Request, url: URL) => Response | Promise<Response>
type Method = 'GET' | 'POST'

// Rotas de docs/api-contract.md, entrando a cada incremento.
const routes: Record<string, Partial<Record<Method, Handler>>> = {
  '/health': { GET: () => json({ status: 'ok', service: 'api' }) },
}

// Local e na nuvem o caminho chega como /api/<rota>; aceita também o prefixo /functions/v1.
function routePath(url: URL): string {
  const path = url.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, '').replace(/\/+$/, '')
  return path || '/'
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = routePath(url)
  const route = Object.hasOwn(routes, path) ? routes[path] : undefined
  if (!route) throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.')
  const handler = Object.hasOwn(route, req.method) ? route[req.method as Method] : undefined
  if (!handler) {
    const allow = [...Object.keys(route), 'OPTIONS'].join(', ')
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', { Allow: allow })
  }
  return await handler(req, url)
}

Deno.serve(async (req) => {
  let origin: string | null = null
  try {
    origin = allowedOrigin(req)
    if (req.method === 'OPTIONS') return preflight(origin)
    // Requisição sem Origin (curl, servidor) segue; de navegador, só das origens da lista.
    if (req.headers.has('Origin') && !origin) {
      return withCors(errorResponse(403, 'ORIGIN_NOT_ALLOWED', 'Origem não permitida.'), null)
    }
    return withCors(await handle(req), origin)
  } catch (error) {
    return withCors(toErrorResponse(error), origin)
  }
})
