import { Link } from 'react-router'

export function ClosingCta() {
  return <section className="page-section closing-section" aria-labelledby="closing-title"><div className="content-width"><h2 id="closing-title">Hoje tem<br /><span>um encontro marcado.</span></h2><Link className="button button-primary" to="/loja">Ver os jogos</Link><p className="closing-note">O sofá continua lá. A ideia é fazer algo juntos.</p></div></section>
}
