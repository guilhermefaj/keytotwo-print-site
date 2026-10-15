import { Link, useLocation, useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../../root'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { Newsletter } from '../newsletter/Newsletter'
import { CutLine } from '../ui/CutLine'

export function SiteFooter() {
  const { freeGame } = useShop()
  const { hasBlogPosts } = useRouteLoaderData<typeof rootLoader>('root')!
  const path = useLocation().pathname.replace(/\/+$/, '')
  const publicFooter = !['/entrar', '/carrinho', '/pagamento', '/pedido/confirmacao', '/meus-jogos', '/pedidos', '/conta', '/email/preferencias'].includes(path) && !path.startsWith('/blog/')
  return <footer className="site-footer" data-public={publicFooter}>{publicFooter ? <CutLine /> : <div className="site-footer-rule" aria-hidden="true" />}{publicFooter && <div className="content-width footer-newsletter"><Newsletter /></div>}<div className="content-width footer-grid">
    <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" width="420" height="97" alt="KeyToTwo" loading="lazy" /></Link><p>Uma boa ideia.<br />Vocês dois.<br />O resto vira história.</p></div>
    <nav aria-label="Explorar"><h2>Vamos jogar</h2><Link to="/">Início</Link><Link to="/loja">Loja</Link><a href="/#como-funciona">Como funciona</a>{hasBlogPosts && <Link to="/blog">Blog</Link>}{freeGame.data?.available && <Link to="/jogo-gratuito">Jogo gratuito</Link>}</nav>
    <nav aria-label="Ajuda e acesso"><h2>Seu cantinho</h2><Link to="/meus-jogos">Meus jogos</Link><Link to="/conta">Minha conta</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Sacola</Link>}<Link to="/ajuda">Ajuda</Link></nav>
  </div><div className="content-width footer-bottom"><p>© {new Date().getFullYear()} KeyToTwo</p><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link></nav></div></footer>
}
