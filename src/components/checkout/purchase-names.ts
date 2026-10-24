import { productName } from '../../content/products'
import { contentCode, games } from '../../content/games'
import type { CartItem } from '../../lib/api'
import { siteConfig } from '../../lib/site-config'

// Por que um item da sacola não é cobrado (compartilhado por página, gaveta e confirmação).

// Nome de jogo pelo código (composição e sobreposição). Código desconhecido mostra o próprio código, nunca um nome
// inventado.
const gameName = (code: string) => games.find(game => game.code === contentCode(code, siteConfig.stage))?.name || code

// Por que o item da sacola não é cobrado (o preço já diz "não é cobrado"), ou é cobrado só pelo que falta.
// Sem nada a explicar, texto vazio.
export function itemNote(item: CartItem, items: CartItem[]): string {
  if (item.status === 'unavailable') return 'Este produto não está disponível para compra.'
  if (item.status === 'already_owned') return `Você já tem ${item.games.length > 1 ? 'todos os jogos deste pacote' : 'este jogo'} no Portal.`
  if (item.status === 'included') {
    const bundle = items.find(entry => item.included_in.includes(entry.code))
    return `Já vem no pacote${bundle ? ` ${productName(bundle.code, bundle.name)}` : ''} da sua sacola.`
  }
  if (item.owned_games.length) return `Você já tem ${item.owned_games.map(gameName).join(' e ')}. O pacote cobra só o que falta, com o mesmo desconto.`
  if (item.shared_with.some(code => items.some(entry => entry.code === code && entry.status === 'ok'))) return 'Inclui jogos que também estão em outro item da sacola.'
  return ''
}
