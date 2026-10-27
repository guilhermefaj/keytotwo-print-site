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

// O Kito do rodapé espia por trás da onda, de braços para cima, e de vez em quando dá um pulinho, uma ou duas vezes.
// Com movimento reduzido, fica parado.
function FooterKito() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const kito = ref.current
    if (!kito || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer = 0
    const rest = () => {
      delete kito.dataset.hop
      timer = window.setTimeout(() => { kito.dataset.hop = Math.random() < .6 ? '1' : '2' }, 2500 + Math.random() * 5000)
    }
    kito.addEventListener('animationend', rest)
    rest()
    return () => { window.clearTimeout(timer); kito.removeEventListener('animationend', rest) }
  }, [])
  return <span className="footer-kito" ref={ref} aria-hidden="true"><img src="/media/hero/kito-pixel-arms-up.webp" width="202" height="211" alt="" loading="lazy" decoding="async" /><KitoHeart /></span>
}

// Coraçãozinho em pixel ao lado do Kito, nas cores dele (contorno, corpo e brilho do sprite), flutuando.
function KitoHeart() {
  return <svg className="kito-heart" viewBox="0 0 11 10" width="33" height="30" shapeRendering="crispEdges">
    <path className="kito-heart-edge" d="M2 0h3v1H2zM6 0h3v1H6zM1 1h1v1H1zM5 1h1v1H5zM9 1h1v1H9zM0 2h1v3H0zM10 2h1v3h-1zM1 5h1v1H1zM9 5h1v1H9zM2 6h1v1H2zM8 6h1v1H8zM3 7h1v1H3zM7 7h1v1H7zM4 8h1v1H4zM6 8h1v1H6zM5 9h1v1H5z" />
    <path className="kito-heart-body" d="M2 1h3v1H2zM6 1h3v1H6zM1 2h1v2H1zM4 2h6v1H4zM3 3h7v1H3zM1 4h9v1H1zM2 5h7v1H2zM3 6h5v1H3zM4 7h3v1H4zM5 8h1v1H5z" />
    <path className="kito-heart-shine" d="M2 2h2v1H2zM2 3h1v1H2z" />
  </svg>
}

// A onda (2026-10-26): duas cristas suaves esticadas na largura da tela, a de trás em contrafase, e o corpo em degradê
// por baixo da linha legal (styles.css › .footer-wave). Cada crista tem o próprio degradê, do alto dela ao pé; o Kito
// fica entre as duas, no meio, onde a da frente está no alto (y 22 de 72).
const WAVE_BACK = 'M0 22C280 22 420 36 720 34S1160 10 1440 16V72H0Z'
const WAVE_FRONT = 'M0 40C320 40 400 22 720 22S1120 44 1440 30V72H0Z'

function WaveCrest({ side, d, top }: { side: 'back' | 'front', d: string, top: number }) {
  return <svg className={`footer-wave-${side}`} viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id={`footer-wave-${side}`} x1="0" y1={top} x2="0" y2="72" gradientUnits="userSpaceOnUse"><stop /><stop offset="1" /></linearGradient></defs>
    <path d={d} fill={`url(#footer-wave-${side})`} />
  </svg>
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
  </div>
    {/* A página termina numa onda com o Kito atrás dela (DESIGN.md › Rodapé); a linha legal fica por cima da onda. */}
    <div className="footer-wave">
      <WaveCrest side="back" d={WAVE_BACK} top={10} />
      <FooterKito />
      <WaveCrest side="front" d={WAVE_FRONT} top={22} />
      <div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /></nav></div>
    </div>
  </footer>
}
