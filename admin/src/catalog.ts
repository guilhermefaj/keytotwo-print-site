// Catálogo no admin (2026-10-24): o formato de GET /admin/catalog e os nomes que a tela mostra.
export interface CatalogGameRef { code: string; name: string; position: number }
export interface CatalogProduct {
  code: string
  name: string | null
  kind: 'single' | 'bundle'
  slug: string
  status: 'draft' | 'active' | 'archived'
  ready: boolean
  sellable: boolean
  stripe_price_id: string | null
  games_expected: number | null
  price: { unit_amount: number; currency: string } | null
  list_price: { amount: number; label: string } | null
  games: CatalogGameRef[]
  paid_orders: number
  owners: number
  history: { action: string; created_at: string; by: string | null; details: Record<string, unknown> }[]
}
export interface CatalogGame {
  code: string
  name: string
  access: 'paid' | 'free'
  status: 'draft' | 'published'
  file: { version: string; filename: string; size_bytes: number; published_at: string | null } | null
  single: string | null
  packs: string[]
}
export interface CatalogList { version: string; livemode: boolean; products: CatalogProduct[]; games: CatalogGame[] }

// À venda de fato é estar ativo e pronto; ativo sem algo pronto não aparece na loja.
export function productState(product: CatalogProduct): { label: string; tone: 'published' | 'danger' | '' } {
  if (product.status === 'active') return product.sellable ? { label: 'À venda', tone: 'published' } : { label: 'Falta algo para vender', tone: 'danger' }
  return product.status === 'archived' ? { label: 'Pausado', tone: '' } : { label: 'Rascunho', tone: '' }
}

const ACTIONS: Record<string, string> = {
  product_status: 'Mudou a situação', product_price: 'Trocou o preço', product_list_price: 'Mudou o preço riscado',
  pack_add_game: 'Pôs um jogo no pacote', pack_remove_game: 'Tirou um jogo do pacote',
}
export const catalogActionLabel = (action: string) => ACTIONS[action] ?? action

// "14,90", "14.90" ou "14" em centavos; null se não for um valor.
export function parseReais(text: string): number | null {
  const match = /^\s*(\d{1,4})(?:[.,](\d{1,2}))?\s*$/.exec(text)
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

// O Price no painel da Stripe, no modo da chave deste ambiente (teste ou produção).
export const stripePriceUrl = (priceId: string, livemode: boolean) => `https://dashboard.stripe.com/${livemode ? '' : 'test/'}prices/${encodeURIComponent(priceId)}`
