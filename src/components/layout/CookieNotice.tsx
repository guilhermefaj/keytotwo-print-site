import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { IconX } from '@tabler/icons-react'
import { cookieNoticeEnabled, loadAnalytics, onCookieNoticeReopen, reopenCookieNotice, setCookieChoice, useCookieChoice } from '../../lib/analytics'
import { useHydrated } from '../../lib/use-hydrated'
import { Icon } from '../ui/Icon'

// Aviso de cookies (DESIGN.md › Aviso de cookies): o Kito já está comendo o cookie dele; os nossos são só do Google
// Analytics e só entram com o aceite. Na primeira visita, "Aceitar" e um X no canto que fecha sem aceitar (vale como
// recusa). Aberto por "Cookies" no rodapé, mostra "Aceitar" e "Recusar" lado a lado, para mudar a escolha.
export function CookieNotice() {
  const hydrated = useHydrated()
  const choice = useCookieChoice()
  const [reopened, setReopened] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  // Aceite guardado: o GA4 carrega a cada visita, depois da hidratação.
  useEffect(() => { if (choice === 'granted') loadAnalytics() }, [choice])
  useEffect(() => onCookieNoticeReopen(() => setReopened(true)), [])
  useEffect(() => { if (reopened) title.current?.focus() }, [reopened])
  if (!hydrated || !cookieNoticeEnabled() || (choice && !reopened)) return null
  function choose(value: 'granted' | 'denied') { setCookieChoice(value); setReopened(false) }
  // O X: na primeira visita fecha sem aceitar; reaberto pelo rodapé, só fecha e mantém a escolha que já existia.
  function close() { if (choice) setReopened(false); else choose('denied') }
  return <section className={reopened ? 'cookie-notice cookie-notice-settings' : 'cookie-notice'} aria-labelledby="cookie-notice-title">
    <div className="cookie-notice-art" aria-hidden="true">
      <img src="/media/experience/kito-cookie-187.webp" alt="" width="64" height="70" decoding="async" />
      <span className="cookie-crumbs"><i /><i /><i /></span>
    </div>
    <div className="cookie-notice-copy">
      <h2 id="cookie-notice-title" ref={title} tabIndex={-1}>O Kito já pegou o cookie dele.</h2>
      <p>Aceita os nossos? São do Google Analytics e só contam as visitas, sem anúncio. <Link className="inline-link" to="/privacidade#navegador">Política de privacidade</Link></p>
    </div>
    <div className="cookie-notice-actions">
      <button type="button" className="button button-primary" onClick={() => choose('granted')}>Aceitar</button>
      {reopened && <button type="button" className="button button-secondary" onClick={() => choose('denied')}>Recusar</button>}
    </div>
    <button type="button" className="cookie-notice-close" aria-label={choice ? 'Fechar' : 'Fechar sem aceitar'} onClick={close}>
      <Icon component={IconX} size={20} />
    </button>
  </section>
}

// "Cookies" na linha legal do rodapé: mudar a escolha a qualquer momento. Só depois da hidratação (o host decide).
export function CookieSettingsButton() {
  const hydrated = useHydrated()
  if (!hydrated || !cookieNoticeEnabled()) return null
  return <button type="button" className="footer-cookies" onClick={reopenCookieNotice}>Cookies</button>
}
