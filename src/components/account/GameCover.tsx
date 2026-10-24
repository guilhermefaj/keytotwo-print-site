import type { CSSProperties } from 'react'
import { contentCode, games, type GameCoverArt } from '../../content/games'
import { siteConfig } from '../../lib/site-config'

// Capa de jogo (DESIGN.md › Capa de jogo). Duas faces, decididas pelos dados do jogo: arte oficial
// (16:9, só jogos com `cover` em src/content/games.ts) e tipográfica (nome sobre a carta, padrão de
// qualquer jogo sem capa). A prévia do PDF nunca vira capa.
// `sizes` diz a largura real em que a capa aparece, para o navegador não baixar a de 800 px numa miniatura.
// `priority` é para a capa que vira LCP no topo da página (banner da Loja): sem lazy e com prioridade alta.
export function GameCover({ code, name, art: productArt, sizes = '(max-width: 767px) 100vw, 360px', priority = false }: { code?: string; name: string; art?: GameCoverArt; sizes?: string; priority?: boolean }) {
  const game = code ? games.find(item => item.code === contentCode(code, siteConfig.stage)) : undefined
  const art = productArt ?? game?.cover
  // Cor do jogo (DESIGN.md › Cor do jogo): só o fundo da face tipográfica. A arte oficial não ganha faixa (2026-10-23).
  const accent = productArt ? undefined : game?.accent
  const tone = accent ? { 'data-accent': '', style: { '--game-accent': accent } as CSSProperties } : {}
  if (art) return <div className="game-cover game-cover-art"><img src={art.src} srcSet={art.srcSet} sizes={sizes} alt="" width="640" height="360" loading={priority ? undefined : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async" /></div>
  return <div className="game-cover game-cover-type" aria-hidden="true" {...tone}><span className="game-cover-name">{name}</span></div>
}
