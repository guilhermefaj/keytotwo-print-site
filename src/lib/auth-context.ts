import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export const AuthContext = createContext<{ session: Session | null; ready: boolean; recovery: boolean; finishRecovery: () => void }>({ session: null, ready: false, recovery: false, finishRecovery: () => {} })
export const useAuth = () => useContext(AuthContext)
