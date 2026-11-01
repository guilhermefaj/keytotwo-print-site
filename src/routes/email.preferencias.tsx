import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { LeaveNewsletterMessage } from '../components/account/LeaveNewsletter'
import { leaveNewsletter } from '../content/account'
import { ApiError } from '../lib/api'
import { emailPreferencesMock, unsubscribeEmail, type UnsubscribeLink } from '../lib/email-preferences'
import { useShop } from '../lib/shop-context'
import { useHydrated } from '../lib/use-hydrated'

function PreferenceForm({ link, completed }: { link: UnsubscribeLink | null; completed: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [stayed, setStayed] = useState(false)
  const request = useRef<AbortController | null>(null)
  const resultHeading = useRef<HTMLHeadingElement | null>(null)
  const navigate = useNavigate()
  const { account } = useShop()
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => { if (completed || stayed) resultHeading.current?.focus() }, [completed, stayed])

  async function confirm() {
    if (!link || request.current || completed) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError('')
    try {
      if (!emailPreferencesMock) await unsubscribeEmail(link, controller.signal)
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
    </div> : stayed ? <div role="status">
      <h2 id="email-choice-title" ref={resultHeading} tabIndex={-1}>Que bom que você fica!</h2>
      <p>Nada mudou: as novidades continuam chegando por e-mail.</p>
      <Link className="button button-secondary" to="/loja">Ver os jogos</Link>
    </div> : link ? <>
      {/* Antes de sair (responsável, 2026-11-01): o que a pessoa deixa de receber; a saída continua a um clique. */}
      <LeaveNewsletterMessage headingId="email-choice-title" />
      {!invalid && <div className="leave-actions">
        <button className="button button-primary" disabled={busy} onClick={() => setStayed(true)}>{leaveNewsletter.stay}</button>
        <button className="button button-secondary" disabled={busy} onClick={confirm}>{busy ? 'Confirmando…' : emailPreferencesMock ? 'Simular descadastro' : 'Parar de receber novidades'}</button>
      </div>}
      <p className="form-error" role="alert">{error}</p>
    </> : <>
      <h2 id="email-choice-title">Seu e-mail, suas escolhas.</h2>
      <p>Abra o link que veio no e-mail ou ajuste sua preferência em Minha conta.</p>
    </>}
    <Link className="inline-link" to="/conta">Minha conta</Link>
  </section>
}

// O HTML pré-renderizado não sabe se o link trouxe o token: até o navegador ler a URL, um skeleton no lugar do texto e
// do botão (2026-10-25; antes o texto sem token aparecia e trocava, e o React acusava a divergência).
function PreferenceSkeleton() {
  return <section className="account-card" aria-labelledby="email-choice-title">
    <h2 id="email-choice-title">Seu e-mail, suas escolhas.</h2>
    <div className="preference-skeleton" role="status"><span className="sr-only">Carregando…</span><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></div>
    <Link className="inline-link" to="/conta">Minha conta</Link>
  </section>
}

export default function EmailPreferences() {
  const [params] = useSearchParams()
  const { state } = useLocation()
  const hydrated = useHydrated()
  const token = params.get('token') || ''
  // O rodapé dos e-mails do Plunk chega como ?contato=<id>&e=<id do e-mail> (Traefik, deploy/plunk/compose.yaml).
  const contact = params.get('contato') || ''
  const emailId = params.get('e') || ''
  const link: UnsubscribeLink | null = token ? { token } : contact ? (emailId ? { contact, email_id: emailId } : { contact }) : null
  const completed = state?.emailPreferenceResult === (emailPreferencesMock ? 'mock' : 'unsubscribed')
  return <main id="conteudo" tabIndex={-1} className="reading-page content-width">
    <h1>Preferências de e-mail</h1>
    {emailPreferencesMock && <p className="checkout-demo">Demonstração (mock): nenhuma preferência de e-mail será alterada.</p>}
    {hydrated ? <PreferenceForm key={token || contact} link={link} completed={completed} /> : <PreferenceSkeleton />}
  </main>
}
