import { games, type Game } from './games'
import { offer } from './offer'

export type Product = {
  code: string
  kind: 'bundle' | 'single'
  title: string
  tagline: string
  contents: readonly string[]
  delivery: readonly string[]
  games: readonly Game[]
  offer: typeof offer
}

export const packageContents = ['5 jogos para imprimir', 'Instruções para preparar e jogar', 'Arquivos digitais em PDF']

// P2: the page consumes a product list. P001 is the only confirmed product.
// Regra de catálogo: título, chamada, conteúdo e entrega vêm daqui; a oferta renderiza um card por produto.
export const products: readonly Product[] = [
  { code: offer.code, kind: 'bundle', title: 'Pacote KeyToTwo', tagline: '5 jogos. Muitas próximas rodadas.', contents: packageContents, delivery: ['Download após a confirmação da compra.', 'Acesso sem prazo de expiração.'], games, offer },
]

// Editorial display name; commercial approval remains tracked in offer.name.
export function productName(code: string, fallback = '') {
  return products.find(product => product.code === code)?.title || (/PENDENTE|\bTESTE\b/i.test(fallback) || !fallback ? 'Jogo para imprimir' : fallback)
}
