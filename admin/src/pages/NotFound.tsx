import { Link } from 'react-router'

export function NotFoundPage() {
  return <>
    <title>Página não encontrada — Admin KeyToTwo</title>
    <header className="page-heading"><h1>Página não encontrada</h1><p>Este endereço não existe no admin.</p></header>
    <Link className="button button-secondary" to="/">Ir para as métricas</Link>
  </>
}
