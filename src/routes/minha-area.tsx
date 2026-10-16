import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../lib/auth-context'
import '../portal.css'

export default function MinhaArea() {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const tabs = useRef<HTMLElement>(null)
  const previousPath = useRef(pathname)
  const givenName = session?.user.user_metadata?.full_name
  const name = typeof givenName === 'string' ? givenName.trim().split(/\s+/)[0] : ''
  useEffect(() => {
    const current = tabs.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (current && tabs.current) tabs.current.scrollLeft = current.offsetLeft - tabs.current.offsetLeft - 16
    if (previousPath.current !== pathname) document.getElementById('portal-title')?.focus({ preventScroll: true })
    previousPath.current = pathname
  }, [pathname])
  return <main id="conteudo" tabIndex={-1} className="portal-page">
    <div className="portal-welcome content-width"><img src="/media/experience/kito-hi-128.webp" width="64" height="64" alt="" /><div><p className="portal-greeting">Olá{name ? `, ${name}` : ''}!</p><p className="portal-area-name">Minha área</p></div></div>
    <div className="portal-tabs-bar"><nav className="portal-tabs content-width" aria-label="Minha área" ref={tabs}>
      <NavLink to="/meus-jogos">Meus jogos</NavLink><NavLink to="/pedidos">Pedidos</NavLink><NavLink to="/conta">Minha conta</NavLink>
    </nav></div>
    <div className="portal-content content-width"><Outlet /></div>
  </main>
}
