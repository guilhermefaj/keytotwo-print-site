import { createClient, type Session } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const apiBase = url ? `${url.replace(/\/$/, '')}/functions/v1/api` : ''
export const publishableKey = key ?? ''
export const siteUrl = (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://keytotwo.com.br'

// A sessão do admin é do próprio subdomínio: entrar na loja não entra aqui, e vice-versa.
export const supabase = url && key
  ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
  : null

// Só decide a tela: quem é admin e se o segundo fator foi confirmado, a API confere a cada chamada.
export const isAdmin = (session: Session) => session.user.app_metadata?.admin === true

function claimsOf(session: Session): { aal?: unknown; amr?: unknown } {
  try {
    const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)) as { aal?: unknown; amr?: unknown }
  } catch {
    return {}
  }
}

export function sessionLevel(session: Session): string | null {
  const { aal } = claimsOf(session)
  return typeof aal === 'string' ? aal : null
}

// O código do app autenticador vale 12 horas na sessão (revisão de segurança, 2026-10-25; a API confere o mesmo
// prazo). A tela pede de novo 5 minutos antes, para o relógio do computador não deixar a API recusar antes dela.
export const MFA_MAX_AGE_MS = 12 * 3600_000
export function mfaExpiresAt(session: Session): number | null {
  const { amr } = claimsOf(session)
  const times = Array.isArray(amr) ? amr.flatMap(entry => entry?.method === 'totp' && Number.isFinite(entry.timestamp) ? [entry.timestamp as number] : []) : []
  return times.length ? Math.max(...times) * 1000 + MFA_MAX_AGE_MS - 5 * 60_000 : null
}

export function authMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Aguarde um minuto antes de tentar de novo.'
  if (code === 'otp_expired') return 'Código inválido ou expirado. Confira o e-mail ou peça outro.'
  if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found') return 'Este e-mail não tem conta na KeyToTwo.'
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired') return 'Código incorreto ou vencido. Use o código que está no app agora.'
  return 'Não foi possível concluir. Confira os dados e tente de novo.'
}
