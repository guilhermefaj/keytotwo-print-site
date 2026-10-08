import { useOutletContext } from 'react-router'
import { HeroScene } from '../components/HeroScene'
import { GamesSection } from '../components/sections/GamesSection'
import { HowItWorks } from '../components/sections/HowItWorks'
import { OfferSection } from '../components/sections/OfferSection'
import { FaqSection } from '../components/sections/FaqSection'
import { ClosingCta } from '../components/sections/ClosingCta'
import { site } from '../content/site'
import { siteConfig } from '../lib/seo'

export default function Home() {
  const { menuOpen } = useOutletContext<{ menuOpen: boolean }>()
  return <main id="conteudo" tabIndex={-1}>
    <div className="hero">
      <section className="hero-copy text-center" aria-labelledby="hero-title">
        <p className="eyebrow">Jogos para casais · para imprimir</p>
        <h1 id="hero-title">A próxima fase <span>é de vocês dois.</span></h1>
        <p className="hero-description">{site.heroDescription}</p>
        <div className="hero-actions flex items-center justify-center gap-6">
          <a className="button button-primary hero-cta" href="/#comprar">Ver pacote <span aria-hidden="true">→</span></a>
          <a className="text-button secondary-action" href="/#jogos">Conhecer os jogos</a>
        </div>
        <p className="hero-note">Arquivos digitais. A brincadeira acontece fora da tela.</p>
      </section>
      {siteConfig.stage !== 'live' && <div className="prototype-note"><span>{siteConfig.stage === 'test' ? 'Ambiente de teste' : 'Protótipo visual'}</span><p>Pacote em preparação. Compra ainda indisponível.</p></div>}
      <HeroScene obscured={menuOpen} />
    </div>
    <GamesSection /><HowItWorks /><OfferSection /><FaqSection /><ClosingCta />
  </main>
}
