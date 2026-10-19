import { useState } from 'react'
import { Link } from 'react-router'
import { marketingConsent } from '../../content/account'
import { api, apiErrorMessage, type Marketing } from '../../lib/api'
import { siteConfig } from '../../lib/seo'

export function MarketingPreference({ marketing, source = 'account', onSaved, onDismiss }: { marketing: Marketing; source?: 'account' | 'signup_prompt'; onSaved: () => void; onDismiss?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const allowed = marketingConsent.approved || siteConfig.stage === 'test'
  async function put(granted: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      await api('/account/marketing', { method: 'PUT', body: { granted, source, text_version: marketingConsent.version } })
      setMessage(granted ? 'Combinado. As próximas ideias chegam por e-mail.' : 'Combinado. Você não recebe mais ideias.')
      onSaved()
    } catch (cause) { setError(apiErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  async function dismiss() {
    setBusy(true); setError('')
    try { await onDismiss?.() } catch (cause) { setError(apiErrorMessage(cause)); setBusy(false) }
  }
  if (marketing.opted_in) return <div className="marketing-form" aria-busy={busy}>
    <p>Você recebe nossas ideias</p>
    <button className="text-button" disabled={busy || !allowed} onClick={() => put(false)}>Parar de receber</button>
    <p className="form-error" role="alert">{error}</p><p role="status">{message}</p>
  </div>
  return <form className="marketing-form" onSubmit={event => { event.preventDefault(); put(true) }} aria-busy={busy}>
    <button className="button button-primary" disabled={busy || !allowed}>Quero receber ideias</button>
    <p className="field-help">Dá para sair quando quiser. <Link className="inline-link" to="/privacidade">Privacidade</Link></p>
    {onDismiss && <button type="button" className="text-button" onClick={dismiss} disabled={busy}>Agora não</button>}
    <p className="form-error" role="alert">{error}</p><p role="status">{message}</p>
  </form>
}
