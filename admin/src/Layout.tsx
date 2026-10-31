import { IconAlertTriangle, IconArticle, IconBox, IconChartBar, IconChevronDown, IconDiscount, IconExternalLink, IconLogout, IconReceipt2, IconSearch, IconUsers } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAlerts } from './alerts'
import { SignOut } from './Screen'
import { useSession } from './session'
import { siteUrl } from './supabase'

// As seções do admin: o resumo e o que precisa de atenção, as operações da loja e, por último, o conteúdo (revisão de
// usabilidade, 2026-10-24).
const sections = [
  { to: '/', label: 'Métricas', icon: IconChartBar },
  { to: '/atencao', label: 'Atenção', icon: IconAlertTriangle },
  { to: '/pedidos', label: 'Pedidos e reembolsos', icon: IconReceipt2 },
  { to: '/catalogo', label: 'Catálogo', icon: IconBox },
  { to: '/cupons', label: 'Cupons e parceiros', icon: IconDiscount },
  { to: '/usuarios', label: 'Usuários', icon: IconUsers },
  { to: '/blog', label: 'Blog', icon: IconArticle },
] as const

export function Layout() {
  const session = useSession()
  // Os alertas abertos: o número ao lado de Atenção; a página e as Métricas leem pelo contexto.
  const alerts = useAlerts()
  const open = (alerts.data ?? alerts.previous)?.open?.length ?? 0
  const { pathname } = useLocation()
  // No celular (revisão de UX, 2026-10-31) as seções ficam num menu "Seções", que fecha ao trocar de página; no lugar da
  // faixa que rolava de lado e escondia metade delas.
  const [menu, setMenu] = useState(false)
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMenu(false)
  }
  return <div className="shell">
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    <aside className="sidebar" data-open={menu}>
      <div className="sidebar-top">
        <p className="sidebar-brand"><strong>KeyToTwo</strong><span>Admin</span></p>
        <button className="sidebar-toggle" type="button" aria-expanded={menu} aria-controls="secoes-admin" onClick={() => setMenu(value => !value)}>
          Seções{open > 0 && <span className="sidebar-badge">{open}<span className="sr-only"> {open > 1 ? 'alertas abertos' : 'alerta aberto'}</span></span>}<IconChevronDown aria-hidden="true" size={16} stroke={2} />
        </button>
      </div>
      <div className="sidebar-body" id="secoes-admin">
        <QuickSearch />
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
      </div>
    </aside>
    <main className="content" id="conteudo" tabIndex={-1}><Outlet context={alerts} /></main>
  </div>
}

// Busca rápida (revisão de UX, 2026-10-31): de qualquer tela, um e-mail abre Usuários com a busca; o resto (o código do
// pedido) abre Pedidos, que também acha pelo e-mail.
function QuickSearch() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    const term = value.trim()
    if (!term) return
    navigate(`${term.includes('@') ? '/usuarios' : '/pedidos'}?${new URLSearchParams({ q: term })}`)
    setValue('')
  }
  return <form role="search" className="search-field sidebar-search" onSubmit={submit}>
    <IconSearch aria-hidden="true" size={16} stroke={1.75} />
    <label className="sr-only" htmlFor="busca-rapida">Busca rápida: pedido ou e-mail</label>
    <input id="busca-rapida" type="search" value={value} onChange={event => setValue(event.target.value)} placeholder="Pedido ou e-mail" autoComplete="off" spellCheck={false} enterKeyHint="search" />
  </form>
}
