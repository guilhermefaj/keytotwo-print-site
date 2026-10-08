import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { siteConfig } from './seo'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const authConfigured = siteConfig.stage !== 'preview' && Boolean(url && key)
export const apiBase = url ? `${url.replace(/\/$/, '')}/functions/v1/api` : ''
export const publishableKey = key || ''
let client: SupabaseClient | undefined

// Created only in the browser. No session or storage is read during prerendering.
export function supabase() {
  if (!authConfigured || typeof window === 'undefined') throw new Error('AUTH_UNAVAILABLE')
  client ??= createClient(url!, key!, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  })
  return client
}

export function safeNext(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/conta'
  const parsed = new URL(value, 'https://local.invalid')
  if (parsed.origin !== 'https://local.invalid' || parsed.pathname === '/entrar') return '/conta'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function loginDestination(next: string, add?: string) {
  const params = new URLSearchParams({ next: safeNext(next) })
  if (add && /^[A-Z0-9_-]{1,40}$/.test(add)) params.set('add', add)
  return `/entrar?${params}`
}

export function authErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Aguarde um minuto antes de tentar novamente.'
  if (code === 'otp_expired') return 'Código inválido ou expirado. Confira o e-mail ou solicite outro código.'
  if (code === 'invalid_credentials') return 'E-mail ou senha inválidos. Você também pode entrar com um código.'
  if (code === 'weak_password') return 'Use uma senha com pelo menos 8 caracteres, incluindo letras e números.'
  if (code === 'same_password') return 'Escolha uma senha diferente da anterior.'
  return 'Não foi possível concluir. Confira os dados e tente novamente.'
}
