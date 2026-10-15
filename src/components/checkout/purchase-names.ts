import { productName } from '../../content/products'
import { games } from '../../content/games'
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
export const gameName = (code: string) => {
  const contentCode = siteConfig.stage === 'test' && code === 'TESTE-J01' ? 'J001' : code
  return games.find(game => game.code === contentCode)?.name || code
}
