import { Link } from 'react-router'

export default function NotFound() {
  return <main id="conteudo" tabIndex={-1} className="not-found-page content-width">
    <span className="kito-still" aria-hidden="true" />
    <div><h1>Página não encontrada</h1><p>O endereço solicitado não está disponível.</p><Link className="button button-primary" to="/">Voltar ao início</Link></div>
  </main>
}
