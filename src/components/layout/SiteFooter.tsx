import { Link } from 'react-router'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'

export function SiteFooter() {
  const { freeGame } = useShop()
  return <footer className="site-footer"><div className="content-width footer-grid">
    <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" width="420" height="97" alt="KeyToTwo" loading="lazy" /></Link><p>Uma boa ideia.<br />Vocês dois.<br />O resto vira história.</p></div>
    <nav aria-label="Explorar"><h2>Vamos jogar</h2><a href="/#experiencia">A experiência</a><a href="/#como-funciona">Como funciona</a><Link to="/blog">Blog</Link>{freeGame.data?.available && <Link to="/jogo-gratuito">Jogo gratuito</Link>}<a href="/#comprar">Escolher nosso encontro</a></nav>
    <nav aria-label="Ajuda e acesso"><h2>Seu cantinho</h2><Link to="/meus-jogos">Meus jogos</Link><Link to="/conta">Conta</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Carrinho</Link>}<Link to="/ajuda">Ajuda</Link></nav>
  </div><div className="content-width footer-bottom"><p>© {new Date().getFullYear()} KeyToTwo</p><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link></nav></div></footer>
}
