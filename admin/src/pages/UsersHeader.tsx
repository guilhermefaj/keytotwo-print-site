import { NavLink } from 'react-router'

// Cabeçalho de Usuários (2026-10-23): o título e as abas Contas | Acompanhamento | Equipe. Cada aba é um endereço,
// então dá para voltar e compartilhar o link; a ficha de uma conta não tem abas (tem o link de volta).
const tabs = [
  { to: '/usuarios', label: 'Contas', end: true },
  { to: '/usuarios/acompanhamento', label: 'Acompanhamento', end: false },
  { to: '/usuarios/equipe', label: 'Equipe', end: false },
]

export function UsersHeader({ text }: { text: string }) {
  return <>
    <header className="page-heading users-heading">
      <h1>Usuários</h1>
      <p>{text}</p>
    </header>
    <nav className="section-tabs" aria-label="Usuários">
      {tabs.map(tab => <NavLink key={tab.to} to={tab.to} end={tab.end}>{tab.label}</NavLink>)}
    </nav>
  </>
}
