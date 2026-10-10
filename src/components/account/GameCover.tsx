import './game-cover.css'
import { siteConfig } from '../../lib/seo'

// Capa de jogo (DESIGN.md › Carta de jogo). Três faces: prévia real (só o J001, único jogo com
// prévia aprovada), tipográfica (nome do jogo sobre a carta, padrão de qualquer jogo sem prévia)
// e "em breve" (jogo ainda indefinido). Nunca arte do Kito nem capa fictícia (P0-2).
const previews: Record<string, { src: string; alt: string }> = {
  J001: { src: '/media/experience/j001-page-1-720.webp', alt: 'Prévia real de Rabisque e Adivinhe.' },
}

export function GameCover({ code, name, seal, soon = false }: { code: string; name: string; seal?: string; soon?: boolean }) {
  // The local stage seed exposes TESTE-J01…05 for these same five games.
  const coverCode = siteConfig.stage === 'test' ? code.replace(/^TESTE-J0([1-5])$/, 'J00$1') : code
  const preview = previews[coverCode]
  if (preview) return <div className="game-cover game-cover-preview"><img src={preview.src} alt={preview.alt} width="509" height="720" loading="lazy" decoding="async" /></div>
  if (soon) return <div className="game-cover game-cover-soon" aria-hidden="true"><span className="game-cover-name">{name}</span></div>
  return <div className="game-cover game-cover-type" aria-hidden="true">{seal && <span className="tag-solid">{seal}</span>}<span className="game-cover-name">{name}</span></div>
}
