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
  return <span className="footer-kito" ref={ref} aria-hidden="true"><img src="/media/hero/kito-pixel-arms-up.webp" width="174" height="201" alt="" loading="lazy" decoding="async" /></span>
}

// A onda (2026-10-26): duas cristas esticadas na largura da tela, a de trás defasada, e o corpo em degradê por baixo da
// linha legal (styles.css › .footer-wave). O Kito fica entre as duas cristas.
const WAVE_BACK = 'M0 26C200 26 260 6 440 6S720 30 920 30S1240 4 1440 12V72H0Z'
const WAVE_FRONT = 'M0 44C240 44 300 18 480 18S760 48 960 48S1260 16 1440 26V72H0Z'

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
      <svg className="footer-wave-back" viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true"><path d={WAVE_BACK} /></svg>
      <FooterKito />
      <svg className="footer-wave-front" viewBox="0 0 1440 72" preserveAspectRatio="none" aria-hidden="true"><path d={WAVE_FRONT} /></svg>
      <div className="content-width footer-bottom"><LegalLine /><nav aria-label="Informações legais"><Link to="/termos">Termos de uso</Link><Link to="/reembolsos">Reembolsos</Link><Link to="/privacidade">Privacidade</Link><CookieSettingsButton /></nav></div>
    </div>
  </footer>
}
