import { useState, type FormEvent } from 'react'
import { Screen } from '../Screen'
import { authMessage, supabase } from '../supabase'
import googleG from '../../../public/media/auth/google-g.png'

// Entrar no admin: Google ou código por e-mail, só de contas que já existem (não cria conta aqui).
export function SignIn() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<{ error: unknown }>, done?: () => void) {
    setBusy(true); setError('')
    try {
      const { error: failure } = await action()
      if (failure) setError(authMessage(failure))
      else done?.()
    } catch (failure) { setError(authMessage(failure)) }
    finally { setBusy(false) }
  }
  const google = () => run(() => supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } }))
  function requestCode(event: FormEvent) {
    event.preventDefault()
    const address = email.trim().toLowerCase()
    void run(() => supabase!.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } }), () => { setSentTo(address); setCode('') })
  }
  function verify(event: FormEvent) {
    event.preventDefault()
    void run(() => supabase!.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' }))
  }

  return <Screen title="Entrar no admin">
    <p>Use a conta da equipe da KeyToTwo. Depois de entrar, o admin pede o código do app autenticador.</p>
    <button className="button button-secondary" type="button" disabled={busy} onClick={google}><img src={googleG} width="20" height="20" alt="" />Continuar com Google</button>
    <p className="gate-or"><span>ou</span></p>
    {!sentTo ? <form className="gate-form" onSubmit={requestCode}>
      <label className="field"><span>E-mail</span><input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button className="button button-secondary" type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Receber código por e-mail'}</button>
    </form> : <form className="gate-form" onSubmit={verify}>
      <label className="field"><span>Código enviado para {sentTo}</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required value={code} onChange={event => setCode(event.target.value)} /></label>
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Conferindo…' : 'Entrar'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setSentTo(''); setError('') }}>Usar outro e-mail</button>
    </form>}
    <p className="form-error" role="alert">{error}</p>
  </Screen>
}
