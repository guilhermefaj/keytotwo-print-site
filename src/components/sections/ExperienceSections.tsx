import { Link } from 'react-router'
import { experience } from '../../content/experience'
import { siteConfig } from '../../lib/seo'
import { SnapCarousel } from '../ui/SnapCarousel'
import { CutLine } from '../ui/CutLine'

// A experiência, não o conteúdo: o Kito comemora a rodada no tabuleiro (arte da marca, nunca página do PDF,
// responsável, 2026-10-16). A linha de recorte entra aqui, logo depois da hero (DESIGN.md › The Three Cuts Rule).
export function ProductExperience() {
  return <section className="page-section experience-section" aria-labelledby="experiencia"><CutLine /><div className="content-width experience-layout">
    <figure className="experience-art"><img src="/media/experience/kito-tabuleiro-480.webp" srcSet="/media/experience/kito-tabuleiro-240.webp 240w, /media/experience/kito-tabuleiro-480.webp 480w" sizes="(max-width: 767px) 70vw, 420px" alt="" width="480" height="480" loading="lazy" decoding="async" /></figure>
    <div className="experience-copy"><h2 id="experiencia" tabIndex={-1}>A próxima rodada sai da impressora.</h2><p className="lead">Cartas na mesa, uma tentativa duvidosa e aquela vontade de jogar de novo.</p><p>Um dia é desenho, no outro é tabuleiro ou investigação. Vocês imprimem em casa e o resto fica com a dupla.</p><Link className="button button-primary" to="/loja">Ver os jogos</Link></div>
  </div></section>
}

// Relatos: placeholders só no stage test; em live só relatos reais, e sem nenhum a seção não existe (P0-1).
export function Testimonials() {
  const social = experience.social
  const visible = siteConfig.stage === 'test' ? social.testimonials : social.testimonials.filter(item => !item.placeholder)
  if (!visible.length) return null
  return <section className="page-section social-section" aria-labelledby="social-title"><div className="content-width">
    <div className="section-heading"><h2 id="social-title">{social.heading}</h2></div>
    <SnapCarousel label="Relatos dos casais" className="social-carousel">{visible.map(item => <figure key={item.id} className="social-card" data-placeholder={item.placeholder ? 'true' : undefined}>
      {item.placeholder && <span className="tag-solid">{social.placeholderLabel}</span>}
      <blockquote>{item.quote}</blockquote><figcaption>{item.author}</figcaption>
    </figure>)}</SnapCarousel>
  </div></section>
}
