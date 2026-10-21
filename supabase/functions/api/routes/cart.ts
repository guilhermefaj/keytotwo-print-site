import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { type CartLine, priceLines, subtotal, warnings } from '../../_shared/cart-pricing.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'

// Mesmo formato do CHECK de products.code (data-contract 2.2).
const PRODUCT_CODE = /^[A-Z][A-Z0-9-]{1,23}$/
// A sacola guardada no navegador vai inteira na cotação e na junção (quote_cart aceita até 20).
const MAX_CODES = 20

interface Cart {
  version: number
  items: CartLine[]
  owned_products?: string[]
}

function productCode(value: unknown): string {
  if (typeof value !== 'string' || !PRODUCT_CODE.test(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Código de produto inválido.')
  }
  return value
}

function productCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CODES) {
    throw new HttpError(400, 'INVALID_REQUEST', `Envie até ${MAX_CODES} códigos de produto.`)
  }
  return [...new Set(value.map(productCode))]
}

async function pricedCart(cart: Cart) {
  const items = await priceLines(cart.items)
  return { version: cart.version, items, subtotal: subtotal(items), warnings: warnings(items) }
}

async function cartResponse(userId: string): Promise<Response> {
  const cart = (await rpc<Cart | null>('get_cart', { p_user_id: userId })) ?? { version: 0, items: [], owned_products: [] }
  return json({ ...(await pricedCart(cart)), owned_products: cart.owned_products ?? [] })
}

// GET /cart
export async function getCart(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  return cartResponse(user.id)
}

// POST /cart/items { product_code }. Produto já possuído entra e aparece riscado (status already_owned).
export async function addCartItem(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const code = productCode((await readJsonObject(req)).product_code)
  const result = await rpcRow<{ outcome: string }>('cart_add', { p_user_id: user.id, p_product_code: code })
  if (result.outcome === 'product_unavailable') {
    throw new HttpError(409, 'PRODUCT_UNAVAILABLE', 'Este produto não está disponível.', { details: { product_codes: [code] } })
  }
  return cartResponse(user.id)
}

// DELETE /cart/items/{code}
export async function removeCartItem(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireSessionUser(req)
  const code = productCode(params.code)
  await rpcRow<{ outcome: string }>('cart_remove', { p_user_id: user.id, p_product_code: code })
  return cartResponse(user.id)
}

// POST /cart/quote { product_codes } (pública): a sacola de quem ainda não entrou, com as mesmas regras e preços.
// unknown = códigos que não existem mais; o site tira da sacola guardada no navegador.
export async function quoteCart(req: Request): Promise<Response> {
  const codes = productCodes((await readJsonObject(req)).product_codes)
  const quote = await rpc<{ items: CartLine[]; unknown: string[] }>('quote_cart', { p_product_codes: codes })
  return json({ ...(await pricedCart({ version: 0, items: quote.items })), unknown: quote.unknown })
}

// POST /cart/merge { product_codes }: ao entrar, a sacola do navegador se junta à da conta, na mesma ordem.
// Produto que deixou de ser vendável fica de fora sem erro; o resto segue as regras de cart_add.
export async function mergeCart(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const codes = productCodes((await readJsonObject(req)).product_codes)
  for (const code of codes) await rpcRow('cart_add', { p_user_id: user.id, p_product_code: code })
  return cartResponse(user.id)
}
