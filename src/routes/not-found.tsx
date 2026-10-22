import { Link } from 'react-router'

export default function NotFound() {
  return <main id="conteudo" tabIndex={-1} className="not-found-page content-width">
    <span className="kito-dizzy" aria-hidden="true" />
    <div><h1>Página não encontrada</h1><p>O Kito procurou por todo canto e não achou nada neste endereço.</p><Link className="button button-primary" to="/">Voltar ao início</Link></div>
  </main>
}
