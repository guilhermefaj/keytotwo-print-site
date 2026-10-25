import { Link, useLoaderData, useOutletContext } from 'react-router'
import { HeroScene } from '../components/HeroScene'
import { HowItWorks } from '../components/sections/HowItWorks'
import { FaqSection } from '../components/sections/FaqSection'
import { ClosingCta } from '../components/sections/ClosingCta'
import { ProductExperience, Testimonials } from '../components/sections/ExperienceSections'
import { ShopShowcase } from '../components/sections/ShopShowcase'
import { FreebieSection } from '../components/shop/FreebieSection'
import { experience } from '../content/experience'
import { useRef } from 'react'
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
  return <main id="conteudo" tabIndex={-1} ref={main}>
    <div className="hero">
      {/* A foto é o maior elemento da hero no celular: prioridade alta, sem carregamento tardio (docs/desempenho.md). */}
      <div className="hero-media"><img className="hero-photo" src="/media/hero/foto-mesma-folha-1008.webp" srcSet="/media/hero/foto-mesma-folha-640.webp 640w, /media/hero/foto-mesma-folha-1008.webp 1008w" sizes="(max-width: 1023px) 100vw, 60vw" width="1008" height="567" alt={experience.photo.alt} fetchPriority="high" decoding="async" /></div>
      <div className="hero-panel"><div className="hero-stack">
        <section className="hero-copy" aria-labelledby="hero-title">
          <h1 id="hero-title">{experience.headline[0]}{' '}<span>{headlineRest}<mark>{experience.highlight}</mark></span></h1>
          <p className="hero-description">{experience.description}</p>
          <div className="hero-actions"><Link className="button button-primary hero-cta" to={experience.cta.href}>{experience.cta.label}</Link><a className="inline-link hero-secondary" href={experience.secondary.href}>{experience.secondary.label}</a></div>
        </section>
        <HeroScene obscured={menuOpen} />
      </div></div>
    </div>
    {/* Início como landing (decisão 9): a oferta e a folha completa ficam só na Loja. */}
    <ProductExperience /><HowItWorks /><Testimonials /><ShopShowcase /><div className="page-section"><div className="content-width"><FreebieSection /></div></div><FaqSection /><FromBlog posts={posts} /><ClosingCta />
  </main>
}
