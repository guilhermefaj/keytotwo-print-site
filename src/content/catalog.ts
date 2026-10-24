import { catalogSnapshot } from './catalog-snapshot.ts'

// Catálogo à venda no momento do build (2026-10-24, decisão do responsável): o preço da Stripe, o riscado da promoção e
// os jogos de cada produto, na ordem do banco. O admin muda o catálogo e o vigia da VPS reconstrói a loja; daqui saem o
// dado do Google (JSON-LD), a lista de jogos do pacote e o valor dos eventos. O preço e o riscado que a página mostra
// vêm do /catalog na hora, e é ele que decide se dá para comprar.
export type CatalogEntry = {
  code: string
  price: { unit_amount: number; currency: string } | null
  list_price: { amount: number; label: string } | null
  games: readonly string[]
}

export const catalogEntry = (code: string): CatalogEntry | undefined => catalogSnapshot.find(entry => entry.code === code)
