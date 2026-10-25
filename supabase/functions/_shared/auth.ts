import { GoTrueClient, isAuthRetryableFetchError } from '@supabase/auth-js'
import { env } from './env.ts'
import { HttpError } from './http.ts'

interface SessionUser {
  id: string
  email: string | null
  accessToken: string
  // Nível da sessão: aal2 quando o segundo fator (app autenticador) foi confirmado nela.
  aal: string | null
  // Quando o código do app autenticador foi confirmado pela última vez nesta sessão (epoch s), do claim amr.
  totpAt: number | null
}

// O admin pede o código do app de novo a cada 12 horas (revisão de segurança, 2026-10-25): sem isso, renovar a sessão
// mantinha o aal2 para sempre, e uma sessão copiada do navegador valia como admin sem prazo.
export const ADMIN_MFA_MAX_AGE_SECONDS = 12 * 3600

function totpTimestamp(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null
  const times = amr.flatMap((entry) => entry && typeof entry === 'object' && entry.method === 'totp' && Number.isFinite(entry.timestamp) ? [entry.timestamp as number] : [])
  return times.length ? Math.max(...times) : null
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
  return { id: claims.sub, email, accessToken: token, aal: typeof claims.aal === 'string' ? claims.aal : null, totpAt: totpTimestamp(claims.amr) }
}

export async function requireSessionUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req)
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Entre de novo para continuar.')
  return user
}

// Rotas de admin: a sessão precisa do segundo fator (aal2), confirmado nas últimas 12 horas. Quem é admin, o banco
// confere a cada chamada.
export async function requireAdminSession(req: Request, now = Date.now()): Promise<SessionUser> {
  const user = await requireSessionUser(req)
  if (user.aal !== 'aal2' || user.totpAt === null || user.totpAt * 1000 < now - ADMIN_MFA_MAX_AGE_SECONDS * 1000) {
    throw new HttpError(403, 'MFA_REQUIRED', 'Confirme o código do app autenticador para continuar.')
  }
  return user
}
