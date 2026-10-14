import { MobilePurchaseBar } from '../components/sections/MobilePurchaseBar'
import { useLoaderData, useOutletContext } from 'react-router'
import { HeroScene } from '../components/HeroScene'
import { HowItWorks } from '../components/sections/HowItWorks'
import { OfferSection } from '../components/sections/OfferSection'
import { FaqSection } from '../components/sections/FaqSection'
import { ClosingCta } from '../components/sections/ClosingCta'
import { ProductExperience, Testimonials } from '../components/sections/ExperienceSections'
import { experience } from '../content/experience'
import { useRef } from 'react'
import { useScrollReveal } from '../lib/use-scroll-reveal'
import { readBlogPosts, summarizeBlogPost } from '../lib/blog.server'
import { PackageGames } from '../components/sections/PackageGames'
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
  // Plano 001: o reveal anima o conteúdo de cada folha, nunca o fundo da seção.
  useScrollReveal(main, '.page-section > .content-width')
  return <main id="conteudo" tabIndex={-1} ref={main}>
    <div className="hero">
      <section className="hero-copy" aria-labelledby="hero-title">
        <p className="tag">{experience.tag}</p>
        <h1 id="hero-title">{experience.headline[0]}{' '}<span>{headlineRest}<mark>{experience.highlight}</mark></span></h1>
        <p className="hero-description">{experience.description}</p>
        <div className="hero-actions"><a className="button button-primary hero-cta" href={experience.cta.href}>{experience.cta.label}</a><a className="inline-link hero-secondary" href={experience.secondary.href}>{experience.secondary.label}</a></div>
      </section>
      <HeroScene obscured={menuOpen} />
    </div>
    <PackageGames /><ProductExperience /><HowItWorks /><Testimonials /><OfferSection /><FaqSection /><FromBlog posts={posts} /><ClosingCta /><MobilePurchaseBar menuOpen={menuOpen} />
  </main>
}
