import { Link } from 'react-router'
import { help } from '../content/help'

export default function Ajuda() {
  return <main id="conteudo" tabIndex={-1} className="reading-page content-width">
    <Link className="inline-link" to="/">Voltar ao início</Link><p className="eyebrow">Para levar à mesa</p><h1>Ajuda</h1><p className="reading-intro">Vamos preparar o próximo encontro? Encontre aqui orientações sobre sua conta, compra e impressão.</p>
    <nav className="help-index" aria-label="Nesta página">{help.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
    {help.map(section => <section key={section.id}><h2 id={section.id} tabIndex={-1}>{section.title}</h2>{section.paragraphs.filter(paragraph => !paragraph.startsWith('PENDENTE:')).map(paragraph => <p key={paragraph}>{paragraph}</p>)}{section.id === 'contato' && <p>Estamos preparando nosso canal de atendimento.</p>}</section>)}
  </main>
}
