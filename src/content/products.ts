import { games, packageGames, j001, type Game } from './games.ts'
import { packageOffer, type ProductOffer } from './offer.ts'
import { pending } from '../lib/pending.ts'

export type Product = {
  code: string
  slug: string
  kind: 'bundle' | 'single'
  /** Estado editorial; sale não substitui as travas de preço e completude do backend. */
  availability: 'sale' | 'soon'
  title: string
  tagline: string
  shopHeadline?: string
  contents: readonly string[]
  delivery: readonly string[]
  games: readonly Game[]
  offer: ProductOffer
  /** Capa oficial (16:9) para miniaturas; sem ela, a capa tipográfica com o título. Nunca a prévia do PDF. */
  thumbnail?: { src: string; alt: string }
}

export const packageContents = ['5 jogos para imprimir', 'Instruções para preparar e jogar', 'Arquivos digitais em PDF']

const rabisque = games.find(game => game.code === 'J001')!

// Produtos confirmados pelo responsável; preço e aprovação comercial são por oferta.
// Regra de catálogo: título, chamada, conteúdo e entrega vêm daqui; a oferta renderiza um card por produto.
export const products: readonly Product[] = [
  { code: packageOffer.code, slug: 'p001', kind: 'bundle', availability: 'sale', title: 'Pacote KeyToTwo', tagline: '5 jogos. Muitas próximas rodadas.', shopHeadline: '5 jogos num só pedido', contents: packageContents, delivery: ['Download após a confirmação da compra.', 'Acesso sem prazo de expiração.'], games: packageGames, offer: packageOffer },
  {
    code: 'J001', slug: 'j001', kind: 'single', availability: 'sale',
    title: rabisque.name, tagline: rabisque.summary,
    contents: ['PDF de 4 páginas A4', 'Instruções e 50 cartas'],
    delivery: ['Download após a confirmação da compra.', 'Acesso sem prazo de expiração.'],
    games: [rabisque], thumbnail: { src: rabisque.cover!.src, alt: '' },
    offer: {
      code: 'J001', name: rabisque.name, price: null, priceApproved: false, purchaseAction: 'cart',
      payment: pending('preço real, moeda e formas de pagamento do J001.'),
      access: packageOffer.access, delivery: packageOffer.delivery,
      updates: pending('direito a futuras versões e condições de atualização do J001.'),
      license: pending('licença de uso e condições de atendimento do J001.'),
      materials: j001.materials,
      legalReview: pending('texto final e validação jurídica da política de não reembolso do J001.'),
    },
  },
]

// PENDENTE: preço real do J001; fichas, códigos comerciais e preços dos demais avulsos.
// Um produto soon deve declarar offer.purchaseAction: null; não cadastrar exemplos públicos.

// O prerender é editorial. A venda na tela exige também presença no /catalog em runtime.
export const productPages = products.filter(product => product.availability === 'sale')

// Editorial display name; commercial approval remains tracked in offer.name.
export function productName(code: string, fallback = '') {
  return products.find(product => product.code === code)?.title || (/PENDENTE|\bTESTE\b/i.test(fallback) || !fallback ? 'Jogo para imprimir' : fallback)
}
