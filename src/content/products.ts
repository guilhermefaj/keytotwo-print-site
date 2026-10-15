import { games, type Game } from './games'
import { packageOffer, type ProductOffer } from './offer'

export type Product = {
  code: string
  slug: string
  kind: 'bundle' | 'single'
  /** Estado editorial; sale não substitui as travas de preço e completude do backend. */
  availability: 'sale' | 'soon'
  title: string
  tagline: string
  contents: readonly string[]
  delivery: readonly string[]
  games: readonly Game[]
  offer: ProductOffer
  /** Imagem real do produto para miniaturas; sem ela, a capa tipográfica com o título. */
  thumbnail?: { src: string; alt: string }
}

export const packageContents = ['5 jogos para imprimir', 'Instruções para preparar e jogar', 'Arquivos digitais em PDF']

// P2: the page consumes a product list. P001 is the only confirmed product.
// Regra de catálogo: título, chamada, conteúdo e entrega vêm daqui; a oferta renderiza um card por produto.
export const products: readonly Product[] = [
  { code: packageOffer.code, slug: 'p001', kind: 'bundle', availability: 'sale', title: 'Pacote KeyToTwo', tagline: '5 jogos. Muitas próximas rodadas.', contents: packageContents, delivery: ['Download após a confirmação da compra.', 'Acesso sem prazo de expiração.'], thumbnail: { src: '/media/experience/j001-page-1-720.webp', alt: '' }, games, offer: packageOffer },
]

// PENDENTE: jogos, códigos comerciais e preços dos avulsos dependem do responsável.
// Um produto soon deve declarar offer.purchaseAction: null; não cadastrar exemplos públicos.

// Editorial display name; commercial approval remains tracked in offer.name.
export function productName(code: string, fallback = '') {
  return products.find(product => product.code === code)?.title || (/PENDENTE|\bTESTE\b/i.test(fallback) || !fallback ? 'Jogo para imprimir' : fallback)
}
