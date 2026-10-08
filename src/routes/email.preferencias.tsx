import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../lib/api'
import { emailPreferencesMock, unsubscribeEmail } from '../lib/email-preferences'
import { useShop } from '../lib/shop-context'

function PreferenceForm({ token, completed }: { token: string; completed: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const request = useRef<AbortController | null>(null)
  const resultHeading = useRef<HTMLHeadingElement | null>(null)
  const navigate = useNavigate()
  const { account } = useShop()
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => { if (completed) resultHeading.current?.focus() }, [completed])

  async function confirm() {
    if (!token || request.current || completed) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      if (!emailPreferencesMock) await unsubscribeEmail(token, controller.signal)
      if (controller.signal.aborted) return
      if (!emailPreferencesMock) account.reload()
      // Only a non-sensitive result remains in history; remove the link token.
      await navigate('/email/preferencias', { replace: true, state: { emailPreferenceResult: emailPreferencesMock ? 'mock' : 'unsubscribed' } })
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof ApiError && cause.code === 'INVALID_TOKEN') {
        setInvalid(true)
        setError('Este link não está funcionando. Você pode ajustar o recebimento de novidades em Minha conta.')
      } else setError('Não conseguimos confirmar agora. Tente novamente.')
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false) }
    }
  }

  return <section className="account-card" aria-labelledby="email-choice-title">
    {completed ? <div role="status">
      <h2 id="email-choice-title" ref={resultHeading} tabIndex={-1}>{emailPreferencesMock ? 'Prévia do descadastro' : 'Tudo certo por aqui.'}</h2>
      <p>{emailPreferencesMock ? 'Demonstração concluída. Nenhuma preferência foi alterada.' : 'Você está fora da lista de novidades. Se já estava, está tudo certo.'}</p>
      <p>Você continua recebendo os e-mails de acesso e dos seus pedidos.</p>
    </div> : <>
      <h2 id="email-choice-title">Seu e-mail, suas escolhas.</h2>
      <p>{token ? 'Quer parar de receber nossas novidades? É só confirmar abaixo.' : 'Abra o link que veio no e-mail ou ajuste sua preferência em Minha conta.'}</p>
      {token && <p>Os e-mails de acesso e dos seus pedidos continuam chegando.</p>}
      {token && !invalid && <button className="button button-primary" disabled={busy} onClick={confirm}>{busy ? 'Confirmando…' : emailPreferencesMock ? 'Simular descadastro' : 'Parar de receber novidades'}</button>}
      <p className="form-error" role="alert">{error}</p>
    </>}
    <Link className="inline-link" to="/conta">Minha conta</Link>
  </section>
}

export default function EmailPreferences() {
  const [params] = useSearchParams()
  const { state } = useLocation()
  const token = params.get('token') || ''
  const completed = state?.emailPreferenceResult === (emailPreferencesMock ? 'mock' : 'unsubscribed')
  return <main id="conteudo" tabIndex={-1} className="reading-page content-width">
    <p className="eyebrow">No seu ritmo</p><h1>Preferências de e-mail</h1>
    {emailPreferencesMock && <p className="checkout-demo">Demonstração (mock): nenhuma preferência de e-mail será alterada.</p>}
    <PreferenceForm key={token} token={token} completed={completed} />
  </main>
}
