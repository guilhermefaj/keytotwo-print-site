import { Link } from 'react-router'
import { experience } from '../../content/experience'
import { siteConfig } from '../../lib/seo'
import { ProductPreview } from './ProductPreview'
import { SnapCarousel } from '../ui/SnapCarousel'
import { CutLine } from '../ui/CutLine'
import '../../carousels.css'

// Prévia real do J001 sobre o Papel (direção B): nada de fundo em Tinta nem arco de Marca-texto.
// A linha de recorte entra aqui, logo depois da hero (DESIGN.md › The Three Cuts Rule).
export function ProductExperience() {
  return <section className="page-section experience-section" aria-labelledby="experiencia"><CutLine /><div className="content-width experience-layout">
    <ProductPreview />
    <div className="experience-copy"><h2 id="experiencia" tabIndex={-1}>A próxima rodada sai da impressora.</h2><p className="lead">Cartas na mesa, uma tentativa duvidosa e aquela vontade de jogar de novo.</p><p>Esta é uma prévia de Rabisque e Adivinhe, um dos jogos do pacote. Imprimam, recortem as cartas e vejam quem entende o desenho de quem.</p><Link className="button button-primary" to="/loja">Ver os jogos</Link></div>
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
