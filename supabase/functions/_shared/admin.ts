import { env } from './env.ts'
import { HttpError } from './http.ts'

const TIMEOUT_MS = 10_000

export class RpcError extends Error {
  constructor(readonly fn: string, readonly code: string, readonly status: number) {
    super(`RPC ${fn} falhou (${code || `HTTP ${status}`})`)
    this.name = 'RpcError'
  }
}

// O banco só é acessado por RPC (EXECUTE só para service_role), com a chave secreta no header apikey.
// Cada chamada é uma transação. Do erro, guarda só o código: a mensagem do Postgres pode conter dado pessoal.
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${env.supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.secretKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) {
    let code = ''
    try {
      code = String(JSON.parse(text).code ?? '')
    } catch {
      // corpo sem JSON (gateway ou proxy)
    }
    // Defesa em profundidade: sessão de conta sem e-mail confirmado (data-contract 6.1).
    if (code === 'KT009') throw new HttpError(403, 'EMAIL_NOT_CONFIRMED', 'Confirme seu e-mail para continuar.')
    throw new RpcError(fn, code, response.status)
  }
  return (text ? JSON.parse(text) : null) as T
}

// RPCs "returns table" voltam como lista de uma linha.
export async function rpcRow<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const rows = await rpc<T[] | null>(fn, args)
  if (!rows?.length) throw new RpcError(fn, 'EMPTY_RESULT', 200)
  return rows[0]
}

// Apaga o usuário no Auth (admin API), com a chave secreta. 404 conta como feito: a exclusão é idempotente.
// Só depois de delete_account_data: com pedido, consentimento ou fila ainda ligados, o Auth recusa (FK RESTRICT).
export async function deleteAuthUser(userId: string): Promise<void> {
  const response = await fetch(`${env.supabaseUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: env.secretKey() },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  await response.body?.cancel()
  if (!response.ok && response.status !== 404) throw new AuthAdminError(response.status)
}

export class AuthAdminError extends Error {
  constructor(readonly status: number) {
    super(`Auth admin falhou (HTTP ${status})`)
    this.name = 'AuthAdminError'
  }
}
