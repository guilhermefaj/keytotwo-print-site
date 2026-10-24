import { rpc } from '../../_shared/admin.ts'
import { json } from '../../_shared/http.ts'
import { primePrices, stripePrice } from '../../_shared/prices.ts'

interface CatalogProduct {
  code: string
  kind: string
  name: string | null
  stripe_price_id: string | null
  list_price: { amount: number; label: string } | null
  games: { code: string; name: string }[]
}

// GET /catalog (pública): produtos vendáveis com o preço lido da Stripe e o riscado da promoção. O stripe_price_id
// não sai da API.
export async function catalog(): Promise<Response> {
  const products = (await rpc<CatalogProduct[] | null>('get_catalog')) ?? []
  await primePrices(products.map((product) => product.stripe_price_id))
  const withPrices = await Promise.all(products.map(async ({ stripe_price_id, ...product }) => ({
    ...product,
    price: stripe_price_id ? await stripePrice(stripe_price_id) : null,
  })))
  return json({ products: withPrices }, 200, { 'Cache-Control': 'public, max-age=60' })
}
