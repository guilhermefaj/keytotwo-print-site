import { site } from '../../content/site'

export function ClosingCta() {
  return <section className="closing-section page-section" aria-labelledby="closing-title"><div className="content-width"><p className="eyebrow">KeyToTwo</p><h2 id="closing-title">{site.closing}</h2><a className="button button-primary" href="/#comprar">Ver pacote <span aria-hidden="true">→</span></a></div></section>
}
