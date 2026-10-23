import { IconArticle, IconChartBar, IconExternalLink, IconLogout, IconReceipt2, IconUsers } from '@tabler/icons-react'
import { NavLink, Outlet } from 'react-router'
import { SignOut } from './Screen'
import { useSession } from './session'
import { siteUrl } from './supabase'

// As seções do admin. As que ainda não existem ficam no grupo "Em breve" e levam a uma página que diz o que vem.
const sections = [
  { to: '/', label: 'Métricas', icon: IconChartBar, ready: true },
  { to: '/blog', label: 'Blog', icon: IconArticle, ready: false },
  { to: '/pedidos', label: 'Pedidos e reembolsos', icon: IconReceipt2, ready: false },
  { to: '/usuarios', label: 'Usuários', icon: IconUsers, ready: false },
] as const

const items = (ready: boolean) => sections.filter(section => section.ready === ready).map(({ to, label, icon: Icon }) => <li key={to}>
  <NavLink className="sidebar-item" to={to} end={to === '/'}><Icon aria-hidden="true" size={18} stroke={1.5} /><span>{label}</span></NavLink>
</li>)

export function Layout() {
  const session = useSession()
  return <div className="shell">
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <aside className="sidebar">
      <p className="sidebar-brand"><strong>KeyToTwo</strong><span>Admin</span></p>
      <nav aria-label="Seções do admin">
        <ul>{items(true)}</ul>
        <p className="sidebar-group" id="secoes-em-breve">Em breve</p>
        <ul aria-labelledby="secoes-em-breve">{items(false)}</ul>
      </nav>
      <div className="sidebar-account">
        <p title={session.user.email}>{session.user.email}</p>
        <a className="sidebar-item" href={siteUrl} target="_blank" rel="noopener"><IconExternalLink aria-hidden="true" size={18} stroke={1.5} /><span>Ver a loja</span><span className="sr-only"> (abre em nova aba)</span></a>
        <SignOut className="sidebar-item" icon={<IconLogout aria-hidden="true" size={18} stroke={1.5} />} />
      </div>
    </aside>
    <main className="content" id="conteudo" tabIndex={-1}><Outlet /></main>
  </div>
}
