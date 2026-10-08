import { useOutletContext } from 'react-router'
import { HeroScene } from '../components/HeroScene'
import { HowItWorks } from '../components/sections/HowItWorks'
import { OfferSection } from '../components/sections/OfferSection'
import { FaqSection } from '../components/sections/FaqSection'
import { ClosingCta } from '../components/sections/ClosingCta'
import { ExperienceSections } from '../components/sections/ExperienceSections'
import { experience } from '../content/experience'

export default function Home() {
  const { menuOpen } = useOutletContext<{ menuOpen: boolean }>()
  return <main id="conteudo" tabIndex={-1}>
    <div className="hero">
      <section className="hero-copy text-center" aria-labelledby="hero-title">
        <p className="eyebrow">KeyToTwo · jogos para casais</p>
        <h1 id="hero-title">{experience.headline[0]}{' '}<span>{experience.headline[1]}</span></h1>
        <p className="hero-description">{experience.description}</p>
        <ul className="hero-benefits">{experience.benefits.map(benefit => <li key={benefit}><svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20"><path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>{benefit}</li>)}</ul>
        <div className="hero-actions flex items-center justify-center"><a className="button button-primary hero-cta" href="/#comprar">{experience.cta}<span aria-hidden="true">→</span></a></div>
      </section>
      <HeroScene obscured={menuOpen} />
    </div>
    <HowItWorks /><ExperienceSections /><OfferSection /><FaqSection /><ClosingCta />
  </main>
}
