import { howItWorks } from '../../content/offer'

export function HowItWorks() {
  return <section className="page-section how-section" aria-labelledby="como-funciona"><div className="content-width">
    <div className="section-heading"><p className="eyebrow">Da ideia à mesa</p><h2 id="como-funciona" tabIndex={-1}>Como funciona</h2><p>Arquivos digitais, impressão e uma experiência escolhida por vocês.</p></div>
    <ol className="steps-list">{howItWorks.map((step, index) => <li key={step.title}><span className="step-number" aria-hidden="true">{index + 1}</span><h3>{step.title}</h3><p>{step.description}</p><p className="step-note">{step.note}</p></li>)}</ol>
    <a className="inline-link" href="/ajuda#impressao">Ver materiais e orientações de impressão <span aria-hidden="true">→</span></a>
  </div></section>
}
