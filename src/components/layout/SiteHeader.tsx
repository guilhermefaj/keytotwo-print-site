import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { navigation } from '../../content/site'
import { siteConfig } from '../../lib/seo'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { authErrorMessage, supabase } from '../../lib/supabase'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet'

const CartDrawer = lazy(() => import('./CartDrawer').then(module => ({ default: module.CartDrawer })))

function CartIcon() {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 3h2l3 12h11l2-8H6M10 20h.01M18 20h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function SiteHeader({ onMenuOpenChange }: { onMenuOpenChange?: (open: boolean) => void }) {
  const { session, ready } = useAuth()
  const { cart, account, freeGame, cartOpen, setCartOpen } = useShop()
  const location = useLocation()
  // Prerender URLs may end in a slash; the server and hydrated header must agree.
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  const { hash } = location
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const [scroll, setScroll] = useState({ scrolled: false, hidden: false, section: '' })
  const anchorDestination = useRef<string | null>(null)
  const accountMenu = useRef<HTMLDivElement>(null)
  const accountTrigger = useRef<HTMLButtonElement>(null)
  const home = pathname === '/'
  const focusMode = pathname === '/pagamento'
  const ownsPackage = account.data?.orders.some(order => order.status === 'paid' && order.items.some(item => item.code === 'P001')) ?? false
  const primary = ownsPackage ? { label: 'Meus jogos', href: '/meus-jogos' } : { label: 'Quero o pacote', href: '/#comprar' }
  const visibleNavigation = freeGame.data?.available ? [...navigation, { label: 'Jogo grátis', href: '/jogo-gratuito' }] : navigation
  const count = cart.data?.items.length ?? 0
  const cartLabel = cart.error ? 'Carrinho, não foi possível atualizar' : cart.loading ? 'Carrinho, carregando itens' : `Carrinho, ${count} ${count === 1 ? 'item' : 'itens'}`
  const initial = session?.user.email?.charAt(0).toLocaleUpperCase('pt-BR') || 'K'

  useEffect(() => { onMenuOpenChange?.(open || cartOpen) }, [open, cartOpen, onMenuOpenChange])
  useEffect(() => {
    let previous = window.scrollY, frame = 0
    const update = () => {
      const y = Math.max(0, window.scrollY), delta = y - previous
      const section = home ? ['experiencia', 'como-funciona', 'comprar'].filter(id => {
        const element = document.getElementById(id)
        return element && element.getBoundingClientRect().top <= 160
      }).at(-1) ?? '' : ''
      setScroll(current => {
        const hidden = y < 80 ? false : Math.abs(delta) > 6 ? delta > 0 : current.hidden
        return current.scrolled === (y > 24) && current.hidden === hidden && current.section === section ? current : { scrolled: y > 24, hidden, section }
      })
      if (Math.abs(delta) > 6) previous = y
      frame = 0
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [home])
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
    if (href.includes('#')) return home && (scroll.section ? href.endsWith(`#${scroll.section === 'comprar' ? 'experiencia' : scroll.section}`) : hash === href.slice(1))
    return pathname === href || pathname.startsWith(`${href}/`)
  }
  function anchorFocus(href: string) { anchorDestination.current = home ? href.split('#')[1] ?? null : null }

  return <>
    <header className="site-header-shell" data-home={home} data-scrolled={scroll.scrolled || !home} data-hidden={scroll.hidden && !open && !cartOpen && !accountOpen} data-focus={focusMode}>
      <div className="site-header">
        <Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" alt="KeyToTwo" width="420" height="97" fetchPriority="high" /></Link>
        {focusMode ? <><span className="checkout-secure"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" /></svg>Compra segura</span><Link className="text-button checkout-back" to="/carrinho">Voltar ao carrinho</Link></> : <>
          <nav className="desktop-nav" aria-label="Navegação principal">{visibleNavigation.map(item => <Link className="nav-link" aria-current={active(item.href) ? (item.href.includes('#') ? 'location' : 'page') : undefined} key={item.href} to={item.href}>{item.label}</Link>)}</nav>
          <div className="desktop-action">
            <Link className="nav-link nav-secondary" to="/ajuda" aria-current={pathname === '/ajuda' ? 'page' : undefined}>Ajuda</Link>
            {session ? <div className="account-menu" ref={accountMenu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }}>
              <button className="account-trigger" ref={accountTrigger} aria-label="Abrir opções da conta" aria-expanded={accountOpen} aria-controls="account-options" onClick={() => setAccountOpen(value => !value)}><span className="account-initial" aria-hidden="true">{initial}</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m2 4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" /></svg></button>
              {accountOpen && <div className="account-options" id="account-options"><nav aria-label="Sua conta"><Link className="nav-link" to="/meus-jogos" onClick={() => setAccountOpen(false)}>Meus jogos</Link><Link className="nav-link" to="/conta" onClick={() => setAccountOpen(false)}>Conta</Link><button className="text-button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Saindo…' : 'Sair'}</button></nav><p className="form-error" role="alert">{error}</p></div>}
            </div> : <Link className="nav-link" aria-current={pathname === '/entrar' ? 'page' : undefined} to="/entrar">Entrar</Link>}
            {siteConfig.showCartAccess && <button className="icon-button cart-trigger" disabled={!ready} aria-label={cartLabel} aria-haspopup="dialog" onClick={() => setCartOpen(true)}><CartIcon />{(cart.loading || cart.error || count > 0) && <span className="cart-count" aria-hidden="true">{cart.loading || cart.error ? '…' : count}</span>}</button>}
            <Link className="button button-primary" to={primary.href}>{primary.label}<span aria-hidden="true">→</span></Link>
          </div>
          <div className="mobile-navigation">
            {siteConfig.showCartAccess && <button className="icon-button cart-trigger" disabled={!ready} aria-label={cartLabel} aria-haspopup="dialog" onClick={() => setCartOpen(true)}><CartIcon />{(cart.loading || cart.error || count > 0) && <span className="cart-count" aria-hidden="true">{cart.loading || cart.error ? '…' : count}</span>}</button>}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild><button className="icon-button menu-trigger" disabled={!ready} aria-label="Abrir menu"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>Menu</button></SheetTrigger>
              <SheetContent className="mobile-menu-sheet" onCloseAutoFocus={event => {
                if (anchorDestination.current) {
                  const target = document.getElementById(anchorDestination.current)
                  anchorDestination.current = null
                  if (target) { event.preventDefault(); target.focus() }
                }
              }}>
                <div className="sheet-account"><SheetTitle className="sheet-title">{session ? 'Olá!' : 'Entre e fique à vontade.'}</SheetTitle><SheetDescription className="sheet-description">{session ? 'Seus próximos encontros estão aqui.' : 'Seus jogos ficam guardados na sua conta.'}</SheetDescription>
                  <div className="sheet-account-links">{session ? <><span className="account-initial" aria-hidden="true">{initial}</span><SheetClose asChild><Link className="inline-link" to="/conta">Conta</Link></SheetClose><button className="text-button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Saindo…' : 'Sair'}</button></> : <SheetClose asChild><Link className="inline-link" to="/entrar">Entrar <span aria-hidden="true">→</span></Link></SheetClose>}</div><p className="form-error" role="alert">{error}</p>
                </div>
                <nav className="sheet-nav" aria-label="Navegação mobile">{visibleNavigation.map((item, index) => <SheetClose asChild key={item.href}><Link className="nav-link" style={{ '--link-order': index } as CSSProperties} aria-current={active(item.href) ? (item.href.includes('#') ? 'location' : 'page') : undefined} to={item.href} onClick={() => anchorFocus(item.href)}>{item.label}<span aria-hidden="true">→</span></Link></SheetClose>)}
                  {session && <SheetClose asChild><Link className="nav-link" to="/meus-jogos" aria-current={pathname === '/meus-jogos' ? 'page' : undefined}>Meus jogos <span aria-hidden="true">→</span></Link></SheetClose>}
                </nav>
                <SheetClose asChild><Link className="sheet-help" to="/ajuda" aria-current={pathname === '/ajuda' ? 'page' : undefined}><span>Ajuda <span aria-hidden="true">→</span></span></Link></SheetClose>
                <div className="sheet-bottom"><SheetClose asChild><Link className="button button-primary" to={primary.href} onClick={() => anchorFocus(primary.href)}>{primary.label}<span aria-hidden="true">→</span></Link></SheetClose><div className="sheet-legal"><SheetClose asChild><Link to="/termos">Termos de uso</Link></SheetClose><SheetClose asChild><Link to="/privacidade">Privacidade</Link></SheetClose></div></div>
              </SheetContent>
            </Sheet>
          </div>
        </>}
      </div>
    </header>
    {cartOpen && <Suspense fallback={null}><CartDrawer /></Suspense>}
  </>
}
