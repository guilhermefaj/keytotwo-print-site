import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { type Price, stripePrice } from '../../_shared/prices.ts'

// Mesmo formato do CHECK de products.code (data-contract 2.2).
const PRODUCT_CODE = /^[A-Z][A-Z0-9-]{1,23}$/

interface CartItem {
  code: string
  kind: string
  name: string | null
  stripe_price_id: string | null
  games: { code: string; name: string }[]
  status: 'ok' | 'unavailable' | 'already_owned'
  available: boolean
  owned_games: string[]
  shared_with: string[]
}

interface Cart {
  version: number
  items: CartItem[]
}

type PricedItem = Omit<CartItem, 'stripe_price_id'> & { price: Price | null }

function productCode(value: unknown): string {
  if (typeof value !== 'string' || !PRODUCT_CODE.test(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Código de produto inválido.')
  }
  return value
}

function subtotal(items: PricedItem[]): { amount: number; currency: string } | null {
  const available = items.filter((item) => item.available)
  if (!available.length || available.some((item) => !item.price)) return null
  const currency = available[0].price!.currency
  if (available.some((item) => item.price!.currency !== currency)) return null
  return { amount: available.reduce((sum, item) => sum + item.price!.unit_amount, 0), currency }
}

function warnings(items: PricedItem[]) {
  const list: { code: string; product_code: string }[] = []
  for (const item of items) {
    if (item.status === 'unavailable') list.push({ code: 'PRODUCT_UNAVAILABLE', product_code: item.code })
    if (item.status === 'already_owned') list.push({ code: 'ALREADY_OWNED', product_code: item.code })
    if (item.status === 'ok' && (item.owned_games.length || item.shared_with.length)) {
      list.push({ code: 'PARTIAL_OVERLAP', product_code: item.code })
    }
    if (item.available && !item.price) list.push({ code: 'PRICE_UNAVAILABLE', product_code: item.code })
  }
  return list
}

async function cartResponse(userId: string): Promise<Response> {
  const cart = (await rpc<Cart | null>('get_cart', { p_user_id: userId })) ?? { version: 0, items: [] }
  const items: PricedItem[] = await Promise.all(cart.items.map(async ({ stripe_price_id, ...item }) => ({
    ...item,
    price: stripe_price_id ? await stripePrice(stripe_price_id) : null,
  })))
  return json({ version: cart.version, items, subtotal: subtotal(items), warnings: warnings(items) })
}

// GET /cart
export async function getCart(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  return cartResponse(user.id)
}

// POST /cart/items { product_code }
export async function addCartItem(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const code = productCode((await readJsonObject(req)).product_code)
  const result = await rpcRow<{ outcome: string }>('cart_add', { p_user_id: user.id, p_product_code: code })
  const details = { product_codes: [code] }
  if (result.outcome === 'already_owned') {
    throw new HttpError(409, 'ALREADY_OWNED', 'Você já tem todos os jogos deste produto.', { details })
  }
  if (result.outcome === 'product_unavailable') {
    throw new HttpError(409, 'PRODUCT_UNAVAILABLE', 'Este produto não está disponível.', { details })
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
