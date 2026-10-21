import { IconBrandInstagram } from '@tabler/icons-react'
import { CookieSettingsButton } from './CookieNotice'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../../root'
import { siteConfig } from '../../lib/seo'
import { newsletterVisible } from '../../lib/features'
import { Newsletter } from '../newsletter/Newsletter'
import { CutLine } from '../ui/CutLine'
import { company } from '../../content/legal'
import { instagram } from '../../content/gratuitos'

// Identificação do fornecedor (Termos de uso › Quem fornece), em todo rodapé, inclusive no pagamento.
function LegalLine() {
  return <p className="footer-legal"><span>© {new Date().getFullYear()} KeyToTwo, uma marca da {company.name}</span> <span>CNPJ {company.cnpj}</span></p>
}

// O Kito do rodapé fica sentado de frente e, de vez em quando, balança os pés uma ou duas vezes (os nove quadros da
// fileira; o quadro 0 é a pose parada). Com movimento reduzido, fica parado.
function FooterKito() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const kito = ref.current
    if (!kito || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer = 0
    const rest = () => {
      delete kito.dataset.swing
      timer = window.setTimeout(() => { kito.dataset.swing = Math.random() < .6 ? '1' : '2' }, 2500 + Math.random() * 5000)
    }
    kito.addEventListener('animationend', rest)
    rest()
    return () => { window.clearTimeout(timer); kito.removeEventListener('animationend', rest) }
  }, [])
  return <span className="footer-kito" ref={ref}><img src="/media/hero/kito-pixel-sit.webp" width="1809" height="208" alt="" loading="lazy" decoding="async" /></span>
}

export function SiteFooter() {
  const { hasBlogPosts } = useRouteLoaderData<typeof rootLoader>('root')!
  const path = useLocation().pathname.replace(/\/+$/, '')
  const publicFooter = !['/entrar', '/carrinho', '/pagamento', '/pedido/confirmacao', '/meus-jogos', '/pedidos', '/conta', '/painel', '/email/preferencias'].includes(path) && !path.startsWith('/blog/')
  // Pagamento em modo foco: só a linha legal, sem convites para sair da compra.
  if (path === '/pagamento') return <footer className="site-footer" data-focus="true"><div className="site-footer-rule" aria-hidden="true" /><div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /><Link to="/ajuda">Ajuda</Link></nav></div></footer>
  return <footer className="site-footer" data-public={publicFooter}>{publicFooter ? <CutLine /> : <div className="site-footer-rule" aria-hidden="true" />}{publicFooter && newsletterVisible && <div className="content-width footer-newsletter"><Newsletter /></div>}<div className="content-width footer-grid">
    <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><img src="/media/hero/keytotwo-logo.webp" width="420" height="97" alt="KeyToTwo" loading="lazy" /></Link><p>Um pinguim numa tela pedindo para vocês saírem dela.</p><a className="footer-instagram" href={instagram.href} target="_blank" rel="noopener" aria-label={`${instagram.handle} no Instagram (abre em nova aba)`}><IconBrandInstagram aria-hidden="true" size={22} stroke={1.75} />{instagram.handle}</a></div>
    <nav aria-label="Explorar"><h2>Vamos jogar</h2><Link to="/">Início</Link><Link to="/loja">Loja</Link><a href="/#como-funciona">Como funciona</a><Link to="/gratuitos">Gratuitos</Link>{hasBlogPosts && <Link to="/blog">Blog</Link>}</nav>
    <nav aria-label="Ajuda e acesso"><h2>Conta e ajuda</h2><Link to="/meus-jogos">Meus jogos</Link><Link to="/conta">Minha conta</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Sacola</Link>}<Link to="/ajuda">Ajuda</Link></nav>
  </div><div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /></nav></div>
    {/* O chão volta (DESIGN.md › Rodapé): a página começa e termina no mundo do Kito, sentado na grama. */}
    {publicFooter && <div className="footer-ground" aria-hidden="true"><img className="footer-foliage" src="/media/hero/foliage-left.webp" width="360" height="119" alt="" loading="lazy" decoding="async" /><FooterKito /><div className="ground"><div className="ground-grass" /><div className="ground-soil" /></div></div>}
  </footer>
}
