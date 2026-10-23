import { useEffect, useState } from 'react'
import { apiBase, publishableKey, supabase } from './supabase'

export class ApiError extends Error {
  constructor(public code: string) { super(code) }
}

// Rotas /admin/* da API (Edge Function): sessão com o segundo fator; o banco confere o admin.
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const session = (await supabase?.auth.getSession())?.data.session
  if (!session) throw new ApiError('UNAUTHENTICATED')
  const headers: Record<string, string> = { apikey: publishableKey, Authorization: `Bearer ${session.access_token}` }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${apiBase}${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(result.error?.code || 'INTERNAL_ERROR')
  return result as T
}

export function apiMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : ''
  if (code === 'UNAUTHENTICATED') return 'Sua sessão terminou. Entre de novo para continuar.'
  if (code === 'MFA_REQUIRED') return 'Confirme o código do app autenticador para continuar.'
  if (code === 'NOT_ADMIN') return 'Esta área é só para a equipe da KeyToTwo.'
  return 'Não deu certo agora. Tente de novo em instantes.'
}

// Leitura de uma rota: troca de caminho descarta a resposta anterior; reload busca de novo no mesmo caminho.
export function useResource<T>(path: string) {
  const [revision, setRevision] = useState(0)
  const key = `${path}#${revision}`
  const [state, setState] = useState<{ key: string; data?: T; error?: unknown }>({ key: '' })
  useEffect(() => {
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal }).then(
      data => setState({ key, data }),
      error => { if (!controller.signal.aborted) setState({ key, error }) },
    )
    return () => controller.abort()
  }, [path, key])
  const current = state.key === key
  return { data: current ? state.data : undefined, error: current ? state.error : undefined, loading: !current, reload: () => setRevision(value => value + 1) }
}

export const money = (amount: number, currency: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount / 100)
export const count = (value: number) => new Intl.NumberFormat('pt-BR').format(value)
