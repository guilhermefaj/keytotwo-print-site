import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { marketingConsent } from '../../content/account'
import { api, apiErrorMessage, type Marketing } from '../../lib/api'
import { siteConfig } from '../../lib/seo'

export function MarketingPreference({ marketing, source = 'account', onSaved, onDismiss }: { marketing: Marketing; source?: 'account' | 'signup_prompt'; onSaved: () => void; onDismiss?: () => Promise<void> }) {
  const [checked, setChecked] = useState(source === 'account' && marketing.opted_in)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const allowed = marketingConsent.approved || siteConfig.stage === 'test'
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      await api('/account/marketing', { method: 'PUT', body: { granted: checked, source, text_version: marketingConsent.version } })
      setMessage('Preferência salva.'); onSaved()
    } catch (cause) { setError(apiErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  async function dismiss() {
    setBusy(true); setError('')
    try { await onDismiss?.() } catch (cause) { setError(apiErrorMessage(cause)); setBusy(false) }
  }
  return <form className="marketing-form" onSubmit={save} aria-busy={busy}>
    <label className="checkbox-label"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={busy || !allowed} /><span>{marketingConsent.label}</span></label>
    <p className="field-help">{marketingConsent.detail} <Link className="inline-link" to="/privacidade">Privacidade</Link></p>
    <div className="form-actions"><button className="button button-primary" disabled={busy || !allowed || (source === 'signup_prompt' && !checked)}>{source === 'signup_prompt' ? 'Salvar minha escolha' : 'Salvar preferência'}</button>{onDismiss && <button type="button" className="text-button" onClick={dismiss} disabled={busy}>Agora não</button>}</div>
    <p className="form-error" role="alert">{error}</p><p role="status">{message}</p>
  </form>
}
