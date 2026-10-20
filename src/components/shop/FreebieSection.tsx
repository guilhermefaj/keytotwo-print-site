import { Link } from 'react-router'
import { freebies } from '../../content/games'
import { experience } from '../../content/experience'
import { GameCard } from './GameGrid'

// Atalho para a página Gratuitos, na Loja e no Início: os cards só apresentam os jogos; baixar é lá.
export function FreebieSection() {
  const { tag, title, text, cta } = experience.freebie
  return <section className="shop-freebies" aria-labelledby="freebies-title" data-shop-freebies>
    <div className="shop-freebies-heading"><p className="tag">{tag}</p><h2 id="freebies-title">{title}</h2><p>{text}</p><Link className="button button-primary shop-freebie-cta" to={cta.href}>{cta.label}</Link></div>
    <ul className="shop-game-grid">{freebies.filter(game => game.confirmed).map(game => <GameCard key={game.id} game={game}>
      <div className="shop-availability"><p className="shop-price">Grátis</p></div>
    </GameCard>)}</ul>
  </section>
}
