import { type Price, stripePrice } from './prices.ts'

// Item da sacola como as RPCs devolvem (private.cart_lines, docs/data-contract.md 6.2).
export interface CartLine {
  code: string
  kind: string
  name: string | null
  stripe_price_id: string | null
  games: { code: string; name: string; single_price_id: string | null }[]
  status: 'ok' | 'unavailable' | 'already_owned' | 'included'
  available: boolean
  owned_games: string[]
  included_in: string[]
  shared_with: string[]
}

// O que sai na API: sem os ids de Price da Stripe. price é o valor de tabela; charge é o que será cobrado
// (só nos itens com status ok; menor que price no pacote de "completar a coleção").
export type PricedLine = Omit<CartLine, 'stripe_price_id' | 'games'> & {
  games: { code: string; name: string }[]
  price: Price | null
  charge: Price | null
}

// "Completar a coleção" (Steam): o pacote cobra só os jogos que faltam, com o mesmo desconto do pacote sobre os
// avulsos. Sem o preço avulso de todos os jogos, o desconto é proporcional ao número de jogos.
export function bundleCharge(price: Price, games: { code: string; single: Price | null }[], owned: string[]): number {
  const missing = games.filter((game) => !owned.includes(game.code))
  if (!games.length || missing.length === games.length) return price.unit_amount
  const singles = games.map((game) => game.single)
  if (singles.every((single) => single && single.currency === price.currency)) {
    const total = singles.reduce((sum, single) => sum + single!.unit_amount, 0)
    const remaining = missing.reduce((sum, game) => sum + game.single!.unit_amount, 0)
    if (total > 0) return Math.round((price.unit_amount * remaining) / total)
  }
  return Math.round((price.unit_amount * missing.length) / games.length)
}

// Item que vai para o pedido, como create_order_from_cart devolve.
export type ChargeableItem = Pick<CartLine, 'kind' | 'games' | 'owned_games'> & { stripe_price_id: string }

async function charged(price: Price, item: Pick<CartLine, 'kind' | 'games' | 'owned_games'>): Promise<Price> {
  if (item.kind !== 'bundle' || !item.owned_games.length) return price
  const games = await Promise.all(item.games.map(async (game) => ({
    code: game.code,
    single: game.single_price_id ? await stripePrice(game.single_price_id) : null,
  })))
  return { unit_amount: bundleCharge(price, games, item.owned_games), currency: price.currency }
}

// Valor de tabela e valor cobrado de um item da sacola. Erro da Stripe vira price/charge null (o site não deixa seguir).
export async function priceLine(line: CartLine): Promise<{ price: Price | null; charge: Price | null }> {
  const price = line.stripe_price_id ? await stripePrice(line.stripe_price_id) : null
  if (line.status !== 'ok' || !price) return { price, charge: null }
  return { price, charge: await charged(price, line) }
}

// Valor cobrado de um item do pedido; null se a Stripe não respondeu (o checkout recusa).
export async function orderItemCharge(item: ChargeableItem): Promise<Price | null> {
  const price = await stripePrice(item.stripe_price_id)
  return price ? await charged(price, item) : null
}

export async function priceLines(lines: CartLine[]): Promise<PricedLine[]> {
  return await Promise.all(lines.map(async ({ stripe_price_id, games, ...line }) => ({
    ...line,
    games: games.map(({ code, name }) => ({ code, name })),
    ...(await priceLine({ ...line, stripe_price_id, games })),
  })))
}

// Soma do que será cobrado: null sem item a pagar ou com preço de item ok faltando (o site não deixa seguir).
export function subtotal(items: PricedLine[]): { amount: number; currency: string } | null {
  const paid = items.filter((item) => item.status === 'ok')
  if (!paid.length || paid.some((item) => !item.charge)) return null
  const currency = paid[0].charge!.currency
  if (paid.some((item) => item.charge!.currency !== currency)) return null
  return { amount: paid.reduce((sum, item) => sum + item.charge!.unit_amount, 0), currency }
}

export function warnings(items: PricedLine[]) {
  const list: { code: string; product_code: string }[] = []
  const paid = new Set(items.filter((item) => item.status === 'ok').map((item) => item.code))
  for (const item of items) {
    if (item.status === 'unavailable') list.push({ code: 'PRODUCT_UNAVAILABLE', product_code: item.code })
    if (item.status === 'already_owned') list.push({ code: 'ALREADY_OWNED', product_code: item.code })
    if (item.status === 'included') list.push({ code: 'INCLUDED_IN_BUNDLE', product_code: item.code })
    if (item.status !== 'ok') continue
    if (item.owned_games.length) list.push({ code: 'COMPLETE_THE_SET', product_code: item.code })
    if (item.shared_with.some((code) => paid.has(code))) list.push({ code: 'PARTIAL_OVERLAP', product_code: item.code })
    if (!item.price) list.push({ code: 'PRICE_UNAVAILABLE', product_code: item.code })
  }
  return list
}
