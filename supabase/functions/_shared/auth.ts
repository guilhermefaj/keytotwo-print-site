import { GoTrueClient, isAuthRetryableFetchError } from '@supabase/auth-js'
import { env } from './env.ts'
import { HttpError } from './http.ts'

interface SessionUser {
  id: string
  email: string | null
  accessToken: string
  // Nível da sessão: aal2 quando o segundo fator (app autenticador) foi confirmado nela.
  aal: string | null
}

let client: GoTrueClient | undefined

// Cliente só para validar tokens: não guarda sessão e mantém o cache do JWKS entre requisições.
function authClient(): GoTrueClient {
  client ??= new GoTrueClient({
    url: `${env.supabaseUrl()}/auth/v1`,
    headers: { apikey: env.publishableKey() },
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  })
  return client
}

// Chave de API (sb_...) no Authorization não é sessão.
function bearerToken(req: Request): string | null {
  const match = req.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/i)
  if (!match || match[1].startsWith('sb_')) return null
  return match[1]
}

// Sessão opcional: null sem token ou com token inválido, expirado, anônimo ou de outro papel.
async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = bearerToken(req)
  if (!token) return null
  const auth = authClient()
  let result: Awaited<ReturnType<GoTrueClient['getClaims']>>
  try {
    result = await auth.getClaims(token)
  } catch {
    // Token malformado (base64, JSON ou chave) lança erro comum em vez de AuthError.
    return null
  }
  const { data, error } = result
  // Falha de rede ao validar vira erro interno, não sessão inválida.
  if (error && isAuthRetryableFetchError(error)) throw error
  if (!data) return null
  const { claims } = data
  if (claims.role !== 'authenticated' || !claims.sub || claims.is_anonymous === true) return null
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null
  return { id: claims.sub, email, accessToken: token, aal: typeof claims.aal === 'string' ? claims.aal : null }
}

export async function requireSessionUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req)
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Entre de novo para continuar.')
  return user
}

// Rotas de admin: a sessão precisa do segundo fator (aal2). Quem é admin, o banco confere a cada chamada.
export async function requireAdminSession(req: Request): Promise<SessionUser> {
  const user = await requireSessionUser(req)
  if (user.aal !== 'aal2') throw new HttpError(403, 'MFA_REQUIRED', 'Confirme o código do app autenticador para continuar.')
  return user
}
