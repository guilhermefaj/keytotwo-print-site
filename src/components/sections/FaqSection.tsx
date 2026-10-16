import { faq } from '../../content/faq'
import { Summary } from '../ui/Summary'

export function FaqSection() {
  return <section className="page-section faq-section" aria-labelledby="duvidas"><div className="content-width faq-layout">
    <div className="section-heading"><h2 id="duvidas" tabIndex={-1}>Dúvidas?</h2><p>Para chegar à mesa sem dúvidas.</p><a className="inline-link" href="/ajuda">Ir para Ajuda</a></div>
    <div className="faq-list">{faq.map(item => <details key={item.id} className="faq-item"><Summary>{item.question}</Summary><div className="faq-answer"><p>{item.answer}</p>{item.link && <a className="inline-link" href={item.link.href}>{item.link.label}</a>}</div></details>)}</div>
  </div></section>
}
