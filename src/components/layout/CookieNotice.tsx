import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { cookieNoticeEnabled, loadAnalytics, onCookieNoticeReopen, reopenCookieNotice, setCookieChoice, useCookieChoice } from '../../lib/analytics'
import { useHydrated } from '../../lib/use-hydrated'

// Aviso de cookies (DESIGN.md › Aviso de cookies): o Kito já está comendo o cookie dele; os nossos são só do Google
// Analytics e só entram com o aceite. Recusar pesa o mesmo que aceitar. "Cookies" no rodapé reabre o aviso.
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
  return <section className="cookie-notice" aria-labelledby="cookie-notice-title">
    <div className="cookie-notice-art" aria-hidden="true">
      <img src="/media/experience/kito-cookie-187.webp" alt="" width="94" height="103" decoding="async" />
      <span className="cookie-crumbs"><i /><i /><i /></span>
    </div>
    <div className="cookie-notice-copy">
      <h2 id="cookie-notice-title" ref={title} tabIndex={-1}>O Kito já pegou o cookie dele.</h2>
      <p>Os nossos são do Google Analytics: contam as visitas e mostram o que mais ajuda no site. Sem anúncio, e só se você aceitar. <Link className="inline-link" to="/privacidade#navegador">Política de privacidade</Link></p>
      <div className="cookie-notice-actions">
        <button type="button" className="button button-primary" onClick={() => choose('granted')}>Aceitar</button>
        <button type="button" className="button button-secondary" onClick={() => choose('denied')}>Recusar</button>
      </div>
    </div>
  </section>
}

// "Cookies" na linha legal do rodapé: mudar a escolha a qualquer momento. Só depois da hidratação (o host decide).
export function CookieSettingsButton() {
  const hydrated = useHydrated()
  if (!hydrated || !cookieNoticeEnabled()) return null
  return <button type="button" className="footer-cookies" onClick={reopenCookieNotice}>Cookies</button>
}
