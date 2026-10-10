import { siteConfig } from '../../lib/seo'

// J001 is the only approved game preview. Other covers use existing brand art,
// never a fictional game cover. Keep names and availability from the library API.
const brandArt: Record<string, { src: string; tone: string }> = {
  J002: { src: '/media/experience/kito-hi-256.webp', tone: 'sky' },
  J003: { src: '/media/experience/kito-tabuleiro-240.webp', tone: 'apricot' },
  J004: { src: '/media/experience/kito-hi-256.webp', tone: 'teal' },
  J005: { src: '/media/experience/kito-tabuleiro-240.webp', tone: 'sky' },
}

export function GameCover({ code }: { code: string }) {
  // The local stage seed exposes TESTE-J01…05 for these same five games.
  const coverCode = siteConfig.stage === 'test' ? code.replace(/^TESTE-J0([1-5])$/, 'J00$1') : code
  const realPreview = coverCode === 'J001'
  const art = brandArt[coverCode] ?? brandArt.J002
  return <div className={`game-cover game-cover-${realPreview ? 'preview' : art.tone}`}>
    <img src={realPreview ? '/media/experience/j001-page-1-720.webp' : art.src} alt={realPreview ? 'Prévia real de Rabisque e Adivinhe.' : ''} width={realPreview ? 509 : 240} height={realPreview ? 720 : 240} loading="lazy" decoding="async" />
  </div>
}
