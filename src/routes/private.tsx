import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../lib/auth-context'
import { loginDestination } from '../lib/supabase'
import { useHydrated } from '../lib/use-hydrated'

// Rotas privadas (pagamento, Portal e confirmação): sem sessão, vão para Entrar e voltam para onde estavam.
export default function RequireAuth() {
  const { session, ready } = useAuth()
  const hydrated = useHydrated()
  const location = useLocation()
  if (!hydrated || !ready) return <main id="conteudo" className="reading-page content-width" tabIndex={-1}><h1>Verificando acesso</h1><p role="status">Aguarde um instante.</p></main>
  if (!session) return <Navigate replace to={loginDestination(`${location.pathname}${location.search}${location.hash}`)} />
  return <Outlet />
}
