import { Navigate, Outlet, useLocation } from 'react-router'
import { useSyncExternalStore } from 'react'
import { useAuth } from '../../lib/auth-context'
import { loginDestination } from '../../lib/supabase'

const subscribe = () => () => {}

export function RequireAuth() {
  const { session, ready } = useAuth()
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false)
  const location = useLocation()
  if (!hydrated || !ready) return <main id="conteudo" className="reading-page content-width" tabIndex={-1}><h1>Verificando acesso</h1><p role="status">Aguarde um instante.</p></main>
  if (!session) return <Navigate replace to={loginDestination(`${location.pathname}${location.search}${location.hash}`)} />
  return <Outlet />
}
