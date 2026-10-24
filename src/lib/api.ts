import { apiBase, publishableKey, supabase } from './supabase'

type Price = { unit_amount: number; currency: string }
export type CatalogProduct = { code: string; kind: 'bundle' | 'single'; name: string; games: { code: string; name: string }[]; price: Price | null; list_price?: { amount: number; label: string } | null }
// status: ok (vai para o pedido), unavailable, already_owned (já está no Portal) e included (avulso que já está num
// pacote da sacola). price é o de tabela; charge, o que será cobrado (só no ok; menor no pacote de completar a coleção).
export type CartItem = CatalogProduct & { status: 'ok' | 'unavailable' | 'already_owned' | 'included'; available: boolean; owned_games: string[]; included_in: string[]; shared_with: string[]; charge: Price | null }
export type Cart = { version: number; items: CartItem[]; subtotal: { amount: number; currency: string } | null; warnings: { code: string; product_code: string }[]; owned_products?: string[]; unknown?: string[] }
export type Marketing = { opted_in: boolean; updated_at: string | null; text_version: string | null }
export type Account = { email: string; marketing: Marketing; free_games_unlocked?: boolean; orders: { ref: string; kind?: 'purchase' | 'courtesy'; created_at: string; paid_at: string | null; status: string; amount_total: number; currency: string; items: { code: string; name: string; unit_amount: number; currency: string }[] }[] }
export type Library = { games: { code: string; name: string; acquired_at: string; products: { code: string; name: string }[]; files: { id: string; kind: string; version: string; size_bytes: number }[] }[]; pending: { ref: string; created_at: string; products: { code: string; name: string }[] }[] }

export type CatalogResponse = { products: CatalogProduct[]; banner?: { code: string; text: string } | null }

export class ApiError extends Error {
  constructor(public code: string) { super(code) }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; public?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { apikey: publishableKey }
  let token: string | undefined
  if (!options.public) {
    const { data, error } = await supabase().auth.getSession()
    if (error || !data.session) throw new ApiError('UNAUTHENTICATED')
    token = data.session.access_token
    headers.Authorization = `Bearer ${token}`
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${apiBase}${path}`, { method: options.method || 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal })
  const result = await response.json()
  if (!response.ok) {
    if (response.status === 401 && token) {
      const { data } = await supabase().auth.getSession()
      if (data.session?.access_token === token) await supabase().auth.signOut({ scope: 'local' })
    }
    throw new ApiError(result.error?.code || 'INTERNAL_ERROR')
  }
  return result as T
}

export function apiErrorMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : ''
  if (code === 'UNAUTHENTICATED') return 'Sua sessão terminou. Entre novamente para continuar.'
  if (code === 'ALREADY_OWNED') return 'Tudo o que está na sacola já é seu ou já está num pacote dela.'
  if (code === 'CART_FULL') return 'A sacola aceita até 20 itens.'
  if (code === 'PRODUCT_UNAVAILABLE') return 'Este produto não está disponível para compra.'
  if (code === 'EMAIL_NOT_CONFIRMED') return 'Confirme seu e-mail para continuar.'
  return 'Não deu certo agora. Tente de novo em instantes.'
}

