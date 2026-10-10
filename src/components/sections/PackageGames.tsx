import { games, j001 } from '../../content/games'
import { GameCover } from '../account/GameCover'
import { SnapCarousel } from '../ui/SnapCarousel'
import '../../carousels.css'
import { CutLine } from '../ui/CutLine'

// Folha de cartas (DESIGN.md › Folha): os jogos do pacote como cartas para recortar. Os cinco
// ficam visíveis no desktop; abaixo de 768 px a mesma trilha vira carrossel por snap (P2-2).
// A ordem é editorial, não uma sequência: sem numeração (P2-1).
export function PackageGames() {
  return <section className="page-section package-games" aria-labelledby="package-games-title"><CutLine /><div className="content-width">
    <div className="folha-topo">
      <div className="section-heading"><h2 id="package-games-title">Cinco jogos para puxar uma cadeira.</h2><p>Uma prévia do que vai para a mesa de vocês.</p></div>
      <div className="folha-ficha"><p className="ficha-titulo">{games[0].name}</p><dl className="ficha">{j001.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></div>
    </div>
    <SnapCarousel label="Jogos do pacote" className="games-carousel folha crop-marks">{games.map((game, index) => <figure className="package-game" key={game.id} aria-label={game.confirmed ? game.name : 'Jogo em preparação'}>
      <GameCover code={`J00${index + 1}`} name={game.confirmed ? game.name : 'Em breve'} seal={game.confirmed ? 'No pacote' : undefined} soon={!game.confirmed} />
      <figcaption className="package-game-copy">{game.confirmed && <h3>{game.name}</h3>}<p>{index === 0 ? 'Um desenha, o outro adivinha. Os acertos são da dupla.' : game.confirmed ? 'Detalhes e prévia em breve.' : 'Estamos preparando este jogo para o pacote.'}</p>{index === 0 && <a className="inline-link" href="/#experiencia">Ver a prévia</a>}</figcaption>
    </figure>)}</SnapCarousel>
  </div></section>
}
