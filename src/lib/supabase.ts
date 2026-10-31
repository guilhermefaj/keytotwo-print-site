import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { siteConfig } from './site-config'
import { isProductCode } from './guest-cart'

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

// Destino depois de entrar quando não há outro (a sacola, o pagamento, a página pedida): Meus jogos (responsável, 2026-10-31).
const AFTER_LOGIN = '/meus-jogos'

export function safeNext(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return AFTER_LOGIN
  const parsed = new URL(value, 'https://local.invalid')
  // /.//x e /a/..//x normalizam para //x, que o navegador leria como outro site (revisão de segurança, 2026-10-25).
  if (parsed.origin !== 'https://local.invalid' || parsed.pathname === '/entrar' || parsed.pathname.startsWith('//')) return AFTER_LOGIN
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function loginDestination(next: string, add?: string) {
  const params = new URLSearchParams({ next: safeNext(next) })
  if (add && isProductCode(add)) params.set('add', add)
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
