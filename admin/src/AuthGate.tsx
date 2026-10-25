import { useEffect, useState, type ReactNode } from 'react'
import { MFA_REQUIRED_EVENT } from './api'
import type { Session } from '@supabase/supabase-js'
import { Challenge, Enroll } from './pages/Mfa'
import { SignIn } from './pages/SignIn'
import { SessionContext } from './session'
import { Screen, SignOut } from './Screen'
import { isAdmin, mfaExpiresAt, sessionLevel, siteUrl, supabase } from './supabase'

type Factor = { user: string; factorId: string | null } | { user: string; error: true }

// Portão do admin: entrar (Google ou código), ser admin e confirmar o segundo fator (app autenticador).
// A primeira vez cadastra o app; depois, cada sessão nova pede o código, e de novo a cada 12 horas (ou quando a API
// disser que venceu). A API também exige o aal2 com o código recente.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [factor, setFactor] = useState<Factor | null>(null)
  const [revision, setRevision] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [refused, setRefused] = useState(false)
  // A conta cujo admin já abriu nesta página: só ela fica montada por baixo quando o código vence.
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'MFA_CHALLENGE_VERIFIED') { setRefused(false); setNow(Date.now()) }
      setSession(next)
    })
    const onRefused = () => setRefused(true)
    window.addEventListener(MFA_REQUIRED_EVENT, onRefused)
    return () => { data.subscription.unsubscribe(); window.removeEventListener(MFA_REQUIRED_EVENT, onRefused) }
  }, [])

  const expiresAt = session ? mfaExpiresAt(session) : null
  // Quando o prazo vence, a tela troca sozinha para o código.
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expiresAt - now + 1000, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [expiresAt, now])

  const user = session?.user.id
  const needsFactor = Boolean(session && isAdmin(session) && (sessionLevel(session) !== 'aal2' || expiresAt === null || expiresAt <= now || refused))
  useEffect(() => {
    if (!supabase || !user || !needsFactor) return
    let active = true
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return
      if (error || !data) return setFactor({ user, error: true })
      setFactor({ user, factorId: data.totp.find(item => item.status === 'verified')?.id ?? null })
    })
    return () => { active = false }
  }, [user, needsFactor, revision])

  if (!supabase) return <Screen title="Admin sem configuração"><p>Faltam as variáveis do Supabase neste build.</p></Screen>
  if (session === undefined) return <Screen title="Carregando…" />
  if (!session) return <SignIn />
  if (!isAdmin(session)) return <Screen title="Esta área é só para a equipe">
    <p>A conta {session.user.email} não tem acesso ao admin. Seus jogos e pedidos continuam na loja.</p>
    <div className="gate-actions"><a className="button button-secondary" href={siteUrl}>Ir para a loja</a><SignOut /></div>
  </Screen>
  const gate = !factor || factor.user !== user ? <Screen title="Carregando…" />
    : 'error' in factor ? <Screen title="Não deu para conferir o segundo fator">
      <p>Tente de novo em instantes.</p>
      <div className="gate-actions"><button className="button button-primary" type="button" onClick={() => setRevision(value => value + 1)}>Tentar de novo</button><SignOut /></div>
    </Screen>
    : factor.factorId ? <Challenge factorId={factor.factorId} /> : <Enroll />
  // Código vencido com o admin já aberto: ele fica montado por baixo (o texto de um post não se perde) e volta como estava
  // depois do código. Numa página nova, só o código.
  if (user && !needsFactor && openedFor !== user) setOpenedFor(user)
  const renewing = needsFactor && openedFor === user
  if (needsFactor && !renewing) return gate
  return <>
    <div style={{ display: renewing ? 'none' : 'contents' }}><SessionContext.Provider value={session}>{children}</SessionContext.Provider></div>
    {renewing && gate}
  </>
}
