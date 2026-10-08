import { env } from './env.ts'

// Versão base da API Stripe do projeto (docs/api-contract.md 6.5.1). Só leitura de Price aqui; o SDK entra no I3.
const STRIPE_API_VERSION = '2026-03-25.dahlia'
const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 5_000

export interface Price {
  unit_amount: number
  currency: string
}

const cache = new Map<string, { price: Price | null; at: number }>()

// Preço exibido, lido do Price da Stripe; o cobrado é sempre o da sessão do Checkout.
// Sem chave, Price inativo ou Stripe fora do ar: null. Falha transitória devolve o último valor em cache.
export async function stripePrice(priceId: string): Promise<Price | null> {
  const hit = cache.get(priceId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price
  const key = env.stripeSecretKey()
  if (!key) return null
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404) {
      cache.set(priceId, { price: null, at: Date.now() })
      return null
    }
    if (!response.ok) {
      console.error(`stripe: preço não lido (HTTP ${response.status})`)
      return hit?.price ?? null
    }
    const body = await response.json()
    const price = body.active === true && Number.isInteger(body.unit_amount) && typeof body.currency === 'string'
      ? { unit_amount: body.unit_amount as number, currency: body.currency as string }
      : null
    cache.set(priceId, { price, at: Date.now() })
    return price
  } catch (error) {
    console.error(`stripe: preço não lido (${error instanceof Error ? error.name : 'erro'})`)
    return hit?.price ?? null
  }
}
