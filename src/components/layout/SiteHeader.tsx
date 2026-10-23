import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate, useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../../root'
import { IconChevronDown, IconLock, IconMenu2, IconShoppingBag } from '@tabler/icons-react'
import { navigation } from '../../content/site'
import { siteConfig } from '../../lib/seo'
import { adminUrl, isAdmin, useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { reloadOnStaleChunk } from '../../lib/stale-chunk'
import { authErrorMessage, supabase } from '../../lib/supabase'
import { Icon } from '../ui/Icon'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet'

// Uma aba aberta antes de uma publicação recarrega na versão nova em vez de cair na página de erro.
const CartDrawer = lazy(() => import('./CartDrawer').then(module => ({ default: module.CartDrawer }), reloadOnStaleChunk))

// Portal (a área da conta, antes "Minha área"): cabeçalho simplificado, sem estímulo comercial. No desktop
// as abas do Portal já levam a Meus jogos, Pedidos e Minha conta, então o cabeçalho fica com logo, Portal e a
// conta. O menu móvel mantém os três links. No desktop, quem entrou vê "Portal" e quem não entrou vê só
// "Entrar"; a Ajuda fica no rodapé e no menu móvel (responsável, 2026-10-21).
const privateRoutes = ['/meus-jogos', '/pedidos', '/conta']
const privateNavigation = [
  { label: 'Meus jogos', href: '/meus-jogos' },
  { label: 'Minha conta', href: '/conta' },
  { label: 'Ajuda', href: '/ajuda' },
] as const

export function SiteHeader({ onMenuOpenChange }: { onMenuOpenChange?: (open: boolean) => void }) {
  const { session, ready } = useAuth()
  const { cart, cartOpen, setCartOpen } = useShop()
  const { hasBlogPosts } = useRouteLoaderData<typeof rootLoader>('root')!
  const location = useLocation()
  // Prerender URLs may end in a slash; the server and hydrated header must agree.
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const [scroll, setScroll] = useState({ scrolled: false, hidden: false })
  const accountMenu = useRef<HTMLDivElement>(null)
  const accountTrigger = useRef<HTMLButtonElement>(null)
  const home = pathname === '/'
  const focusMode = pathname === '/pagamento'
  const privateArea = privateRoutes.includes(pathname)
  const mainNavigation = navigation.filter(item => item.href !== '/blog' || hasBlogPosts)
  const visibleNavigation: ReadonlyArray<{ label: string; href: string }> = privateArea ? privateNavigation : mainNavigation
  const showCart = siteConfig.showCartAccess && !privateArea
  const count = cart.data?.items.length ?? 0
  // Com a sacola já na tela (inclusive a prévia de um item que acabou de entrar), a contagem aparece sem esperar a API.
  const counting = cart.loading && !cart.data
  const cartLabel = cart.error ? 'Sacola, não foi possível atualizar' : counting ? 'Sacola, carregando itens' : `Sacola, ${count} ${count === 1 ? 'item' : 'itens'}`
  const initial = session?.user.email?.charAt(0).toLocaleUpperCase('pt-BR') || 'K'
  const admin = isAdmin(session)

  useEffect(() => { onMenuOpenChange?.(open || cartOpen) }, [open, cartOpen, onMenuOpenChange])
  useEffect(() => {
    let previous = window.scrollY, frame = 0
    const update = () => {
      const y = Math.max(0, window.scrollY), delta = y - previous
      setScroll(current => {
        const hidden = y < 80 ? false : Math.abs(delta) > 6 ? delta > 0 : current.hidden
        return current.scrolled === (y > 24) && current.hidden === hidden ? current : { scrolled: y > 24, hidden }
      })
      if (Math.abs(delta) > 6) previous = y
      frame = 0
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])
  useEffect(() => {
    if (!accountOpen) return
    const outside = (event: PointerEvent) => { if (!accountMenu.current?.contains(event.target as Node)) setAccountOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); accountTrigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [accountOpen])

  async function signOut() {
    setSigningOut(true); setError('')
    try {
      const { error } = await supabase().auth.signOut({ scope: 'local' })
      if (error) throw error
      setAccountOpen(false); setOpen(false); setCartOpen(false)
      await navigate('/')
    } catch (cause) { setError(authErrorMessage(cause)) }
    finally { setSigningOut(false) }
  }
  function active(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }
  function current(href: string) { return active(href) ? 'page' : undefined }

  const cartButton = <button className="icon-button cart-trigger" disabled={!ready} aria-label={cartLabel} aria-haspopup="dialog" onClick={() => setCartOpen(true)}><Icon component={IconShoppingBag} size={24} />{(counting || cart.error || count > 0) && <span className="cart-count" aria-hidden="true">{counting || cart.error ? '…' : count}</span>}</button>
  const accountControl = session ? <div className="account-menu" ref={accountMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }}>
    <button className="account-trigger" ref={accountTrigger} aria-label="Abrir opções da conta" aria-expanded={accountOpen} aria-controls="account-options" onClick={() => setAccountOpen(value => !value)}><span className="account-initial" aria-hidden="true">{initial}</span><Icon component={IconChevronDown} size={16} /></button>
    {accountOpen && <div className="account-options" id="account-options"><nav aria-label="Sua conta"><Link className="nav-link" to="/meus-jogos" onClick={() => setAccountOpen(false)}>Meus jogos</Link><Link className="nav-link" to="/conta" onClick={() => setAccountOpen(false)}>Minha conta</Link>{admin && <a className="nav-link" href={adminUrl}>Painel</a>}<button className="text-button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Saindo…' : 'Sair'}</button></nav><p className="form-error" role="alert">{error}</p></div>}
  </div> : <Link className="nav-link" aria-current={pathname === '/entrar' ? 'page' : undefined} to="/entrar">Entrar</Link>

  return <>
    <header className="site-header-shell" data-home={home} data-scrolled={scroll.scrolled || !home} data-hidden={scroll.hidden && !open && !cartOpen && !accountOpen} data-focus={focusMode} data-private={privateArea}>
      <div className="site-header">
        <Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" alt="KeyToTwo" width="420" height="97" fetchPriority="low" /></Link>
        {focusMode ? <><span className="checkout-secure"><Icon component={IconLock} size={16} />Compra segura</span><Link className="text-button checkout-back" to="/carrinho">Voltar à sacola</Link></> : <>
          {!privateArea && <nav className="desktop-nav" aria-label="Navegação principal">{visibleNavigation.map(item => <Link className="nav-link" aria-current={current(item.href)} key={item.href} to={item.href}>{item.label}</Link>)}</nav>}
          <div className="desktop-action">
            {session && <Link className="nav-link" to="/meus-jogos" aria-current={pathname === '/meus-jogos' ? 'page' : privateArea ? 'true' : undefined}>Portal</Link>}
            {accountControl}
            {showCart && cartButton}
          </div>
          <div className="mobile-navigation">
            {showCart && cartButton}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild><button className="icon-button menu-trigger" disabled={!ready} aria-label="Abrir menu"><Icon component={IconMenu2} />Menu</button></SheetTrigger>
              <SheetContent className="mobile-menu-sheet">
                <div className="sheet-account"><SheetTitle className="sheet-title">{session ? 'Olá!' : 'Entre e fique à vontade.'}</SheetTitle><SheetDescription className="sheet-description">{session ? 'Tudo o que vocês compraram fica em Meus jogos.' : 'Seus jogos ficam guardados na sua conta.'}</SheetDescription>
                  <div className="sheet-account-links">{session ? <><span className="account-initial" aria-hidden="true">{initial}</span>{!privateArea && <SheetClose asChild><Link className="inline-link" to="/conta">Minha conta</Link></SheetClose>}<button className="text-button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Saindo…' : 'Sair'}</button></> : <SheetClose asChild><Link className="inline-link" to="/entrar">Entrar</Link></SheetClose>}</div><p className="form-error" role="alert">{error}</p>
                </div>
                <nav className="sheet-nav" aria-label="Navegação mobile">{visibleNavigation.map((item, index) => <SheetClose asChild key={item.href}><Link className="nav-link" style={{ '--link-order': index } as CSSProperties} aria-current={current(item.href)} to={item.href}>{item.label}</Link></SheetClose>)}
                  {session && !privateArea && <SheetClose asChild><Link className="nav-link" to="/meus-jogos" aria-current={pathname === '/meus-jogos' ? 'page' : undefined}>Meus jogos</Link></SheetClose>}
                  {admin && <a className="nav-link" href={adminUrl}>Painel</a>}
                </nav>
                {!privateArea && <SheetClose asChild><Link className="sheet-help" to="/ajuda" aria-current={pathname === '/ajuda' ? 'page' : undefined}><span>Ajuda</span></Link></SheetClose>}
                <div className="sheet-bottom"><div className="sheet-legal"><SheetClose asChild><Link to="/termos">Termos de uso</Link></SheetClose><SheetClose asChild><Link to="/privacidade">Privacidade</Link></SheetClose></div></div>
              </SheetContent>
            </Sheet>
          </div>
        </>}
      </div>
    </header>
    {cartOpen && <Suspense fallback={null}><CartDrawer /></Suspense>}
  </>
}
