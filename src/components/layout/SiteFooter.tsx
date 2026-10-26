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
  return <span className="footer-kito" ref={ref}><img src="/media/hero/kito-pixel-sit.webp" width="1809" height="208" alt="" loading="lazy" decoding="async" /></span>
}

// A geleira (2026-10-26, no lugar da grama): faces de gelo em três tons da paleta (styles.css › .ice-*) e o fio de Tinta
// por cima, como os cards. O iceberg fica atrás da plataforma; a plataforma é uma fileira de 960 px que se repete, e os
// 8 px de cima são o topo onde o Kito senta.
function FooterBerg() {
  return <svg className="footer-berg" viewBox="0 0 192 92" width="192" height="92">
    <path className="ice-sky" d="M0 92L8 66L24 48L38 14L50 2L62 18L74 12L92 40L104 36L125 69L128 64L146 42L158 48L172 70L192 92Z" />
    <path className="ice-mid" d="M30 92L46 52L50 2L62 18L70 56L80 92ZM62 18L74 12L84 46L70 56ZM146 42L158 48L172 70L192 92L156 92Z" />
    <path className="ice-dark" d="M80 92L70 56L84 46L74 12L92 40L104 36L124 68L142 92Z" />
    <path className="ice-edge" d="M0 92L8 66L24 48L38 14L50 2L62 18L74 12L92 40L104 36L125 69L128 64L146 42L158 48L172 70L192 92" vectorEffect="non-scaling-stroke" />
  </svg>
}

const SHELF_SHADE = 'M96 8H118L150 40H124ZM300 8H372L330 30ZM468 8H540L520 40H500ZM640 8H676L662 26ZM760 8H784L770 40H744ZM880 8H930L902 22Z'
function FooterShelf() {
  return <svg className="footer-ice"><defs><pattern id="footer-ice" width="960" height="40" patternUnits="userSpaceOnUse">
    <rect className="ice-sky" width="960" height="40" /><rect className="ice-mid" y="8" width="960" height="32" />
    <path className="ice-sky" d={SHELF_SHADE} /><path className="ice-dark" d={SHELF_SHADE} />
    <path className="ice-sky" d="M262 8H300L292 40H276ZM540 8H556L526 40H520Z" />
    <rect className="ice-dark" width="960" height="1" />
  </pattern></defs><rect width="100%" height="100%" fill="url(#footer-ice)" /></svg>
}

export function SiteFooter() {
  const { hasBlogPosts } = useRouteLoaderData<typeof rootLoader>('root')!
  const path = useLocation().pathname.replace(/\/+$/, '')
  // Pagamento em modo foco: só a linha legal, sem convites para sair da compra.
  if (path === '/pagamento') return <footer className="site-footer" data-focus="true"><div className="site-footer-rule" aria-hidden="true" /><div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /><Link to="/ajuda">Ajuda</Link></nav></div></footer>
  // A tesoura e a geleira do Kito valem em todas as páginas fora o pagamento (2026-10-24).
  return <footer className="site-footer"><CutLine /><div className="content-width footer-grid">
    <div className="footer-brand"><Link className="brand" to="/" aria-label="KeyToTwo — início"><span className="wordmark">KeyToTwo</span></Link><p>Um pinguim numa tela pedindo para vocês saírem dela.</p><div className="footer-social"><a href={instagram.href} target="_blank" rel="noopener" aria-label={`${instagram.handle} no Instagram (abre em nova aba)`}><IconBrandInstagram aria-hidden="true" size={22} stroke={1.75} />Instagram</a><a href={tiktok.href} target="_blank" rel="noopener" aria-label={`${tiktok.handle} no TikTok (abre em nova aba)`}><IconBrandTiktok aria-hidden="true" size={22} stroke={1.75} />TikTok</a></div></div>
    <nav aria-label="Explorar"><h2>Vamos jogar</h2><Link to="/">Início</Link><Link to="/loja">Loja</Link><a href="/#como-funciona">Como funciona</a><Link to="/gratuitos">Gratuitos</Link>{hasBlogPosts && <Link to="/blog">Blog</Link>}</nav>
    <nav aria-label="Ajuda e acesso"><h2>Conta e ajuda</h2><Link to="/meus-jogos">Meus jogos</Link><Link to="/conta">Minha conta</Link>{siteConfig.showCartAccess && <Link to="/carrinho">Sacola</Link>}<Link to="/ajuda">Ajuda</Link></nav>
  </div><div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /></nav></div>
    {/* A página termina no mundo do Kito (DESIGN.md › Rodapé): ele sentado na geleira. */}
    <div className="footer-ground" aria-hidden="true"><FooterBerg /><FooterKito /><FooterShelf /></div>
  </footer>
}
