import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { navigation } from '../../content/site'
import { siteConfig } from '../../lib/seo'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet'

export function SiteHeader({ onMenuOpenChange }: { onMenuOpenChange?: (open: boolean) => void }) {
  const { session } = useAuth()
  const { cart, freeGame } = useShop()
  const { pathname } = useLocation()
  const accountArea = ['/conta', '/meus-jogos', '/carrinho', '/pagamento', '/pedido/confirmacao'].some(route => pathname === route || pathname.startsWith(`${route}/`))
  const visibleNavigation = freeGame.data?.available ? [...navigation, { label: 'Jogo gratuito', href: '/jogo-gratuito' }] : navigation
  const count = cart.data?.items.length ?? 0
  const cartLabel = cart.error ? 'Carrinho, contagem indisponível' : cart.loading ? 'Carrinho, carregando itens' : `Carrinho, ${count} ${count === 1 ? 'item' : 'itens'}`
  const accountHref = session ? '/conta' : '/entrar'
  const accountLabel = session ? 'Conta' : 'Entrar'
  const [open, setOpen] = useState(false)
  const anchorDestination = useRef<string | null>(null)
  function changeOpen(next: boolean) {
    setOpen(next)
    onMenuOpenChange?.(next)
  }
  return <header className="site-header flex items-center justify-between gap-4">
    <Link className="brand" to="/" aria-label="KeyToTwo — início">
      <img src="/media/hero/keytotwo-logo.webp" alt="KeyToTwo" width="420" height="97" fetchPriority="high" />
    </Link>
    <nav className="desktop-nav flex items-center gap-6" aria-label="Navegação principal">
      {accountArea ? <><Link className="text-button" to="/meus-jogos">Meus jogos</Link><Link className="text-button" to="/ajuda">Ajuda</Link><Link className="text-button" to="/blog">Blog</Link></> : visibleNavigation.map(item => <a className="text-button" key={item.href} href={item.href}>{item.label}</a>)}
    </nav>
    <div className="desktop-action flex items-center gap-5">
      <Link className="text-button" to={accountHref}>{accountLabel}</Link>
      {siteConfig.showCartAccess && <Link className="text-button" to="/carrinho" aria-label={cartLabel}>Carrinho <span aria-hidden="true">({cart.loading || cart.error ? '…' : count})</span></Link>}
      {!accountArea && <a className="button button-primary" href="/#comprar">Escolher nosso encontro <span aria-hidden="true">→</span></a>}
    </div>
    <div className="mobile-navigation">
      <Link className="mobile-sign-in" to={accountHref}>{accountLabel}</Link>
      {siteConfig.showCartAccess && <Link className="icon-button cart-trigger" to="/carrinho" aria-label={cartLabel}>
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 3h2l3 12h11l2-8H6M10 20h.01M18 20h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg><span className="cart-count" aria-hidden="true">{cart.loading || cart.error ? '…' : count}</span>
      </Link>}
      <Sheet open={open} onOpenChange={changeOpen}>
        <SheetTrigger asChild><button className="icon-button menu-trigger" aria-label="Abrir menu">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" /></svg>
        </button></SheetTrigger>
        <SheetContent onCloseAutoFocus={event => {
          // Escape restores the trigger. An in-page navigation hands focus to its heading.
          if (anchorDestination.current) {
            const target = document.getElementById(anchorDestination.current)
            anchorDestination.current = null
            if (target) { event.preventDefault(); target.focus() }
          }
        }}>
          <SheetTitle className="sheet-title">Vamos conhecer?</SheetTitle>
          <SheetDescription className="sheet-description">Jogos para imprimir. Uma ideia para vocês dois.</SheetDescription>
          <nav className="sheet-nav flex flex-col gap-4" aria-label="Navegação mobile">
            {accountArea ? <>
              <SheetClose asChild><Link className="text-button" to={accountHref}>{accountLabel}</Link></SheetClose>
              {session && <SheetClose asChild><Link className="text-button" to="/meus-jogos">Meus jogos</Link></SheetClose>}
              {siteConfig.showCartAccess && <SheetClose asChild><Link className="text-button" to="/carrinho" aria-label={cartLabel}>Carrinho ({cart.loading || cart.error ? '…' : count})</Link></SheetClose>}
              <SheetClose asChild><Link className="text-button" to="/ajuda">Ajuda</Link></SheetClose>
              <SheetClose asChild><Link className="text-button" to="/blog">Blog</Link></SheetClose>
            </> : <>
              {[...visibleNavigation, { label: 'Dúvidas', href: '/#duvidas' }, { label: 'Escolher nosso encontro', href: '/#comprar' }].map(item =>
                <SheetClose asChild key={item.href}><a className={item.label === 'Escolher nosso encontro' ? 'button button-primary' : 'text-button'} href={item.href}
                  onClick={() => { anchorDestination.current = item.href.split('#')[1] }}>{item.label}<span aria-hidden="true">→</span></a></SheetClose>,
              )}
              <SheetClose asChild><Link className="text-button" to={accountHref}>{accountLabel}</Link></SheetClose>
              {session && <SheetClose asChild><Link className="text-button" to="/meus-jogos">Meus jogos</Link></SheetClose>}
              {siteConfig.showCartAccess && <SheetClose asChild><Link className="text-button" to="/carrinho" aria-label={cartLabel}>Carrinho ({cart.loading || cart.error ? '…' : count})</Link></SheetClose>}
              <SheetClose asChild><Link className="text-button" to="/ajuda">Ajuda</Link></SheetClose>
            </>}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  </header>
}
