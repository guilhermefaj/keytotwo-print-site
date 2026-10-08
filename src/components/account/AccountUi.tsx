import { NavLink } from 'react-router'

export function AccountNav() {
  return <nav className="account-nav" aria-label="Sua conta"><NavLink to="/conta">Conta</NavLink><NavLink to="/meus-jogos">Meus jogos</NavLink><NavLink to="/carrinho">Carrinho</NavLink></nav>
}

export function DataStatus({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  if (loading) return <p role="status">Carregando seus dados…</p>
  if (error) return <div className="data-error"><p role="alert">{error}</p><button className="button button-secondary" onClick={retry}>Tentar novamente</button></div>
  return null
}
