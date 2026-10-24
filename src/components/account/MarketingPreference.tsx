import { useState } from 'react'
import { Link } from 'react-router'
import { marketingConsent } from '../../content/account'
import { api, apiErrorMessage, type Marketing } from '../../lib/api'
import { siteConfig } from '../../lib/site-config'

export function MarketingPreference({ marketing, onSaved }: { marketing: Marketing; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // Conceder exige o texto aprovado; retirar o consentimento nunca fica bloqueado (LGPD, art. 8º, § 5º).
  const allowed = marketingConsent.approved || siteConfig.stage === 'test'
  async function put(granted: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      await api('/account/marketing', { method: 'PUT', body: { granted, source: 'account', text_version: marketingConsent.version } })
      setMessage(granted ? 'Combinado. As próximas ideias chegam por e-mail.' : 'Combinado. Você não recebe mais ideias.')
      onSaved()
    } catch (cause) { setError(apiErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  if (marketing.opted_in) return <div className="marketing-form" aria-busy={busy}>
    <p>Você recebe nossas ideias</p>
    <button className="text-button" disabled={busy} onClick={() => put(false)}>Parar de receber</button>
    <p className="form-error" role="alert">{error}</p><p role="status">{message}</p>
  </div>
  return <form className="marketing-form" onSubmit={event => { event.preventDefault(); put(true) }} aria-busy={busy}>
    <button className="button button-primary" disabled={busy || !allowed}>{marketingConsent.label}</button>
    <p className="field-help">{marketingConsent.detail} <Link className="inline-link" to="/privacidade">Privacidade</Link></p>
    <p className="form-error" role="alert">{error}</p><p role="status">{message}</p>
  </form>
}
