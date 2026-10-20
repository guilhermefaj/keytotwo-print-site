import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { experience } from '../../content/experience'
import { siteConfig } from '../../lib/seo'
import { SnapCarousel } from '../ui/SnapCarousel'
import { CutLine } from '../ui/CutLine'

// Páginas dos jogos gratuitos espalhadas sobre um bloco amarelo, passando dele (responsável, 2026-10-20). Só os
// gratuitos e numa imagem só, pequena demais para imprimir; dos pagos, nenhuma página (responsável, 2026-10-16).
// A linha de recorte entra aqui, logo depois da hero (DESIGN.md › The Three Cuts Rule).
export function ProductExperience() {
  return <section className="page-section experience-section" aria-labelledby="experiencia"><CutLine /><div className="content-width experience-layout">
    <figure className="experience-art"><div className="experience-pages"><img src="/media/experience/gratuitos-paginas-840.webp" srcSet="/media/experience/gratuitos-paginas-560.webp 560w, /media/experience/gratuitos-paginas-840.webp 840w, /media/experience/gratuitos-paginas-1120.webp 1120w" sizes="(max-width: 767px) calc(100vw - 32px), 560px" alt="Páginas da Hora dos Artistas e do Pote de Planos espalhadas sobre a mesa" width="1120" height="1000" loading="lazy" decoding="async" /></div><figcaption>Hora dos Artistas e Pote de Planos, <Link className="inline-link" to="/gratuitos">os jogos gratuitos</Link>.</figcaption></figure>
    <div className="experience-copy"><h2 id="experiencia" tabIndex={-1}>A próxima rodada sai da impressora.</h2><p className="lead">Cartas na mesa, uma tentativa duvidosa e aquela vontade de jogar de novo.</p><p>Um dia é desenho, no outro é tabuleiro ou investigação. Vocês imprimem em casa e o resto fica com a dupla.</p><Link className="button button-primary" to="/loja">Ver os jogos</Link></div>
  </div></section>
}

type Testimonial = (typeof experience.social.testimonials)[number]

// Nota em estrelas; o número vai em texto para leitores de tela.
function Stars({ rating }: { rating: number }) {
  return <div className="social-stars" role="img" aria-label={`Nota ${rating} de 5`}>{[1, 2, 3, 4, 5].map(star => <svg key={star} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" data-on={star <= rating || undefined}><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" /></svg>)}</div>
}

// Foto do casal. Sem foto autorizada, uma silhueta de dupla num fundo que varia por card (decorativa: o nome está ao lado).
function CouplePhoto({ item, tone }: { item: Testimonial; tone: number }) {
  if (item.photo) return <img className="social-photo" src={item.photo.src} alt={item.photo.alt} width="48" height="48" loading="lazy" decoding="async" />
  return <span className="social-photo" data-tone={tone} aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48"><g opacity=".55"><circle cx="17" cy="19" r="7" /><path d="M4 48c0-10 6-16 13-16s13 6 13 16z" /></g><circle cx="31" cy="22" r="7.5" /><path d="M17 50c0-10 6.5-16 14-16s14 6 14 16z" /></svg></span>
}

function TestimonialCard({ item, index, label }: { item: Testimonial; index: number; label: string }) {
  return <figure className="social-card" data-placeholder={item.placeholder ? 'true' : undefined}>
    <div className="social-card-top"><Stars rating={item.rating} />{item.placeholder && <span className="tag-solid">{label}</span>}</div>
    <blockquote>{item.quote}</blockquote>
    <figcaption><CouplePhoto item={item} tone={index % 4} /><span>{item.author}</span></figcaption>
  </figure>
}

// Relatos: placeholders só no stage test; em live só relatos reais, e sem nenhum a seção não existe (P0-1).
// A partir de 4 relatos, uma faixa de borda a borda desliza devagar e sem fim: a lista vai duas vezes (a cópia fica
// escondida dos leitores de tela e fora do foco) e o laço fecha em -50%. Cursor, foco e toque param a faixa; com
// movimento reduzido ela vira uma fileira que rola à mão. Com menos de 4, o carrossel de sempre.
export function Testimonials() {
  const social = experience.social
  const visible = siteConfig.stage === 'test' ? social.testimonials : social.testimonials.filter(item => !item.placeholder)
  if (!visible.length) return null
  const cards = (copy = false) => visible.map((item, index) => <li key={`${copy ? 'copia' : 'relato'}-${item.id}`} aria-hidden={copy || undefined} inert={copy || undefined}><TestimonialCard item={item} index={index} label={social.placeholderLabel} /></li>)
  return <section className="page-section social-section" aria-labelledby="social-title">
    <div className="content-width"><div className="section-heading"><h2 id="social-title">{social.heading}</h2></div></div>
    {visible.length >= 4
      ? <div className="social-marquee" role="region" aria-label="Relatos dos casais" tabIndex={0}><ul className="social-track" style={{ '--social-duration': `${visible.length * 9}s` } as CSSProperties}>{cards()}{cards(true)}</ul></div>
      : <div className="content-width"><SnapCarousel label="Relatos dos casais" className="social-carousel">{visible.map((item, index) => <TestimonialCard key={item.id} item={item} index={index} label={social.placeholderLabel} />)}</SnapCarousel></div>}
  </section>
}
