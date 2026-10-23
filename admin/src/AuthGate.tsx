import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Challenge, Enroll } from './pages/Mfa'
import { SignIn } from './pages/SignIn'
import { SessionContext } from './session'
import { Screen, SignOut } from './Screen'
import { isAdmin, sessionLevel, siteUrl, supabase } from './supabase'

type Factor = { user: string; factorId: string | null } | { user: string; error: true }

// Portão do admin: entrar (Google ou código), ser admin e confirmar o segundo fator (app autenticador).
// A primeira vez cadastra o app; depois, cada sessão nova pede o código. A API também exige o aal2.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [factor, setFactor] = useState<Factor | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const user = session?.user.id
  const needsFactor = Boolean(session && isAdmin(session) && sessionLevel(session) !== 'aal2')
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
  if (!needsFactor) return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
  if (!factor || factor.user !== user) return <Screen title="Carregando…" />
  if ('error' in factor) return <Screen title="Não deu para conferir o segundo fator">
    <p>Tente de novo em instantes.</p>
    <div className="gate-actions"><button className="button button-primary" type="button" onClick={() => setRevision(value => value + 1)}>Tentar de novo</button><SignOut /></div>
  </Screen>
  return factor.factorId ? <Challenge factorId={factor.factorId} /> : <Enroll />
}
