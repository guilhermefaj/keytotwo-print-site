import { rpc } from './admin.ts'
import { runInBackground } from './background.ts'
import { env } from './env.ts'
import { errorLabel } from './http.ts'
import { STRIPE_BASE_API_VERSION } from './stripe.ts'

// Leitura de Price direto na API (sem o SDK), na versão base do projeto (docs/api-contract.md 6.5.1).
const TTL_MS = 5 * 60_000
// O valor e a moeda de um Price nunca mudam na Stripe; só o "ativo" muda. Guardado no banco, ele é conferido de novo
// em segundo plano depois de uma hora (data-contract 6.13).
const STORED_TTL_MS = 60 * 60_000
const TIMEOUT_MS = 5_000

export interface Price {
  unit_amount: number
  currency: string
}

interface Entry {
  price: Price | null
  product: string | null
}

// Linha de private.stripe_prices (get_stripe_prices / remember_stripe_prices).
interface Stored {
  price_id: string
  unit_amount: number
  currency: string
  product: string | null
  active: boolean
  fetched_at?: string
}

const cache = new Map<string, Entry & { at: number }>()
const fresh = (hit: { at: number } | undefined) => Boolean(hit && Date.now() - hit.at < TTL_MS)
const entryOf = (row: Stored): Entry => ({ price: row.active ? { unit_amount: Number(row.unit_amount), currency: row.currency } : null, product: row.product })

// Lê o Price na Stripe. 404: price null; falha transitória: undefined (quem chamou mantém o que tinha).
async function fromStripe(priceId: string): Promise<{ entry: Entry; stored: Stored | null } | undefined> {
  const key = env.stripeSecretKey()
  if (!key) return { entry: { price: null, product: null }, stored: null }
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_BASE_API_VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404) return { entry: { price: null, product: null }, stored: null }
    if (!response.ok) {
      console.error(`stripe: preço não lido (HTTP ${response.status})`)
      return undefined
    }
    const body = await response.json()
    const product = typeof body.product === 'string' ? body.product : null
    if (!Number.isInteger(body.unit_amount) || typeof body.currency !== 'string') return { entry: { price: null, product }, stored: null }
    const stored = { price_id: priceId, unit_amount: body.unit_amount as number, currency: body.currency as string, product, active: body.active === true }
    return { entry: entryOf(stored), stored }
  } catch (error) {
    console.error(`stripe: preço não lido (${errorLabel(error)})`)
    return undefined
  }
}

// Confere na Stripe e guarda no banco e na memória.
async function refresh(ids: string[]): Promise<void> {
  const results = await Promise.all(ids.map(async (id) => [id, await fromStripe(id)] as const))
  const stored: Stored[] = []
  for (const [id, result] of results) {
    if (!result) continue
    cache.set(id, { ...result.entry, at: Date.now() })
    if (result.stored) stored.push(result.stored)
  }
  if (stored.length) await rpc('remember_stripe_prices', { p_prices: stored })
}

// Carrega de uma vez os Prices que a rota vai usar: primeiro do banco; o que falta vem da Stripe (e fica guardado);
// o que está guardado há mais de uma hora é conferido de novo em segundo plano. Banco fora do ar: vai direto à Stripe.
export async function primePrices(ids: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))].filter((id) => !fresh(cache.get(id)))
  if (!wanted.length) return
  let rows: Stored[] = []
  try {
    const result = await rpc<Stored[] | null>('get_stripe_prices', { p_price_ids: wanted })
    if (Array.isArray(result)) rows = result
  } catch (error) {
    console.error(`stripe: preços guardados não lidos (${errorLabel(error)})`)
  }
  const missing: string[] = []
  const stale: string[] = []
  for (const id of wanted) {
    const row = rows.find((item) => item.price_id === id)
    if (!row) { missing.push(id); continue }
    cache.set(id, { ...entryOf(row), at: Date.now() })
    if (!row.fetched_at || Date.now() - Date.parse(row.fetched_at) > STORED_TTL_MS) stale.push(id)
  }
  if (stale.length) runInBackground('prices', () => refresh(stale))
  if (missing.length) {
    try { await refresh(missing) } catch (error) {
      console.error(`stripe: preços não guardados (${errorLabel(error)})`)
    }
  }
}

async function load(priceId: string): Promise<Entry> {
  const hit = cache.get(priceId)
  if (fresh(hit)) return hit!
  await primePrices([priceId])
  return cache.get(priceId) ?? hit ?? { price: null, product: null }
}

// Preço exibido; o cobrado é sempre o da sessão do Checkout.
export async function stripePrice(priceId: string): Promise<Price | null> {
  return (await load(priceId)).price
}

// Produto da Stripe do Price: o pacote de "completar a coleção" é cobrado com price_data nesse produto.
export async function stripePriceProduct(priceId: string): Promise<string | null> {
  return (await load(priceId)).product
}
