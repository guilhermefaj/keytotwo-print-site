import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, ApiError, apiErrorMessage } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { saveJson } from '../../lib/save-json'

// Direitos do titular (Política de privacidade › Seus direitos): cópia dos dados e exclusão da conta, sem e-mail ao atendimento.

/** Cópia dos dados em JSON (GET /account/export), salva pelo navegador. */
export function DataExport() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function download() {
    setBusy(true); setError(''); setMessage('')
    try {
      const data = await api<unknown>('/account/export')
      saveJson(data, `keytotwo-meus-dados-${new Date().toISOString().slice(0, 10)}.json`)
      setMessage('Pronto. O arquivo com seus dados foi baixado.')
    } catch (cause) { setError(apiErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <div className="account-form" aria-busy={busy}>
    <button type="button" className="button button-secondary" disabled={busy} onClick={download}>{busy ? 'Preparando arquivo…' : 'Baixar meus dados'}</button>
    <p className="field-help">Arquivo JSON com conta, pedidos, jogos, consentimentos, downloads e e-mails. <Link className="inline-link" to="/privacidade">Privacidade</Link></p>
    <p className="form-error" role="alert">{error}</p><p className="form-message" role="status">{message}</p>
  </div>
}

const CONFIRMATION = 'EXCLUIR'

/** Exclusão da conta (POST /account/delete) com confirmação digitada na própria página. */
export function AccountDeletion() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const navigate = useNavigate()
  const confirmed = typed.trim().toUpperCase() === CONFIRMATION
  useEffect(() => {
    if (open) input.current?.focus()
    else if (wasOpen.current) opener.current?.focus()
    wasOpen.current = open
  }, [open])

  async function remove(event: FormEvent) {
    event.preventDefault()
    if (!confirmed || busy) return
    setBusy(true); setError('')
    try {
      await api('/account/delete', { method: 'POST', body: { confirmation: CONFIRMATION } })
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'ACCOUNT_DELETION_BLOCKED'
        ? 'Há um pagamento em andamento ou uma contestação aberta nesta conta. A exclusão fica disponível quando ela terminar. Se precisar, fale com o atendimento.'
        : apiErrorMessage(cause))
      setBusy(false)
      return
    }
    // A conta já não existe: volta ao início e encerra a sessão neste aparelho.
    await navigate('/', { replace: true })
    try { await supabase().auth.signOut({ scope: 'local' }) } catch { /* a sessão local some mesmo com erro de rede */ }
  }

  if (!open) return <div className="account-form"><button ref={opener} type="button" className="button button-secondary" onClick={() => { setOpen(true); setTyped(''); setError('') }}>Excluir minha conta</button></div>
  return <form className="account-form" onSubmit={remove} aria-busy={busy} aria-labelledby="delete-confirm-title">
    <h3 id="delete-confirm-title">Antes de confirmar</h3>
    <ul>
      <li>O acesso aos jogos comprados acaba, em Meus jogos e nos links dos e-mails. Baixe antes os PDFs que quiser guardar.</li>
      <li>Sua sacola, sua preferência de e-mail e o histórico de mensagens são apagados.</li>
      <li>Os pedidos ficam guardados sem o seu e-mail e sem ligação com você, pelo prazo da lei fiscal.</li>
      <li>A exclusão não pode ser desfeita. Você sai da conta assim que ela terminar.</li>
    </ul>
    <label htmlFor="delete-confirmation">Para confirmar, digite {CONFIRMATION}</label>
    <input ref={input} id="delete-confirmation" name="delete-confirmation" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={event => setTyped(event.target.value)} disabled={busy} required aria-describedby="delete-confirmation-help" />
    <p id="delete-confirmation-help" className="field-help">Digite a palavra {CONFIRMATION}, em letras maiúsculas ou minúsculas.</p>
    <p className="form-error" role="alert">{error}</p>
    <div className="form-actions"><button className="button button-primary" disabled={!confirmed || busy}>{busy ? 'Excluindo…' : 'Excluir conta definitivamente'}</button> <button type="button" className="text-button" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button></div>
  </form>
}
