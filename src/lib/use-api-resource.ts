import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiErrorMessage } from './api'
import { useAuth } from './auth-context'
import { authConfigured } from './supabase'

export function useApiResource<T>(path: string, isPublic = false, paused = false) {
  const { session } = useAuth()
  const enabled = !paused && authConfigured && (isPublic || Boolean(session))
  const [revision, setRevision] = useState(0)
  const owner = `${path}:${isPublic ? 'public' : session?.user.id}`
  const key = `${owner}:${revision}`
  const [result, setResult] = useState<{ key: string; owner: string; data?: T; error?: string }>({ key: '', owner: '' })
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const inflight = useRef<AbortController | null>(null)
  // A resposta de uma mutação já traz o recurso atualizado: usa direto, sem buscar de novo. Uma leitura ainda em
  // andamento começou antes da mutação e chegaria depois com o estado velho, então é descartada.
  const replace = useCallback((data: T) => { inflight.current?.abort(); setResult({ key, owner, data }) }, [key, owner])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    inflight.current = controller
    api<T>(path, { signal: controller.signal, public: isPublic }).then(
      data => { if (!controller.signal.aborted) setResult({ key, owner, data }) },
      error => { if (!controller.signal.aborted) setResult({ key, owner, error: apiErrorMessage(error) }) },
    )
    return () => controller.abort()
  }, [enabled, key, owner, path, isPublic])
  const current = enabled && result.key === key
  // Keep current-user content mounted during refreshes (focus and form feedback).
  // Never retain it when the authenticated owner changes.
  return { data: enabled && result.owner === owner ? result.data : undefined, error: current ? result.error : undefined, loading: enabled && !current, reload, replace }
}
