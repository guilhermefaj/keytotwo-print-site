import { experience } from '../../content/experience'

export function HowItWorks() {
  return <section className="page-section how-section" aria-labelledby="como-funciona"><div className="content-width">
    <div className="section-heading centered-heading"><p className="eyebrow">Da tela para a mesa</p><h2 id="como-funciona" tabIndex={-1}>O encontro começa assim.</h2></div>
    <ol className="steps-list">{experience.steps.map((step, index) => <li key={step.title}><span className="step-number" aria-hidden="true">0{index + 1}</span><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
  </div></section>
}
