import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AppAuthCard } from '../components/app/AppAuthShell'
import { appChecking, appRecover, appSupabase } from '../content/app-auth'
import { clearAppAuthUrl, passwordMeetsRules, readAppAuthParams, recoverFailure, recoverTokens } from '../lib/app-auth'

type Step = 'checking' | 'expired' | 'form' | 'done'
type Tokens = ReturnType<typeof recoverTokens>

// /auth/recover (app KeyToTwo, 2026-11-18): a senha nova de quem pediu "Esqueci minha senha" no app. Lê os tokens do
// fim da URL, apaga da barra na hora e abre uma sessão só em memória no Supabase do app (não no da loja): nada fica
// guardado no navegador, nada vai para log. Link com erro, incompleto ou recusado pelo Supabase é link vencido.
export default function AuthRecover() {
  const [step, setStep] = useState<Step>('checking')
  const [client, setClient] = useState<SupabaseClient | null>(null)
  // Lido uma vez só: no modo estrito do React o efeito roda duas vezes, e na segunda a URL já está limpa.
  const tokens = useRef<Tokens | undefined>(undefined)
  useEffect(() => {
    if (tokens.current === undefined) tokens.current = recoverTokens(readAppAuthParams(window.location.search, window.location.hash))
    clearAppAuthUrl()
    const link = tokens.current
    if (!link) { setStep('expired'); return }
    let active = true
    // Sessão só em memória, no Supabase do app. Qualquer falha (link recusado, chave ausente, rede) vira link vencido.
    const open = async () => {
      const app = createClient(appSupabase.url, appSupabase.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' },
      })
      const { error } = await app.auth.setSession(link)
      if (error) throw error
      return app
    }
    open().then(app => { if (active) { setClient(app); setStep('form') } }, () => { if (active) setStep('expired') })
    return () => { active = false }
  }, [])

  if (step === 'checking') return <AppAuthCard kito="calm" title={appChecking.title} text={appChecking.text} />
  if (step === 'expired') return <AppAuthCard kito="calm" title={appRecover.expired.title} text={appRecover.expired.text} />
  if (step === 'done') return <AppAuthCard kito="happy" title={appRecover.done.title} text={appRecover.done.text} />
  if (!client) return null
  return <AppAuthCard kito="calm" title={appRecover.form.title}>
    <RecoverForm client={client} onDone={() => setStep('done')} onExpired={() => setStep('expired')} />
  </AppAuthCard>
}

function RecoverForm({ client, onDone, onExpired }: { client: SupabaseClient; onDone: () => void; onExpired: () => void }) {
  const { form, errors } = appRecover
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    // As mesmas regras do Supabase do app, conferidas antes de enviar.
    if (!passwordMeetsRules(password)) { setError(errors.weak); return }
    if (password !== confirmation) { setError(errors.mismatch); return }
    setBusy(true); setError('')
    try {
      const { error: failure } = await client.auth.updateUser({ password })
      if (failure) {
        const kind = recoverFailure(failure)
        if (kind === 'expired') onExpired()
        else setError(errors[kind])
        return
      }
      // A sessão do link não serve para mais nada: sai dela (só esta sessão) e mostra o fim.
      void client.auth.signOut({ scope: 'local' }).catch(() => undefined)
      onDone()
    } catch {
      setError(errors.other)
    } finally {
      setBusy(false)
    }
  }
  return <form className="account-form app-auth-form" noValidate onSubmit={submit} aria-busy={busy}>
    <PasswordField id="app-new-password" label={form.password} hiddenName="a nova senha" value={password} onChange={setPassword} describedBy="app-password-rule" />
    <PasswordField id="app-confirm-password" label={form.confirmation} hiddenName="a confirmação" value={confirmation} onChange={setConfirmation} />
    <p id="app-password-rule" className="field-help">{form.rule}</p>
    <p className="form-error" role="alert">{error}</p>
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? form.submitting : form.submit}</button>
  </form>
}

// Campo de senha com o botão de mostrar e esconder (o nome lido pelo leitor de tela diz qual campo).
function PasswordField({ id, label, hiddenName, value, onChange, describedBy }: { id: string; label: string; hiddenName: string; value: string; onChange: (value: string) => void; describedBy?: string }) {
  const [shown, setShown] = useState(false)
  const { form } = appRecover
  return <>
    <label htmlFor={id}>{label}</label>
    <div className="app-auth-password">
      <input id={id} type={shown ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={72}
        value={value} onChange={event => onChange(event.target.value)} aria-describedby={describedBy} />
      <button type="button" className="text-button" aria-controls={id} onClick={() => setShown(value => !value)}>
        {shown ? form.hide : form.show}<span className="sr-only"> {hiddenName}</span>
      </button>
    </div>
  </>
}
