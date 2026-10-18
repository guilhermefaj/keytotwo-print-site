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
  /** Título (sem o sufixo do site) e descrição da busca; o resumo do card não diz "casal" nem "imprimir". */
  seo: { title: string; description: string }
}

export const packageContents = ['Todos os jogos da coleção num só pedido', 'Um PDF por jogo, para imprimir em casa', 'Instruções de preparo e de jogo em cada PDF']

const byCode = (code: string) => games.find(game => game.code === code)!

// Avulso: todo jogo pago também se vende sozinho (responsável, 2026-10-16). Preço vem do /catalog.
function single(game: Game, contents: readonly string[], materials: string, seo: Product['seo']): Product {
  const code = game.code!
  return {
    code, slug: code.toLowerCase(), kind: 'single', availability: 'sale',
    title: game.name, tagline: game.summary, contents,
    delivery: ['O PDF aparece em Meus jogos assim que o pagamento é confirmado e também chega por e-mail.', 'Dá para baixar de novo quando precisar, sem prazo.'],
    games: [game], thumbnail: { src: game.cover!.src, alt: '' }, seo,
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
  { code: packageOffer.code, slug: 'p001', kind: 'bundle', availability: 'sale', title: 'Coleção KeyToTwo: Fundadores', tagline: 'Os primeiros jogos da KeyToTwo, num só pedido.', shopHeadline: 'Pacote de jogos', contents: packageContents, delivery: ['Os PDFs aparecem em Meus jogos assim que o pagamento é confirmado e também chegam por e-mail.', 'Dá para baixar de novo quando precisar, sem prazo.'], games: packageGames, cover: cover('p001'), thumbnail: { src: cover('p001').src, alt: '' }, offer: packageOffer,
    seo: { title: 'Coleção KeyToTwo: Fundadores, pacote de jogos para casais', description: 'Os primeiros jogos da KeyToTwo num só pedido, em PDF para casais imprimirem e jogarem em casa.' } },
  single(byCode('J001'), ['O jogo completo em PDF para imprimir', 'Cartas para recortar e as instruções do jogo'], j001.materials,
    { title: 'Rabisque e Adivinhe, jogo de desenho para casais', description: 'Jogo cooperativo de desenho e adivinhação para casais, em PDF para imprimir em casa. Rodadas de um minuto e placar da dupla.' }),
  single(byCode('J003'), ['O jogo completo em PDF para imprimir', 'Tabuleiro, cartas, moedas, dado e pinos para montar'], 'Impressão, tesoura, cola, uma caneta por pessoa, cronômetro e celular para os desafios de foto.',
    { title: 'Tabuleiro da Sorte, jogo de tabuleiro para casais', description: 'Perguntas, desafios e moedas num tabuleiro para dois, com um pedido secreto valendo. PDF para imprimir e montar em casa.' }),
  single(byCode('J002'), ['O jogo completo em PDF para imprimir', 'Desafios, envelopes e cartões de dica'], 'Impressão, tesoura, estilete com base de corte, fita adesiva, uma caneta por pessoa, um copo para as dicas e luz do dia ou um abajur.',
    { title: 'O Sumiço de Rapadura, escape room para casais', description: 'Escape room de papel para dois: ajudem o Kito a encontrar Rapadura. PDF para imprimir, recortar e resolver juntos em casa.' }),
]

// PENDENTE: licença, atualizações e validação jurídica de cada oferta (campos pending acima).
// Um produto soon deve declarar offer.purchaseAction: null; não cadastrar exemplos públicos.

// O prerender é editorial. A venda na tela exige também presença no /catalog em runtime.
export const productPages = products.filter(product => product.availability === 'sale')

// Editorial display name; commercial approval remains tracked in offer.name.
export function productName(code: string, fallback = '') {
  return products.find(product => product.code === code)?.title || (/PENDENTE|\bTESTE\b/i.test(fallback) || !fallback ? 'Jogo para imprimir' : fallback)
}
