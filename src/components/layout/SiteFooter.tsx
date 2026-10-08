import { Link } from 'react-router'
import { navigation, site } from '../../content/site'
import { pending } from '../../lib/pending'
import { siteConfig } from '../../lib/seo'

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="content-width footer-grid">
      <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" width="420" height="97" alt="KeyToTwo" loading="lazy" /></Link><p>{site.description}</p></div>
      <nav aria-label="Explorar"><h2>Explorar</h2>{navigation.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}<a href="/#comprar">Ver pacote</a><a href="/#duvidas">Dúvidas</a></nav>
      <nav aria-label="Ajuda e acesso"><h2>Ajuda e acesso</h2><Link to="/ajuda">Ajuda</Link><Link to="/ajuda#contato">Atendimento</Link><Link to="/entrar">Entrar</Link><Link to="/meus-jogos">Meus jogos</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Carrinho</Link>}</nav>
      <nav aria-label="Informações"><h2>Informações</h2><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link><Link to="/reembolsos">Reembolsos</Link></nav>
    </div>
    <div className="content-width footer-bottom"><p>© {new Date().getFullYear()} KeyToTwo</p><p>{pending('identificação do fornecedor e contato confirmado.')}</p></div>
  </footer>
}
