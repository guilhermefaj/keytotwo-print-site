import './game-cover.css'
import { games } from '../../content/games'
import { siteConfig } from '../../lib/seo'

// Capa de jogo (DESIGN.md › Capa de jogo). Três faces, decididas pelos dados do jogo: arte oficial
// (16:9, só jogos com `cover` em src/content/games.ts), tipográfica (nome sobre a carta, padrão de
// qualquer jogo sem capa) e "em breve" (jogo ainda indefinido). A prévia do PDF nunca vira capa.
export function GameCover({ code, name, seal, soon = false }: { code?: string; name: string; seal?: string; soon?: boolean }) {
  // Só a fixture TESTE-J01 corresponde a um jogo com capa aprovada.
  // A ordem do seed não determina os códigos das fichas (J002 é o escape room).
  const coverCode = siteConfig.stage === 'test' && code === 'TESTE-J01' ? 'J001' : code
  const art = coverCode ? games.find(game => game.code === coverCode)?.cover : undefined
  if (soon) return <div className="game-cover game-cover-soon" aria-hidden="true"><span className="game-cover-name">Em breve</span></div>
  if (art) return <div className="game-cover game-cover-art"><img src={art.src} srcSet={art.srcSet} sizes="(max-width: 767px) 100vw, 480px" alt="" width="640" height="360" loading="lazy" decoding="async" /></div>
  return <div className="game-cover game-cover-type" aria-hidden="true">{seal && <span className="tag-solid">{seal}</span>}<span className="game-cover-name">{name}</span></div>
}
