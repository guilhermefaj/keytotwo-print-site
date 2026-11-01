import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { marketingConsent } from '../../content/account'
import { api, apiErrorMessage, type Marketing } from '../../lib/api'
import { siteConfig } from '../../lib/site-config'
import { LeaveNewsletterDialog } from './LeaveNewsletter'

export function MarketingPreference({ marketing, onSaved }: { marketing: Marketing; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [leaving, setLeaving] = useState(false)
  const status = useRef<HTMLParagraphElement>(null)
  // Conceder exige o texto aprovado; retirar o consentimento nunca fica bloqueado (LGPD, art. 8º, § 5º): a janela
  // "Vamos sentir sua falta" só pede um clique a mais.
  const allowed = marketingConsent.approved || siteConfig.stage === 'test'
  async function put(granted: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      await api('/account/marketing', { method: 'PUT', body: { granted, source: 'account', text_version: marketingConsent.version } })
      setMessage(granted ? 'Combinado. As próximas ideias chegam por e-mail.' : 'Combinado. Você não recebe mais ideias.')
      onSaved()
      setLeaving(false)
    } catch (cause) { setError(apiErrorMessage(cause)); setLeaving(false) }
    finally { setBusy(false) }
  }
  // Saiu da lista: o botão que abriu a janela some quando a conta recarrega; o foco vai para a confirmação.
  const wasOptedIn = useRef(marketing.opted_in)
  useEffect(() => {
    if (wasOptedIn.current && !marketing.opted_in && message) status.current?.focus()
    wasOptedIn.current = marketing.opted_in
  }, [marketing.opted_in, message])
  if (marketing.opted_in) return <div className="marketing-form" aria-busy={busy}>
    <p>Você recebe nossas ideias</p>
    <button className="text-button" disabled={busy} onClick={() => { setError(''); setMessage(''); setLeaving(true) }}>Parar de receber</button>
    <p className="form-error" role="alert">{error}</p><p role="status" ref={status} tabIndex={-1}>{message}</p>
    <LeaveNewsletterDialog open={leaving} busy={busy} onStay={() => setLeaving(false)} onLeave={() => put(false)} />
  </div>
  return <form className="marketing-form" onSubmit={event => { event.preventDefault(); put(true) }} aria-busy={busy}>
    <button className="button button-primary" disabled={busy || !allowed}>{marketingConsent.label}</button>
    <p className="field-help">{marketingConsent.detail} <Link className="inline-link" to="/privacidade">Privacidade</Link></p>
    <p className="form-error" role="alert">{error}</p><p role="status" ref={status} tabIndex={-1}>{message}</p>
  </form>
}
