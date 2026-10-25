import { useCallback, useEffect, useState } from 'react'
import { apiBase, publishableKey, supabase } from './supabase'

// code: o código do contrato; message: o texto da API, quando ela explica o que fazer; details: problemas do post etc.
export class ApiError extends Error {
  constructor(public code: string, public apiMessage?: string, public details?: Record<string, unknown>) { super(code) }
}

// Rotas /admin/* da API (Edge Function): sessão com o segundo fator; o banco confere o admin.
// Um Blob (imagem do blog) vai como está, com o tipo dele; o resto vai em JSON.
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const session = (await supabase?.auth.getSession())?.data.session
  if (!session) throw new ApiError('UNAUTHENTICATED')
  const headers: Record<string, string> = { apikey: publishableKey, Authorization: `Bearer ${session.access_token}` }
  const raw = options.body instanceof Blob ? options.body : undefined
  if (options.body !== undefined) headers['Content-Type'] = raw ? raw.type : 'application/json'
  const response = await fetch(`${apiBase}${path}`, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : raw ?? JSON.stringify(options.body), signal: options.signal })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    // O código do app venceu para a API: o portão pede de novo (AuthGate).
    if (result.error?.code === 'MFA_REQUIRED') window.dispatchEvent(new Event(MFA_REQUIRED_EVENT))
    throw new ApiError(result.error?.code || 'INTERNAL_ERROR', result.error?.message, result.error?.details)
  }
  return result as T
}

export const MFA_REQUIRED_EVENT = 'keytotwo-admin:mfa-required'

// Arquivo de uma rota /admin/* (a planilha do parceiro): baixa com a sessão e entrega com o nome dado.
export async function apiDownload(path: string, filename: string) {
  const session = (await supabase?.auth.getSession())?.data.session
  if (!session) throw new ApiError('UNAUTHENTICATED')
  const response = await fetch(`${apiBase}${path}`, { headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}` } })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new ApiError(result.error?.code || 'INTERNAL_ERROR', result.error?.message)
  }
  const url = URL.createObjectURL(await response.blob())
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function apiMessage(error: unknown) {
  const code = error instanceof ApiError ? error.code : ''
  if (code === 'UNAUTHENTICATED') return 'Sua sessão terminou. Entre de novo para continuar.'
  if (code === 'MFA_REQUIRED') return 'Confirme o código do app autenticador para continuar.'
  if (code === 'NOT_ADMIN') return 'Esta área é só para a equipe da KeyToTwo.'
  // Erros de regra (post inválido, endereço repetido, conflito, imagem): a API diz o que fazer.
  if (error instanceof ApiError && error.apiMessage && code !== 'INTERNAL_ERROR') return error.apiMessage
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
  const reload = useCallback(() => setRevision(value => value + 1), [])
  // previous: a última resposta, mesmo de outro caminho, para a tela não piscar enquanto busca de novo.
  return { data: current ? state.data : undefined, previous: state.data, error: current ? state.error : undefined, loading: !current, reload }
}

