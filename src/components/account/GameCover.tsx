import type { CSSProperties } from 'react'
import { games, type GameCoverArt } from '../../content/games'
import { siteConfig } from '../../lib/seo'

// Capa de jogo (DESIGN.md › Capa de jogo). Três faces, decididas pelos dados do jogo: arte oficial
// (16:9, só jogos com `cover` em src/content/games.ts), tipográfica (nome sobre a carta, padrão de
// qualquer jogo sem capa) e "em breve" (jogo ainda indefinido). A prévia do PDF nunca vira capa.
// `sizes` diz a largura real em que a capa aparece, para o navegador não baixar a de 1280 px numa miniatura.
// `priority` é para a capa que vira LCP no topo da página (banner da Loja): sem lazy e com prioridade alta.
export function GameCover({ code, name, seal, soon = false, art: productArt, sizes = '(max-width: 767px) 100vw, 360px', priority = false }: { code?: string; name: string; seal?: string; soon?: boolean; art?: GameCoverArt; sizes?: string; priority?: boolean }) {
  // Só a fixture TESTE-J01 corresponde a um jogo com capa aprovada.
  // A ordem do seed não determina os códigos das fichas (J002 é o escape room).
  const coverCode = siteConfig.stage === 'test' && code === 'TESTE-J01' ? 'J001' : code
  const game = coverCode ? games.find(item => item.code === coverCode) : undefined
  const art = productArt ?? game?.cover
  // Cor do jogo (DESIGN.md › Cor do jogo): faixa sob a capa e fundo da face tipográfica; o pacote usa a linha da folha.
  const accent = productArt ? undefined : game?.accent
  const tone = accent ? { 'data-accent': '', style: { '--game-accent': accent } as CSSProperties } : {}
  if (soon) return <div className="game-cover game-cover-soon" aria-hidden="true"><span className="game-cover-name">Em breve</span></div>
  if (art) return <div className="game-cover game-cover-art" {...tone}><img src={art.src} srcSet={art.srcSet} sizes={sizes} alt="" width="640" height="360" loading={priority ? undefined : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" /></div>
  return <div className="game-cover game-cover-type" aria-hidden="true" {...tone}>{seal && <span className="tag-solid">{seal}</span>}<span className="game-cover-name">{name}</span></div>
}
