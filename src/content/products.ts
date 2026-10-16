import { games, packageGames, j001, cover, type Game, type GameCoverArt } from './games.ts'
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
  /** Capa do próprio produto (pacote) na Loja e na página dele; o avulso usa a capa do jogo. */
  cover?: GameCoverArt
}

export const packageContents = ['Jogos para imprimir', 'Instruções para preparar e jogar', 'Arquivos digitais em PDF']

const byCode = (code: string) => games.find(game => game.code === code)!

// Avulso: todo jogo pago também se vende sozinho (responsável, 2026-10-16). Preço vem do /catalog.
function single(game: Game, contents: readonly string[], materials: string): Product {
  const code = game.code!
  return {
    code, slug: code.toLowerCase(), kind: 'single', availability: 'sale',
    title: game.name, tagline: game.summary, contents,
    delivery: ['Download após a confirmação da compra.', 'Acesso sem prazo de expiração.'],
    games: [game], thumbnail: { src: game.cover!.src, alt: '' },
    offer: {
      code, name: game.name, price: null, priceApproved: false, purchaseAction: 'cart',
      payment: pending(`preço real, moeda e formas de pagamento do ${code}.`),
      access: packageOffer.access, delivery: packageOffer.delivery,
      updates: pending(`direito a futuras versões e condições de atualização do ${code}.`),
      license: pending(`licença de uso e condições de atendimento do ${code}.`),
      materials,
      legalReview: pending(`texto final e validação jurídica da política de não reembolso do ${code}.`),
    },
  }
}

// Produtos confirmados pelo responsável; preço e aprovação comercial são por oferta.
// Regra de catálogo: título, chamada, conteúdo e entrega vêm daqui; a oferta renderiza um card por produto.
// Conteúdo genérico (responsável, 2026-10-16): o que vem, sem contar páginas nem cartas; base nas fichas do segundo cérebro.
export const products: readonly Product[] = [
  { code: packageOffer.code, slug: 'p001', kind: 'bundle', availability: 'sale', title: 'Coleção KeyToTwo: Fundadores', tagline: 'Pacote de jogos. Muitas próximas rodadas.', shopHeadline: 'Pacote de jogos', contents: packageContents, delivery: ['Download após a confirmação da compra.', 'Acesso sem prazo de expiração.'], games: packageGames, cover: cover('p001'), thumbnail: { src: cover('p001').src, alt: '' }, offer: packageOffer },
  single(byCode('J001'), ['O jogo completo em PDF para imprimir', 'Instruções e cartas para recortar'], j001.materials),
  single(byCode('J003'), ['O jogo completo em PDF para imprimir', 'Tabuleiro, cartas, moedas, dado e pinos para montar'], 'Impressão, tesoura, cola, uma caneta por pessoa, cronômetro e celular para os desafios de foto.'),
  single(byCode('J002'), ['O jogo completo em PDF para imprimir', 'Desafios, envelopes e cartões de dica'], 'Impressão, tesoura, estilete com base de corte, fita adesiva, uma caneta por pessoa, um copo para as dicas e luz do dia ou um abajur.'),
]

// PENDENTE: licença, atualizações e validação jurídica de cada oferta (campos pending acima).
// Um produto soon deve declarar offer.purchaseAction: null; não cadastrar exemplos públicos.

// O prerender é editorial. A venda na tela exige também presença no /catalog em runtime.
export const productPages = products.filter(product => product.availability === 'sale')

// Editorial display name; commercial approval remains tracked in offer.name.
export function productName(code: string, fallback = '') {
  return products.find(product => product.code === code)?.title || (/PENDENTE|\bTESTE\b/i.test(fallback) || !fallback ? 'Jogo para imprimir' : fallback)
}
