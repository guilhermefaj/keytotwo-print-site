import { Link } from 'react-router'
import type { LegalContent } from '../../content/legal'
import { BackLink } from '../ui/BackLink'

// Texto jurídico versionado: versão e data no topo, índice das seções e, no fim, os outros documentos.
export function LegalPage({ content }: { content: LegalContent }) {
  return <main id="conteudo" tabIndex={-1} className="reading-page content-width">
    <BackLink to="/">Voltar ao início</BackLink>
    <h1>{content.title}</h1>
    <p className="field-help"><time dateTime={content.version}>{content.versionLabel}</time></p>
    <p className="reading-intro">{content.intro}</p>
    <nav aria-label="Nesta página"><ol className="legal-index">{content.sections.map(section => <li key={section.id}><a className="inline-link" href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav>
    {content.sections.map(section => <section key={section.id}><h2 id={section.id} tabIndex={-1}>{section.title}</h2>
      {section.paragraphs.map(block => typeof block === 'string'
        ? <p key={block}>{block}</p>
        : <ul key={block.join('|')}>{block.map(item => <li key={item}>{item}</li>)}</ul>)}
    </section>)}
    <nav className="legal-links" aria-label="Outras informações"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Política de reembolso</Link><Link to="/privacidade">Privacidade</Link><Link to="/ajuda#contato">Atendimento</Link></nav>
  </main>
}
