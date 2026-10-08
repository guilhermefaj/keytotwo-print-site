import { games, j001 } from '../../content/games'

export function GamesSection() {
  return <section className="page-section games-section" aria-labelledby="jogos">
    <div className="content-width">
      <div className="section-heading"><p className="eyebrow">O que vem no pacote</p><h2 id="jogos" tabIndex={-1}>Os 5 jogos</h2><p>Três nomes confirmados. Duas experiências ainda a definir. Conheça o que já está documentado.</p></div>
      <div className="games-list">
        {games.map((game, index) => <article className={`game-entry${index === 0 ? ' game-featured' : ''}${!game.confirmed ? ' game-unconfirmed' : ''}`} key={game.id} aria-labelledby={`${game.id}-title`}>
          <div className="game-copy"><p className="game-status">{game.confirmed ? 'No pacote' : 'PENDENTE · composição'}</p><h3 id={`${game.id}-title`}>{game.name}</h3><p>{game.description}</p><p className="pending-copy">{game.pending}</p></div>
          {index === 0 && <div className="game-specs">
            <dl className="game-facts">{j001.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
            <details className="game-details"><summary>Ver como é Rabisque e Adivinhe</summary><div><p>{j001.rules}</p><p>{j001.preparation}</p><p>{j001.duration}</p></div></details>
          </div>}
        </article>)}
      </div>
    </div>
  </section>
}
