import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export const AuthContext = createContext<{ session: Session | null; ready: boolean; recovery: boolean; finishRecovery: () => void }>({ session: null, ready: false, recovery: false, finishRecovery: () => {} })
export const useAuth = () => useContext(AuthContext)
// Só decide o que mostrar: a API confere o admin no banco a cada chamada (app_metadata só o servidor grava).
export const isAdmin = (session: Session | null) => session?.user.app_metadata?.admin === true
