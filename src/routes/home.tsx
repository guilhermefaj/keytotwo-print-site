import { Link, useLoaderData, useOutletContext } from 'react-router'
import { HeroScene } from '../components/HeroScene'
import { HowItWorks } from '../components/sections/HowItWorks'
import { FaqSection } from '../components/sections/FaqSection'
import { ClosingCta } from '../components/sections/ClosingCta'
import { ProductExperience, Testimonials } from '../components/sections/ExperienceSections'
import { ShopShowcase } from '../components/sections/ShopShowcase'
import { FreebieSection } from '../components/shop/FreebieSection'
import { experience } from '../content/experience'
import { useRef, useSyncExternalStore } from 'react'
import { useScrollReveal } from '../lib/use-scroll-reveal'
import { readBlogPosts, summarizeBlogPost } from '../lib/blog.server'
import { FromBlog } from '../components/sections/FromBlog'

export async function loader() {
  // Only published posts reach the home, including in stage=test.
  return { posts: (await readBlogPosts({ stage: 'live' })).slice(0, 3).map(summarizeBlogPost) }
}

export default function Home() {
  const { menuOpen } = useOutletContext<{ menuOpen: boolean }>()
  const { posts } = useLoaderData<typeof loader>()
  const main = useRef<HTMLElement>(null)
  // The highlight is the tail of the second headline line; the mark never changes the words.
  const headlineRest = experience.headline[1].endsWith(experience.highlight) ? experience.headline[1].slice(0, -experience.highlight.length) : `${experience.headline[1]} `
  // O reveal anima o conteúdo de cada folha, nunca o fundo da seção.
  useScrollReveal(main, '.page-section > .content-width')
  // Capa em comparação (temporário): a 2 por padrão; ?capa=N troca depois de abrir.
  const capaId = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get('capa'), () => null)
  const capa = experience.capas.find(item => item.id === capaId) ?? experience.capas[1]
  const largest = capa.widths[capa.widths.length - 1]
  return <main id="conteudo" tabIndex={-1} ref={main}>
    <div className="hero" data-tone={capa.tone} data-capa={capa.id}>
      {/* A foto é o maior elemento da hero no celular: prioridade alta, sem carregamento tardio (docs/desempenho.md). */}
      <div className="hero-media"><img key={capa.id} className="hero-photo" src={`/media/hero/${capa.photo}-${largest}.webp`} srcSet={capa.widths.map(width => `/media/hero/${capa.photo}-${width}.webp ${width}w`).join(', ')} sizes={capa.tone === 'escuro' ? '100vw' : '(max-width: 1023px) 100vw, 60vw'} width={largest} height={capa.height} alt={capa.alt} fetchPriority="high" decoding="async" /></div>
      <div className="hero-panel"><div className="hero-stack">
        <section className="hero-copy" aria-labelledby="hero-title">
          <h1 id="hero-title">{experience.headline[0]}{' '}<span>{headlineRest}<mark>{experience.highlight}</mark></span></h1>
          <p className="hero-description">{experience.description}</p>
          <div className="hero-actions"><Link className="button button-primary hero-cta" to={experience.cta.href}>{experience.cta.label}</Link><a className="inline-link hero-secondary" href={experience.secondary.href}>{experience.secondary.label}</a></div>
        </section>
      </div></div>
      <HeroScene obscured={menuOpen} />
    </div>
    {/* Início como landing (decisão 9): a oferta e a folha completa ficam só na Loja. */}
    <ProductExperience /><HowItWorks /><Testimonials /><ShopShowcase /><div className="page-section"><div className="content-width"><FreebieSection /></div></div><FaqSection /><FromBlog posts={posts} /><ClosingCta />
  </main>
}
