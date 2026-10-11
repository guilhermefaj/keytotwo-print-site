import { products } from '../../content/products'
import { GameCover } from '../account/GameCover'
import { SnapCarousel } from '../ui/SnapCarousel'
import { CutLine } from '../ui/CutLine'
import '../../carousels.css'

// Folha de cartas (DESIGN.md › Folha): os jogos do produto como cartas para recortar. Os cinco
// ficam visíveis no desktop; abaixo de 768 px a mesma trilha vira carrossel por snap (P2-2).
// A ordem é editorial, não uma sequência: sem numeração (P2-1). Tudo vem dos dados do produto.
export function PackageGames() {
  const product = products[0]
  const featured = product.games.find(game => game.facts)
  return <section className="page-section package-games" aria-labelledby="package-games-title"><CutLine /><div className="content-width">
    <div className="folha-topo">
      <div className="section-heading"><h2 id="package-games-title">Cinco jogos para puxar uma cadeira.</h2><p>Uma prévia do que vai para a mesa de vocês.</p></div>
      {featured?.facts && <div className="folha-ficha"><p className="ficha-titulo">{featured.name}</p><dl className="ficha">{featured.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></div>}
    </div>
    <SnapCarousel label="Jogos do pacote" className="games-carousel folha crop-marks">{product.games.map(game => <figure className="package-game" key={game.id} aria-label={game.confirmed ? game.name : 'Jogo em preparação'}>
      <GameCover code={game.code} name={game.confirmed ? game.name : 'Em breve'} seal={game.confirmed ? 'No pacote' : undefined} soon={!game.confirmed} />
      <figcaption className="package-game-copy">{game.confirmed && <h3>{game.name}</h3>}<p>{game.summary}</p>{game.preview && <a className="inline-link" href={game.preview.href}>{game.preview.label}</a>}</figcaption>
    </figure>)}</SnapCarousel>
  </div></section>
}
