import { games } from '../../content/games'
import { GameCover } from '../account/GameCover'
import { SnapCarousel } from '../ui/SnapCarousel'
import '../../carousels.css'

export function PackageGames() {
  return <section className="page-section package-games" aria-labelledby="package-games-title"><div className="content-width">
    <div className="section-heading"><p className="eyebrow">Dentro do pacote</p><h2 id="package-games-title">Cinco jogos para puxar uma cadeira.</h2><p>Uma prévia do que vai para a mesa de vocês.</p></div>
    <SnapCarousel label="Jogos do pacote" className="games-carousel">{games.map((game, index) => <article className="package-game" key={game.id} aria-label={`Jogo ${index + 1} de 5`}>
      <GameCover code={`J00${index + 1}`} /><div className="package-game-copy"><span className="game-number">{String(index + 1).padStart(2, '0')}</span><h3>{game.confirmed ? game.name : 'Em breve'}</h3><p>{index === 0 ? 'Um desenha, o outro adivinha. Os acertos são da dupla.' : game.confirmed ? 'Detalhes e prévia em breve.' : 'Estamos preparando este jogo para o pacote.'}</p>{index === 0 && <a className="inline-link" href="/#experiencia">Ver a prévia</a>}</div>
    </article>)}</SnapCarousel>
  </div></section>
}
