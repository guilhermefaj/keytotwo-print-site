import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

// Dentro do AuthGate a sessão sempre existe, é de admin e já passou pelo segundo fator.
export const SessionContext = createContext<Session | null>(null)
export function useSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession fora do AuthGate')
  return session
}
