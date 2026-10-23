import { IconArticle, IconChartBar, IconExternalLink, IconReceipt2, IconUsers } from '@tabler/icons-react'
import { NavLink, Outlet } from 'react-router'
import { SignOut } from './Screen'
import { useSession } from './session'
import { siteUrl } from './supabase'
import logo from '../../public/media/hero/keytotwo-logo.webp'

// As seções do admin. As que ainda não existem aparecem como "Em breve" e levam a uma página que diz o que vem.
const sections = [
  { to: '/', label: 'Métricas', icon: IconChartBar, ready: true },
  { to: '/blog', label: 'Blog', icon: IconArticle, ready: false },
  { to: '/pedidos', label: 'Pedidos e reembolsos', icon: IconReceipt2, ready: false },
  { to: '/usuarios', label: 'Usuários', icon: IconUsers, ready: false },
] as const

export function Layout() {
  const session = useSession()
  return <div className="shell">
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <aside className="sidebar">
      <div className="sidebar-brand"><img src={logo} width="420" height="97" alt="KeyToTwo" /><span className="tag">Admin</span></div>
      <nav aria-label="Seções do admin"><ul>{sections.map(({ to, label, icon: Icon, ready }) => <li key={to}>
        <NavLink to={to} end={to === '/'}><Icon aria-hidden="true" size={20} stroke={1.75} /><span>{label}</span>{!ready && <span className="soon">Em breve</span>}</NavLink>
      </li>)}</ul></nav>
      <div className="sidebar-account">
        <p title={session.user.email}>{session.user.email}</p>
        <a href={siteUrl} target="_blank" rel="noopener">Ver a loja<IconExternalLink aria-hidden="true" size={16} stroke={1.75} /><span className="sr-only"> (abre em nova aba)</span></a>
        <SignOut />
      </div>
    </aside>
    <main className="content" id="conteudo" tabIndex={-1}><Outlet /></main>
  </div>
}
