import { Link } from 'react-router'
import { KitoEmpty } from '../components/ui/KitoEmpty'

export default function NotFound() {
  return <main id="conteudo" tabIndex={-1} className="not-found-page content-width">
    <KitoEmpty />
    <div><h1>Página não encontrada</h1><p>O endereço solicitado não está disponível.</p><Link className="button button-primary" to="/">Voltar ao início</Link></div>
  </main>
}
