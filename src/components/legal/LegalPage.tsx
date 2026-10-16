import { Link } from 'react-router'
import type { LegalContent } from '../../content/legal'
import { BackLink } from '../ui/BackLink'

export function LegalPage({ content }: { content: LegalContent }) {
  return <main id="conteudo" tabIndex={-1} className="reading-page content-width">
    <BackLink to="/">Voltar ao início</BackLink>
    <h1>{content.title}</h1><p className="legal-pending">Esta página está em preparação. O texto final será publicado após validação jurídica, antes da abertura das compras.</p>
    {content.sections.filter(section => section.paragraphs.some(paragraph => !paragraph.startsWith('PENDENTE:'))).map(section => <section key={section.title}><h2 id={section.id} tabIndex={-1}>{section.title}</h2>{section.paragraphs.filter(paragraph => !paragraph.startsWith('PENDENTE:')).map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}
    <nav className="legal-links" aria-label="Outras informações"><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link><Link to="/ajuda#contato">Atendimento</Link></nav>
  </main>
}
