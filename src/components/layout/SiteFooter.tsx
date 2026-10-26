import { IconBrandInstagram, IconBrandTiktok } from '@tabler/icons-react'
import { CookieSettingsButton } from './CookieNotice'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useRouteLoaderData } from 'react-router'
import type { loader as rootLoader } from '../../root'
import { siteConfig } from '../../lib/site-config'
import { CutLine } from '../ui/CutLine'
import { company } from '../../content/legal'
import { instagram, tiktok } from '../../content/gratuitos'

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
  return <span className="footer-kito" ref={ref} aria-hidden="true"><img src="/media/hero/kito-pixel-sit.webp" width="1809" height="208" alt="" loading="lazy" decoding="async" /></span>
}

export function SiteFooter() {
  const { hasBlogPosts } = useRouteLoaderData<typeof rootLoader>('root')!
  const path = useLocation().pathname.replace(/\/+$/, '')
  // Pagamento em modo foco: só a linha legal, sem convites para sair da compra.
  if (path === '/pagamento') return <footer className="site-footer" data-focus="true"><div className="site-footer-rule" aria-hidden="true" /><div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /><Link to="/ajuda">Ajuda</Link></nav></div></footer>
  // A tesoura e o Kito valem em todas as páginas fora o pagamento (2026-10-24).
  return <footer className="site-footer"><CutLine /><div className="content-width footer-grid">
    <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><span className="wordmark">KeyToTwo</span></Link><p>Um pinguim numa tela pedindo para vocês saírem dela.</p><div className="footer-social"><a href={instagram.href} target="_blank" rel="noopener" aria-label={`${instagram.handle} no Instagram (abre em nova aba)`}><IconBrandInstagram aria-hidden="true" size={22} stroke={1.75} />Instagram</a><a href={tiktok.href} target="_blank" rel="noopener" aria-label={`${tiktok.handle} no TikTok (abre em nova aba)`}><IconBrandTiktok aria-hidden="true" size={22} stroke={1.75} />TikTok</a></div></div>
    <nav aria-label="Explorar"><h2>Vamos jogar</h2><Link to="/">Início</Link><Link to="/loja">Loja</Link><a href="/#como-funciona">Como funciona</a><Link to="/gratuitos">Gratuitos</Link>{hasBlogPosts && <Link to="/blog">Blog</Link>}</nav>
    <nav aria-label="Ajuda e acesso"><h2>Conta e ajuda</h2><Link to="/meus-jogos">Meus jogos</Link><Link to="/conta">Minha conta</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Sacola</Link>}<Link to="/ajuda">Ajuda</Link></nav>
  </div><div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /></nav></div>
    {/* A página termina com o Kito se apresentando (DESIGN.md › Rodapé): solto, sentado na borda de baixo da tela. */}
    <div className="content-width footer-hello"><p className="footer-bubble">Oi, eu sou o Kito! Vou te acompanhar em novas aventuras.</p><FooterKito /></div>
  </footer>
}
