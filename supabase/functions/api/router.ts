import { allowedOrigin, preflight, withCors } from '../_shared/cors.ts'
import { errorResponse, HttpError, json, toErrorResponse } from '../_shared/http.ts'
import { deleteAccount, exportAccount, getAccount, markPrompt, putMarketing } from './routes/account.ts'
import { adminMetrics } from './routes/admin.ts'
import { adminBlockUser, adminDeleteUser, adminExportUser, adminFollowUp, adminGiftProduct, adminNewsletterOff, adminResendDelivery, adminRevokeEntitlement, adminSetAdmin, adminUnblockUser, adminUser, adminUsers } from './routes/users.ts'
import { adminBlogImage, adminBlogImages, adminBlogPost, adminBlogPosts, adminCreateBlogPost, adminDeleteBlogImage, adminDeleteBlogPost, adminUpdateBlogPost, blogPublished, blogVersion } from './routes/blog.ts'
import { addCartItem, getCart, mergeCart, quoteCart, removeCartItem } from './routes/cart.ts'
import { catalog } from './routes/catalog.ts'
import { checkout } from './routes/checkout.ts'
import { deliveryLink, downloadUrl } from './routes/downloads.ts'
import { freeDownload, freeGames } from './routes/free.ts'
import { orderStatus } from './routes/order-status.ts'
import { unsubscribe, unsubscribePage } from './routes/unsubscribe.ts'
import { library } from './routes/library.ts'

type Params = Record<string, string>
type Handler = (req: Request, url: URL, params: Params) => Response | Promise<Response>
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface Route {
  pattern: RegExp
  keys: string[]
  methods: Partial<Record<Method, Handler>>
}

// ':nome' captura um segmento do caminho.
function route(path: string, methods: Partial<Record<Method, Handler>>): Route {
  const keys: string[] = []
  const source = path.replace(/:([a-z_]+)/g, (_, key: string) => {
    keys.push(key)
    return '([^/]+)'
  })
  return { pattern: new RegExp(`^${source}$`), keys, methods }
}

// Rotas de docs/api-contract.md, entrando a cada incremento.
const routes: Route[] = [
  route('/health', { GET: () => json({ status: 'ok', service: 'api' }) }),
  route('/catalog', { GET: catalog }),
  route('/cart', { GET: getCart }),
  route('/cart/items', { POST: addCartItem }),
  route('/cart/items/:code', { DELETE: removeCartItem }),
  route('/cart/quote', { POST: quoteCart }),
  route('/cart/merge', { POST: mergeCart }),
  route('/account', { GET: getAccount }),
  route('/account/marketing', { PUT: putMarketing }),
  route('/account/marketing/prompt', { POST: markPrompt }),
  route('/account/export', { GET: exportAccount }),
  route('/account/delete', { POST: deleteAccount }),
  route('/library', { GET: library }),
  route('/checkout', { POST: checkout }),
  route('/order-status', { GET: orderStatus }),
  route('/download-url', { POST: downloadUrl }),
  route('/d/:token', { GET: deliveryLink }),
  route('/free-games', { GET: freeGames }),
  route('/free-download', { POST: freeDownload }),
  route('/email/unsubscribe', { GET: unsubscribePage, POST: unsubscribe }),
  route('/admin/metrics', { GET: adminMetrics }),
  route('/admin/blog/posts', { GET: adminBlogPosts, POST: adminCreateBlogPost }),
  route('/admin/blog/posts/:id', { GET: adminBlogPost, PUT: adminUpdateBlogPost, DELETE: adminDeleteBlogPost }),
  route('/admin/blog/images', { GET: adminBlogImages, POST: adminBlogImage, DELETE: adminDeleteBlogImage }),
  route('/admin/users', { GET: adminUsers }),
  route('/admin/users/:id', { GET: adminUser }),
  route('/admin/users/:id/gifts', { POST: adminGiftProduct }),
  route('/admin/users/:id/entitlements/:entitlement/revoke', { POST: adminRevokeEntitlement }),
  route('/admin/users/:id/orders/:order/resend', { POST: adminResendDelivery }),
  route('/admin/users/:id/newsletter/off', { POST: adminNewsletterOff }),
  route('/admin/users/:id/block', { POST: adminBlockUser }),
  route('/admin/users/:id/unblock', { POST: adminUnblockUser }),
  route('/admin/users/:id/export', { GET: adminExportUser }),
  route('/admin/users/:id/delete', { POST: adminDeleteUser }),
  route('/admin/users/:id/admin', { POST: adminSetAdmin }),
  route('/admin/follow-up', { GET: adminFollowUp }),
  route('/blog/posts', { GET: blogPublished }),
  route('/blog/version', { GET: blogVersion }),
]

// Local e na nuvem o caminho chega como /api/<rota>; aceita também o prefixo /functions/v1.
function routePath(url: URL): string {
  const path = url.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, '').replace(/\/+$/, '')
  return path || '/'
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Caminho inválido.')
  }
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = routePath(url)
  for (const { pattern, keys, methods } of routes) {
    const match = pattern.exec(path)
    if (!match) continue
    const handler = Object.hasOwn(methods, req.method) ? methods[req.method as Method] : undefined
    if (!handler) {
      const allow = [...Object.keys(methods), 'OPTIONS'].join(', ')
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', { headers: { Allow: allow } })
    }
    const params = Object.fromEntries(keys.map((key, index) => [key, decode(match[index + 1])]))
    return await handler(req, url, params)
  }
  throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.')
}

export async function handleRequest(req: Request): Promise<Response> {
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
}
