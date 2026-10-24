import { IconAlertTriangle, IconArticle, IconChartBar, IconExternalLink, IconLogout, IconReceipt2, IconUsers } from '@tabler/icons-react'
import { NavLink, Outlet } from 'react-router'
import { useAlerts } from './alerts'
import { SignOut } from './Screen'
import { useSession } from './session'
import { siteUrl } from './supabase'

// As seções do admin (as quatro fases do plano de 2026-10-23 existem desde a Fase 3, 2026-10-24; Atenção, 2026-10-24).
const sections = [
  { to: '/', label: 'Métricas', icon: IconChartBar },
  { to: '/atencao', label: 'Atenção', icon: IconAlertTriangle },
  { to: '/blog', label: 'Blog', icon: IconArticle },
  { to: '/pedidos', label: 'Pedidos e reembolsos', icon: IconReceipt2 },
  { to: '/usuarios', label: 'Usuários', icon: IconUsers },
] as const

export function Layout() {
  const session = useSession()
  // Os alertas abertos: o número ao lado de Atenção; a página e as Métricas leem pelo contexto.
  const alerts = useAlerts()
  const open = (alerts.data ?? alerts.previous)?.open?.length ?? 0
  return <div className="shell">
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <aside className="sidebar">
      <p className="sidebar-brand"><strong>KeyToTwo</strong><span>Admin</span></p>
      <nav aria-label="Seções do admin">
        <ul>{sections.map(({ to, label, icon: Icon }) => <li key={to}>
          <NavLink className="sidebar-item" to={to} end={to === '/'}><Icon aria-hidden="true" size={18} stroke={1.5} /><span>{label}</span>
            {to === '/atencao' && open > 0 && <span className="sidebar-badge">{open}<span className="sr-only"> {open > 1 ? 'abertos' : 'aberto'}</span></span>}
          </NavLink>
        </li>)}</ul>
      </nav>
      <div className="sidebar-account">
        <p title={session.user.email}>{session.user.email}</p>
        <a className="sidebar-item" href={siteUrl} target="_blank" rel="noopener"><IconExternalLink aria-hidden="true" size={18} stroke={1.5} /><span>Ver a loja</span><span className="sr-only"> (abre em nova aba)</span></a>
        <SignOut className="sidebar-item" icon={<IconLogout aria-hidden="true" size={18} stroke={1.5} />} />
      </div>
    </aside>
    <main className="content" id="conteudo" tabIndex={-1}><Outlet context={alerts} /></main>
  </div>
}
