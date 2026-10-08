import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../lib/auth-context'
import { authConfigured, supabase } from '../../lib/supabase'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!authConfigured)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    if (!authConfigured) return
    const { data: { subscription } } = supabase().auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession?.user.email_confirmed_at && !nextSession.user.is_anonymous ? nextSession : null)
      setReady(true)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
    })
    return () => subscription.unsubscribe()
  }, [])
  return <AuthContext.Provider value={{ session, ready, recovery, finishRecovery: () => setRecovery(false) }}>{children}</AuthContext.Provider>
}
