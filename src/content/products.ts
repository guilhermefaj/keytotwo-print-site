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
  { code: offer.code, kind: 'bundle', title: 'Pacote de 5 jogos para imprimir', games, offer },
]
