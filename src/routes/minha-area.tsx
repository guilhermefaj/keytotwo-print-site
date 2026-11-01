import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../lib/auth-context'
import { useShop } from '../lib/shop-context'

export default function MinhaArea() {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const tabs = useRef<HTMLElement>(null)
  const previousPath = useRef(pathname)
  const { account } = useShop()
  // O nome salvo em Minha conta; enquanto a conta carrega, o do Google (o mesmo que o perfil sugere).
  const profile = account.data?.profile
  const givenName = profile ? profile.name : session?.user.user_metadata?.full_name
  const name = typeof givenName === 'string' ? givenName.trim().split(/\s+/)[0] : ''
  useEffect(() => {
    const current = tabs.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (current && tabs.current) tabs.current.scrollLeft = current.offsetLeft - tabs.current.offsetLeft - 16
    if (previousPath.current !== pathname) document.getElementById('portal-title')?.focus({ preventScroll: true })
    previousPath.current = pathname
  }, [pathname])
  // O Kito acenando (pixel art do PixelLab, k08 de frente) num círculo Céu com o fio Turquesa (responsável, 2026-10-31).
  // Reduzido com suavização a partir do original de 256 px: 100, 150 e 200 px para cada densidade de tela.
  return <main id="conteudo" tabIndex={-1} className="portal-page">
    <div className="portal-welcome content-width">
      <span className="portal-avatar" aria-hidden="true"><img src="/media/portal/kito-ola-100.webp" srcSet="/media/portal/kito-ola-100.webp 100w, /media/portal/kito-ola-150.webp 150w, /media/portal/kito-ola-200.webp 200w" sizes="(max-width: 600px) 40px, 50px" width="50" height="49" alt="" /></span>
      <div><p className="portal-greeting">Olá{name ? `, ${name}` : ''}!</p><p className="portal-area-name">Portal</p></div>
    </div>
    <div className="portal-tabs-bar"><nav className="portal-tabs content-width" aria-label="Portal" ref={tabs}>
      <NavLink to="/meus-jogos">Meus jogos</NavLink><NavLink to="/pedidos">Pedidos</NavLink><NavLink to="/conta">Minha conta</NavLink>
    </nav></div>
    <div className="portal-content content-width"><Outlet /></div>
  </main>
}
