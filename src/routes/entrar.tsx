import { useEffect, useState, type FormEvent } from 'react'
import { CheckoutSteps } from '../components/checkout/CheckoutSteps'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth-context'
import { authConfigured, authErrorMessage, loginDestination, safeNext, supabase } from '../lib/supabase'

type Method = 'code' | 'password' | 'create' | 'recover'

export default function Entrar() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session, ready, recovery, finishRecovery } = useAuth()
  const [method, setMethod] = useState<Method>(params.get('mode') === 'recover' ? 'recover' : 'code')
  const [step, setStep] = useState<'email' | 'verify' | 'set-password'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(params.has('error') ? 'Não foi possível entrar com o provedor. Tente novamente ou use seu e-mail.' : '')
  const [cooldown, setCooldown] = useState(0)
  const next = safeNext(params.get('next'))
  const add = params.get('add')
  const destination = add && /^[A-Z0-9_-]{1,40}$/.test(add) ? `/carrinho?${new URLSearchParams({ add })}` : next
  const settingPassword = Boolean(session) && (step === 'set-password' || recovery || method === 'recover')

  useEffect(() => {
    if (settingPassword) document.getElementById('new-password')?.focus()
    else if (step === 'verify') document.getElementById('email-code')?.focus()
  }, [step, settingPassword])

  useEffect(() => {
    if (ready && session && !busy && step === 'email' && method !== 'recover' && !recovery) navigate(destination, { replace: true })
  }, [ready, session, busy, step, method, recovery, destination, navigate])
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function selectMethod(value: Method) {
    setMethod(value); setStep('email'); setCode(''); setPassword(''); setConfirmation(''); setMessage(''); setError('')
  }
  function callbackUrl(recover = false) {
    const url = new URL(loginDestination(next, add || undefined), window.location.origin)
    if (recover) url.searchParams.set('mode', 'recover')
    return url.href
  }
  async function sendCode() {
    const result = method === 'recover'
      ? await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: callbackUrl(true) })
      : await supabase().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: callbackUrl() } })
    if (result.error) throw result.error
    setStep('verify'); setCooldown(60)
    setMessage('Se o endereço puder receber a mensagem, o código chegará em instantes. Confira também a pasta de spam. Ele vale por 10 minutos.')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (settingPassword) {
        if (password !== confirmation) { setError('As senhas precisam ser iguais.'); return }
        const { error } = await supabase().auth.updateUser({ password })
        if (error) throw error
        finishRecovery()
        navigate(destination, { replace: true })
      } else if (step === 'verify') {
        const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: method === 'recover' ? 'recovery' : 'email' })
        if (error) throw error
        setCode('')
        if (method === 'create' || method === 'recover') { setStep('set-password'); setMessage('E-mail confirmado. Agora escolha sua senha.') }
        else navigate(destination, { replace: true })
      } else if (method === 'password') {
        const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        setPassword(''); navigate(destination, { replace: true })
      } else await sendCode()
    } catch (cause) { setError(authErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  async function resend() {
    setBusy(true); setError('')
    try { await sendCode() } catch (cause) { setError(authErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  async function google() {
    setBusy(true); setError('')
    try {
      const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl() } })
      if (error) throw error
    } catch (cause) { setError(authErrorMessage(cause)); setBusy(false) }
  }

  return <main id="conteudo" tabIndex={-1} className="account-page content-width auth-page">
    {(add || /^\/(carrinho|pagamento)(?:[/?#]|$)/.test(next)) && <CheckoutSteps current={2} />}
    <div className="auth-intro"><h1>{settingPassword ? 'Definir senha' : method === 'recover' ? 'Redefinir senha' : 'Entrar'}</h1><p>Sua escolha fica guardada. Entre ou crie sua conta para continuar.</p><div className="auth-brand-note" aria-hidden="true">o encontro<br />continua <span>aqui.</span></div><Link className="inline-link" to="/ajuda">Precisa de ajuda?</Link></div>
    <section className="account-card" aria-label="Acesso à conta">
      {!authConfigured ? <p className="legal-pending">O acesso à conta estará disponível em breve.</p> : <>
        {step === 'email' && !settingPassword && <div className="auth-methods" role="group" aria-label="Como entrar"><button className="text-button" aria-pressed={method === 'code'} onClick={() => selectMethod('code')} disabled={busy}>Código por e-mail</button><button className="text-button" aria-pressed={method === 'password'} onClick={() => selectMethod('password')} disabled={busy}>E-mail e senha</button></div>}
        <form onSubmit={submit} className="account-form" aria-busy={busy}>
          {settingPassword ? <><h2>Seu e-mail está confirmado</h2><p>Escolha uma senha para entrar nas próximas vezes.</p><label htmlFor="new-password">Nova senha</label><input id="new-password" name="new-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={72} pattern="(?=.*[a-zA-Z])(?=.*[0-9]).{8,}" required aria-describedby="password-help" /><p id="password-help" className="field-help">Pelo menos 8 caracteres, com letras e números.</p><label htmlFor="confirm-password">Confirme a senha</label><input id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} minLength={8} maxLength={72} required /></> : step === 'verify' ? <><h2>Confira seu e-mail</h2><p>Digite o código de 6 dígitos enviado para <strong className="break-anywhere">{email}</strong>.</p><label htmlFor="email-code">Código de verificação</label><input id="email-code" name="one-time-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required /></> : <>
            {method === 'create' && <><h2>Criar conta com senha</h2><p>Primeiro vamos confirmar seu e-mail com um código. Você só define a senha depois.</p></>}
            {method === 'recover' && <p>Enviaremos um código para você confirmar seu e-mail e escolher uma nova senha.</p>}
            <label htmlFor="email">E-mail</label><input id="email" name="email" type="email" spellCheck={false} autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required />
            {method === 'password' && <><label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /><button type="button" className="inline-link text-start" disabled={busy} onClick={() => selectMethod('recover')}>Esqueci minha senha</button></>}
          </>}
          <p className="form-error" role="alert">{error}</p><p className="form-message" role="status">{message}</p>
          <button className="button button-primary" disabled={busy || !ready}>{busy ? 'Aguarde…' : settingPassword ? 'Salvar senha' : step === 'verify' ? 'Confirmar código' : method === 'password' ? 'Entrar com senha' : 'Enviar código'}</button>
        </form>
        {step === 'verify' && !settingPassword && <div className="form-actions"><button className="text-button" disabled={busy || cooldown > 0} onClick={resend}>{cooldown ? `Reenviar em ${cooldown}s` : 'Reenviar código'}</button><button className="text-button" disabled={busy} onClick={() => selectMethod(method)}>Usar outro e-mail</button></div>}
        {step === 'email' && !settingPassword && <div className="auth-alternatives"><button className="google-sign-in" disabled={busy} onClick={google}><img src="/media/auth/google-g.png" width="20" height="20" alt="" /><span>Continuar com Google</span></button><button className="text-button" disabled={busy} onClick={() => selectMethod(method === 'create' ? 'code' : 'create')}>{method === 'create' ? 'Prefiro entrar com código' : 'Criar conta com senha'}</button></div>}
        <p className="field-help auth-privacy">A preferência de receber novidades é opcional e separada do acesso à conta. <Link className="inline-link" to="/privacidade">Privacidade</Link> · <Link className="inline-link" to="/termos">Termos de uso</Link>.</p>
      </>}
    </section>
  </main>
}
