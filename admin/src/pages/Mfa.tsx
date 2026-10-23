import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Screen, SignOut } from '../Screen'
import { authMessage, supabase } from '../supabase'

type Enrollment = { factorId: string; qr: string; secret: string }

// Primeiro acesso: cadastra o app autenticador (TOTP). Cadastros abandonados (não confirmados) saem antes.
export function Enroll() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const started = useRef(-1)
  useEffect(() => {
    if (started.current === revision) return
    started.current = revision
    ;(async () => {
      const { data: factors } = await supabase!.auth.mfa.listFactors()
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') await supabase!.auth.mfa.unenroll({ factorId: factor.id })
      }
      const { data, error: failure } = await supabase!.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Admin KeyToTwo' })
      if (failure || !data) throw failure ?? new Error('enroll')
      setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    })().catch(failure => setError(authMessage(failure)))
  }, [revision])

  return <Screen title="Proteja o admin">
    <p>Na primeira vez, o admin pede um segundo fator: um código que muda a cada 30 segundos num app autenticador (Google Authenticator, Microsoft Authenticator, 1Password ou outro).</p>
    {error && !enrollment ? <>
      <p className="form-error" role="alert">{error}</p>
      <div className="gate-actions"><button className="button button-primary" type="button" onClick={() => { setError(''); setRevision(value => value + 1) }}>Tentar de novo</button><SignOut /></div>
    </> : !enrollment ? <p>Preparando o código…</p> : <>
      <ol className="gate-steps">
        <li>No app, escolha adicionar uma conta e escaneie o código abaixo.</li>
        <li>Digite os 6 números que o app mostrar.</li>
      </ol>
      <img className="gate-qr" src={enrollment.qr} width="200" height="200" alt="QR code para cadastrar o admin no app autenticador" />
      <details className="gate-secret"><summary>Não consegue escanear?</summary><p>Digite esta chave no app: <code>{enrollment.secret}</code></p></details>
      <CodeForm factorId={enrollment.factorId} action="Confirmar e entrar" />
    </>}
  </Screen>
}

// Sessão nova de quem já cadastrou o app: só o código.
export function Challenge({ factorId }: { factorId: string }) {
  return <Screen title="Código do app autenticador">
    <p>Digite os 6 números do app autenticador para a KeyToTwo.</p>
    <CodeForm factorId={factorId} action="Entrar" />
    <p className="field-help">Sem acesso ao app? O fator pode ser removido no painel do Supabase (Authentication › Users › sua conta), e o admin pede um cadastro novo.</p>
  </Screen>
}

function CodeForm({ factorId, action }: { factorId: string; action: string }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Certo: a sessão passa a aal2 e o AuthGate abre o admin sozinho.
  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    const { error: failure } = await supabase!.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
    if (failure) { setError(authMessage(failure)); setBusy(false) }
  }
  return <form className="gate-form" onSubmit={verify}>
    <label className="field"><span>Código de 6 números</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label>
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Conferindo…' : action}</button>
    <p className="form-error" role="alert">{error}</p>
    <div className="gate-actions"><SignOut /></div>
  </form>
}
