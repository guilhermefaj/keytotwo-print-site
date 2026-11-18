// Páginas de conta do app KeyToTwo (2026-11-18): a leitura do que o Supabase do app manda no fim da URL. Só funções
// puras, sem import, para os testes de unidade (tests/unit/app-auth.test.mjs) e as duas rotas usarem as mesmas regras.
// O Supabase redireciona com os dados no fragmento (#…), que o servidor nunca recebe; um erro também pode vir na query.

export type AppAuthParams = Record<string, string>

// Junta query e fragmento (o fragmento vence) num objeto simples. Nada daqui vai para log.
export function readAppAuthParams(search: string, hash: string): AppAuthParams {
  const params: AppAuthParams = {}
  for (const part of [search.replace(/^\?/, ''), hash.replace(/^#/, '')]) {
    for (const [key, value] of new URLSearchParams(part)) params[key] = value
  }
  return params
}

export type CallbackState = 'signup' | 'email_change' | 'message' | 'error' | 'empty'

// /auth/callback: a confirmação já aconteceu no Supabase; aqui só se escolhe a mensagem. O erro vence tudo.
export function callbackState(params: AppAuthParams): CallbackState {
  if (params.error || params.error_code || params.error_description) return 'error'
  if (params.type === 'email_change') return 'email_change'
  if (params.type === 'signup' || (params.access_token && !params.type)) return 'signup'
  if (params.message) return 'message'
  return 'empty'
}

// /auth/recover: só um link de recuperação completo, sem erro, abre o formulário; o resto é link vencido.
export function recoverTokens(params: AppAuthParams): { access_token: string; refresh_token: string } | null {
  if (params.error || params.error_code || params.error_description) return null
  if (params.type !== 'recovery' || !params.access_token || !params.refresh_token) return null
  return { access_token: params.access_token, refresh_token: params.refresh_token }
}

// As regras de senha do Supabase do app: 8+ caracteres com minúscula, maiúscula, número e símbolo. Os símbolos são os
// mesmos que o Supabase aceita (lower_upper_letters_digits_symbols).
const SYMBOLS = '!@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~'
export function passwordMeetsRules(password: string) {
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password)
    && [...password].some(char => SYMBOLS.includes(char))
}

export type RecoverFailure = 'same' | 'weak' | 'expired' | 'other'

// Traduz o erro do Supabase em um dos casos da página, sem nunca mostrar o texto em inglês.
export function recoverFailure(error: unknown): RecoverFailure {
  const { code, status, name } = (error && typeof error === 'object' ? error : {}) as { code?: unknown; status?: unknown; name?: unknown }
  if (code === 'same_password') return 'same'
  if (code === 'weak_password' || name === 'AuthWeakPasswordError') return 'weak'
  if (status === 401 || status === 403 || code === 'session_not_found' || code === 'bad_jwt' || code === 'session_expired'
    || name === 'AuthSessionMissingError' || name === 'AuthInvalidJwtError') return 'expired'
  return 'other'
}

// Tira o fragmento (e a query) da barra de endereço logo depois da leitura. Mantém o estado do histórico, que o
// React Router usa para voltar e avançar.
export function clearAppAuthUrl() {
  if (window.location.hash || window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname)
}
