import { games, packageGames, cover, type Game, type GameCoverArt } from './games.ts'
import { packageOffer, type ProductOffer } from './offer.ts'

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

const packageContents = ['Todos os jogos da coleção num só pedido', 'Um PDF por jogo, para imprimir em casa', 'Instruções de preparo e de jogo em cada PDF']

const byCode = (code: string) => games.find(game => game.code === code)!

// Avulso: todo jogo pago também se vende sozinho (responsável, 2026-10-16). O preço exibido vem do /catalog;
// `price` é o valor aprovado pelo responsável em 2026-10-16, conferido só pela trava de release.
function single(game: Game, price: string, contents: readonly string[], seo: Product['seo']): Product {
  const code = game.code!
  return {
    // URL com o nome do jogo (SEO, 2026-10-22); os códigos antigos (/loja/j001…) redirecionam no nginx.
    code, slug: game.id, kind: 'single', availability: 'sale',
    title: game.name, tagline: game.summary, contents,
    delivery: ['O PDF aparece em Meus jogos assim que o pagamento é confirmado e também chega por e-mail.', 'Dá para baixar de novo quando precisar, sem prazo.'],
    games: [game], thumbnail: { src: game.cover!.src, alt: '' }, seo,
    offer: { code, price, priceApproved: true, purchaseAction: 'cart' },
  }
}

// Produtos confirmados pelo responsável; preço e aprovação comercial são por oferta.
// Regra de catálogo: título, chamada, conteúdo e entrega vêm daqui; a oferta renderiza um card por produto.
// Conteúdo genérico (responsável, 2026-10-16): o que vem, sem contar páginas nem cartas; base nas fichas do segundo cérebro.
export const products: readonly Product[] = [
  { code: packageOffer.code, slug: 'colecao-fundadores', kind: 'bundle', availability: 'sale', title: 'Coleção KeyToTwo: Fundadores', tagline: 'Os primeiros jogos da KeyToTwo, num só pedido.', shopHeadline: 'Pacote de jogos', contents: packageContents, delivery: ['Os PDFs aparecem em Meus jogos assim que o pagamento é confirmado e também chegam por e-mail.', 'Dá para baixar de novo quando precisar, sem prazo.'], games: packageGames, cover: cover('p001'), thumbnail: { src: cover('p001').src, alt: '' }, offer: packageOffer,
    seo: { title: 'Coleção KeyToTwo: Fundadores, pacote de jogos para casais', description: 'Os primeiros jogos da KeyToTwo num só pedido, em PDF para casais imprimirem e jogarem em casa.' } },
  single(byCode('J001'), 'R$ 9,90', ['O jogo completo em PDF para imprimir', 'Cartas para recortar e as instruções do jogo'],
    { title: 'Rabisque e Adivinhe, jogo de desenho para casais', description: 'Jogo cooperativo de desenho e adivinhação para casais, em PDF para imprimir em casa. Rodadas de um minuto e placar da dupla.' }),
  single(byCode('J003'), 'R$ 9,90', ['O jogo completo em PDF para imprimir', 'Tabuleiro, cartas, moedas, dado e pinos para montar'],
    { title: 'Tabuleiro da Sorte, jogo de tabuleiro para casais', description: 'Perguntas, desafios e moedas num tabuleiro para dois, com um pedido secreto valendo. PDF para imprimir e montar em casa.' }),
  single(byCode('J002'), 'R$ 12,90', ['O jogo completo em PDF para imprimir', 'Desafios, envelopes e cartões de dica'],
    { title: 'O Sumiço de Rapadura, escape room para casais', description: 'Escape room de papel para dois: ajudem o Kito a encontrar Rapadura. PDF para imprimir, recortar e resolver juntos em casa.' }),
  // Preços do responsável em 2026-10-23.
  single(byCode('J004'), 'R$ 12,90', ['O jogo completo em PDF para imprimir', 'Desafios, envelopes e cartões de dica'],
    { title: 'A Rota da Fornalha, escape room espacial para casais', description: 'Escape room de papel para dois: ajudem o Kito a pôr a nave de volta na rota. PDF para imprimir, recortar e resolver juntos em casa.' }),
  single(byCode('J005'), 'R$ 9,90', ['O jogo completo em PDF para imprimir', 'Cartões, cédulas, pôster e cápsula para preencher'],
    { title: 'Retrospectiva a Dois, jogo de memória para casais', description: 'Uma premiação da temporada do casal, com linha do tempo, prêmios e uma cápsula para a próxima. PDF para imprimir e jogar em casa.' }),
]

// Um produto soon deve declarar offer.purchaseAction: null; não cadastrar exemplos públicos.

// O prerender é editorial. A venda na tela exige também presença no /catalog em runtime.
export const productPages = products.filter(product => product.availability === 'sale')

export const productByCode = (code: string) => products.find(product => product.code === code)
// O avulso do jogo e o pacote à venda que o traz.
export const singleFor = (game: Game) => products.find(product => product.kind === 'single' && product.code === game.code)
export const bundleFor = (game: Game) => products.find(product => product.kind === 'bundle' && product.availability === 'sale' && product.games.some(item => item.id === game.id))

// Nome de exibição (sacola, pagamento, pedidos e Portal): o título do produto; sem produto, o nome vindo da API, a não
// ser que traga marcador de pendência ou de teste; aí o nome de um jogo confirmado com esse código (avulsos usam o
// código do jogo) ou o genérico.
export function productName(code: string, fallback = '') {
  const title = productByCode(code)?.title
  if (title) return title
  if (fallback && !/PENDENTE|\bTESTE\b/i.test(fallback)) return fallback
  return games.find(entry => entry.code === code && entry.confirmed)?.name ?? 'Jogo para imprimir'
}
