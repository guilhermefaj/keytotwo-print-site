import { Link, useLocation, useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../../root'
import { siteConfig } from '../../lib/seo'
import { newsletterVisible } from '../../lib/features'
import { useShop } from '../../lib/shop-context'
import { Newsletter } from '../newsletter/Newsletter'
import { CutLine } from '../ui/CutLine'

export function SiteFooter() {
  const { freeGame } = useShop()
  const { hasBlogPosts } = useRouteLoaderData<typeof rootLoader>('root')!
  const path = useLocation().pathname.replace(/\/+$/, '')
  const publicFooter = !['/entrar', '/carrinho', '/pagamento', '/pedido/confirmacao', '/meus-jogos', '/pedidos', '/conta', '/email/preferencias'].includes(path) && !path.startsWith('/blog/')
  // Pagamento em modo foco: só a linha legal, sem convites para sair da compra.
  if (path === '/pagamento') return <footer className="site-footer" data-focus="true"><div className="site-footer-rule" aria-hidden="true" /><div className="content-width footer-bottom"><p>© {new Date().getFullYear()} KeyToTwo</p><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link><Link to="/ajuda">Ajuda</Link></nav></div></footer>
  return <footer className="site-footer" data-public={publicFooter}>{publicFooter ? <CutLine /> : <div className="site-footer-rule" aria-hidden="true" />}{publicFooter && newsletterVisible && <div className="content-width footer-newsletter"><Newsletter /></div>}<div className="content-width footer-grid">
    <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" width="420" height="97" alt="KeyToTwo" loading="lazy" /></Link><p>Um pinguim numa tela pedindo para vocês saírem dela.</p></div>
    <nav aria-label="Explorar"><h2>Vamos jogar</h2><Link to="/">Início</Link><Link to="/loja">Loja</Link><a href="/#como-funciona">Como funciona</a>{hasBlogPosts && <Link to="/blog">Blog</Link>}{freeGame.data?.available && <Link to="/jogo-gratuito">Jogo gratuito</Link>}</nav>
    <nav aria-label="Ajuda e acesso"><h2>Conta e ajuda</h2><Link to="/meus-jogos">Meus jogos</Link><Link to="/conta">Minha conta</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Sacola</Link>}<Link to="/ajuda">Ajuda</Link></nav>
  </div><div className="content-width footer-bottom"><p>© {new Date().getFullYear()} KeyToTwo</p><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link></nav></div>
    {/* O chão volta (DESIGN.md › Rodapé): a página começa e termina no mundo do Kito, que se despede acenando. */}
    {publicFooter && <div className="footer-ground" aria-hidden="true"><img className="footer-foliage" src="/media/hero/foliage-left.webp" width="360" height="119" alt="" loading="lazy" decoding="async" /><img className="footer-kito" src="/media/experience/kito-hi-256.webp" width="256" height="256" alt="" loading="lazy" decoding="async" /><div className="ground"><div className="ground-grass" /><div className="ground-soil" /></div></div>}
  </footer>
}
