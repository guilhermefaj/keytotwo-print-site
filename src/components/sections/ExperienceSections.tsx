import { experience } from '../../content/experience'

import { ProductPreview } from './ProductPreview'
import { SnapCarousel } from '../ui/SnapCarousel'

function BrandIllustration({ kind }: { kind: string }) {
  if (kind === 'time') return <span className="pillar-kito-walk" aria-hidden="true" />
  const hi = kind === 'connection'
  return <img className="pillar-illustration" src={hi ? '/media/experience/kito-hi-128.webp' : '/media/experience/kito-tabuleiro-240.webp'} alt="" width={hi ? 128 : 240} height={hi ? 128 : 240} loading="lazy" decoding="async" />
}

export function ProductExperience() {
  return <section className="page-section experience-section" aria-labelledby="experiencia"><div className="content-width experience-layout">
    <ProductPreview />
    <div className="experience-copy"><p className="eyebrow">Pode puxar uma cadeira</p><h2 id="experiencia" tabIndex={-1}>A próxima rodada sai da impressora.</h2><p>Cartas na mesa, uma tentativa duvidosa e aquela vontade de jogar de novo.</p><p>Esta é uma prévia de Rabisque e Adivinhe, um dos jogos do pacote. Imprimam, recortem as cartas e vejam quem entende o desenho de quem.</p><a className="button button-light" href="/#comprar">Escolher nosso encontro</a></div>
  </div></section>
}

export function ExperienceSections() {
  const social = experience.social
  return <>
    <section className="page-section pillars-section" aria-labelledby="pillars-title"><div className="content-width">
      <div className="section-heading centered-heading"><p className="eyebrow">O melhor da partida</p><h2 id="pillars-title">Estar ali. De verdade.</h2></div>
      <div className="pillars-grid">{experience.pillars.map(pillar => <article key={pillar.icon}><BrandIllustration kind={pillar.icon} /><h3>{pillar.title}</h3><p>{pillar.text}</p></article>)}</div>
    </div></section>
    <section className="page-section social-section" aria-labelledby="social-title"><div className="content-width">
      <div className="section-heading centered-heading"><p className="eyebrow">Histórias a dois</p><h2 id="social-title">{social.heading}</h2><p>{social.description}</p></div>
      {(social.rating !== null || social.reviewCount !== null) && <div className="social-metrics">{social.rating !== null && <p><strong>{social.rating.toLocaleString('pt-BR')}</strong><span>Nota dos casais</span></p>}{social.reviewCount !== null && <p><strong>{social.reviewCount.toLocaleString('pt-BR')}</strong><span>Relatos recebidos</span></p>}</div>}
      <SnapCarousel label="Relatos dos casais" className="social-carousel">{social.testimonials.map(item => <figure key={item.id} className="social-card" data-placeholder={!item.quote || !item.author ? 'true' : undefined}>
        {item.quote && item.author ? <><blockquote>{item.quote}</blockquote><figcaption>{item.author}</figcaption></> : <><span className="placeholder-label">{social.placeholders.label}</span><p className="placeholder-quote">{social.placeholders.quote}</p><span className="placeholder-lines" aria-hidden="true" /><figcaption>{social.placeholders.author}</figcaption></>}
      </figure>)}</SnapCarousel>
    </div></section>
  </>
}
