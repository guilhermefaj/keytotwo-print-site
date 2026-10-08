import { games } from './games'
import { offer } from './offer'

export type Product = {
  code: string
  kind: 'bundle' | 'single'
  title: string
  games: ReadonlyArray<{ id: string; name: string; confirmed: boolean }>
  offer: typeof offer
}

// P2: the page consumes a product list. P001 is the only confirmed product.
// I2b will supply the catalog and authenticated add-to-cart action.
export const products: readonly Product[] = [
  { code: offer.code, kind: 'bundle', title: 'Pacote KeyToTwo', games, offer },
]

// Editorial display name; commercial approval remains tracked in offer.name.
export function productName(code: string, fallback = '') {
  return products.find(product => product.code === code)?.title || (/PENDENTE|\bTESTE\b/i.test(fallback) || !fallback ? 'Jogo para imprimir' : fallback)
}
export const packageContents = ['5 jogos para imprimir', 'Instruções para preparar e jogar', 'Arquivos digitais em PDF']
