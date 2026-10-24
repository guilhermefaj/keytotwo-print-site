import { productName } from '../../content/products'
import { games } from '../../content/games'
import type { CartItem } from '../../lib/api'
import { siteConfig } from '../../lib/seo'

// Resolução de nomes da sacola (compartilhada por página, gaveta e confirmação).

// Nome de item da sacola: o título editorial do produto quando ele existe no conteúdo; senão, o nome
// vindo da API. Avulsos usam o código do jogo como código de produto (decisão do responsável): quando a
// API só traz marcador de pendência, o nome aprovado no conteúdo do jogo responde.
export const itemName = (code: string, fallback = '') => {
  const name = productName(code, fallback)
  if (name !== 'Jogo para imprimir') return name
  const game = games.find(entry => entry.code === code)
  return game?.confirmed ? game.name : name
}

// Nome de jogo pelo código (composição e sobreposição): o conteúdo cobre os códigos reais; a fixture
// TESTE-J01 do seed corresponde ao J001 (mesma remoção de rótulo do GameCover). Código desconhecido
// mostra o próprio código, nunca um nome inventado.
const gameName = (code: string) => {
  const contentCode = siteConfig.stage === 'test' && code === 'TESTE-J01' ? 'J001' : code
  return games.find(game => game.code === contentCode)?.name || code
}

// Por que o item da sacola não é cobrado (o preço já diz "não é cobrado"), ou é cobrado só pelo que falta.
// Sem nada a explicar, texto vazio.
export function itemNote(item: CartItem, items: CartItem[]): string {
  if (item.status === 'unavailable') return 'Este produto não está disponível para compra.'
  if (item.status === 'already_owned') return `Você já tem ${item.games.length > 1 ? 'todos os jogos deste pacote' : 'este jogo'} no Portal.`
  if (item.status === 'included') {
    const bundle = items.find(entry => item.included_in.includes(entry.code))
    return `Já vem no pacote${bundle ? ` ${itemName(bundle.code, bundle.name)}` : ''} da sua sacola.`
  }
  if (item.owned_games.length) return `Você já tem ${item.owned_games.map(gameName).join(' e ')}. O pacote cobra só o que falta, com o mesmo desconto.`
  if (item.shared_with.some(code => items.some(entry => entry.code === code && entry.status === 'ok'))) return 'Inclui jogos que também estão em outro item da sacola.'
  return ''
}
