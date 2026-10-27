// Gerado por scripts/catalog-export.mjs no build da VPS, a partir do /catalog. No repositório (local e CI) fica o
// retrato do catálogo do banco em 2026-10-24. Não edite à mão: o preço e os pacotes mudam no admin.
import type { CatalogEntry, PromoBanner } from './catalog.ts'

export const catalogSnapshot: readonly CatalogEntry[] = [
  { code: 'P001', price: { unit_amount: 2990, currency: 'brl' }, list_price: { amount: 3990, label: 'Preço de lançamento' }, games: ['J001', 'J003', 'J002', 'J004', 'J005'] },
  { code: 'J001', price: { unit_amount: 990, currency: 'brl' }, list_price: null, games: ['J001'] },
  { code: 'J003', price: { unit_amount: 990, currency: 'brl' }, list_price: null, games: ['J003'] },
  { code: 'J002', price: { unit_amount: 1290, currency: 'brl' }, list_price: null, games: ['J002'] },
  { code: 'J004', price: { unit_amount: 1290, currency: 'brl' }, list_price: null, games: ['J004'] },
  { code: 'J005', price: { unit_amount: 990, currency: 'brl' }, list_price: null, games: ['J005'] },
]

export const promoBanner: PromoBanner | null = {"code":"PRIMEIRA10","text":"Primeira compra? Usem o cupom {cupom} no pagamento e ganhem 10% de desconto."}

export const salesOpenAt: string | null = null
