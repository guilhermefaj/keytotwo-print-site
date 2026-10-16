import { Link } from 'react-router'
import { freebies } from '../../content/games'
import { experience } from '../../content/experience'
import { useAuth } from '../../lib/auth-context'
import { siteConfig } from '../../lib/seo'
import { GameCard } from './GameGrid'

// Jogos grátis ao criar a conta (decisão do responsável, 2026-10-16), na Loja e no Início.
// O resgate é backend e vem depois; até lá a seção só aparece no stage test.
export const showFreebies = siteConfig.stage === 'test'

export function FreebieSection() {
  const { tag, title, text, cta } = experience.freebie
  // Quem já entrou não precisa criar conta; o card fica só com o preço.
  const { session } = useAuth()
  return <section className="shop-freebies" aria-labelledby="freebies-title" data-shop-freebies>
    <div className="shop-freebies-heading"><p className="tag">{tag}</p><h2 id="freebies-title">{title}</h2><p>{text}</p></div>
    <ul className="shop-game-grid">{freebies.map(game => <GameCard key={game.id} game={game}>
      {game.confirmed && <div className="shop-availability"><p className="shop-price">Grátis</p>{!session && <Link className="button button-primary shop-freebie-cta" to={cta.href}>{cta.label}</Link>}</div>}
    </GameCard>)}</ul>
  </section>
}
