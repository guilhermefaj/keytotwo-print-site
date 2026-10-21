import { env } from './env.ts'

// Versão base da API Stripe do projeto (docs/api-contract.md 6.5.1). Só leitura de Price aqui; o SDK entra no I3.
const STRIPE_API_VERSION = '2026-03-25.dahlia'
const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 5_000

export interface Price {
  unit_amount: number
  currency: string
}

interface Entry {
  price: Price | null
  product: string | null
}

const cache = new Map<string, Entry & { at: number }>()

// Lê o Price na Stripe, com cache. Sem chave, Price inativo ou Stripe fora do ar: price null.
// Falha transitória devolve o último valor em cache.
async function load(priceId: string): Promise<Entry> {
  const hit = cache.get(priceId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit
  const key = env.stripeSecretKey()
  if (!key) return { price: null, product: null }
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404) {
      cache.set(priceId, { price: null, product: null, at: Date.now() })
      return { price: null, product: null }
    }
    if (!response.ok) {
      console.error(`stripe: preço não lido (HTTP ${response.status})`)
      return hit ?? { price: null, product: null }
    }
    const body = await response.json()
    const price = body.active === true && Number.isInteger(body.unit_amount) && typeof body.currency === 'string'
      ? { unit_amount: body.unit_amount as number, currency: body.currency as string }
      : null
    const product = typeof body.product === 'string' ? body.product : null
    cache.set(priceId, { price, product, at: Date.now() })
    return { price, product }
  } catch (error) {
    console.error(`stripe: preço não lido (${error instanceof Error ? error.name : 'erro'})`)
    return hit ?? { price: null, product: null }
  }
}

// Preço exibido, lido do Price da Stripe; o cobrado é sempre o da sessão do Checkout.
export async function stripePrice(priceId: string): Promise<Price | null> {
  return (await load(priceId)).price
}

// Produto da Stripe do Price: o pacote de "completar a coleção" é cobrado com price_data nesse produto.
export async function stripePriceProduct(priceId: string): Promise<string | null> {
  return (await load(priceId)).product
}
