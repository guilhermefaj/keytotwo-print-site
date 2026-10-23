import { useEffect, useState } from 'react'
import { siteUrl } from './supabase'

// O site guarda a versão do blog que foi para o ar (/blog/versao.json); igual à do banco, está em dia.
// Enquanto difere, confere de novo a cada 10 s (um arquivo estático do site): o vigia da VPS percebe em até 1 minuto e
// reconstrói o site em cerca de 1 minuto.
type Sync = 'checking' | 'synced' | 'pending' | 'unknown'

export function SiteStatus({ version, hasPublished = true, synced = 'O site está em dia com os posts publicados.' }: { version: string; hasPublished?: boolean; synced?: string }) {
  const [state, setState] = useState<{ version: string; sync: Sync }>({ version, sync: 'checking' })
  const sync = state.version === version ? state.sync : 'checking'
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const check = () => fetch(`${siteUrl}/blog/versao.json`, { cache: 'no-store', signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then((live: { version?: string } | null) => {
        const next: Sync = !live?.version ? 'unknown' : live.version === version ? 'synced' : 'pending'
        setState({ version, sync: next })
        if (next === 'pending') timer = setTimeout(check, 10_000)
      }, () => { if (!controller.signal.aborted) setState({ version, sync: 'unknown' }) })
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [version])
  if (sync === 'checking' || (sync === 'unknown' && !hasPublished)) return null
  const text = sync === 'synced' ? synced
    : sync === 'pending' ? 'Atualizando o site com as últimas mudanças. Leva 1 ou 2 minutos; este aviso muda quando terminar.'
      : 'Não deu para conferir se o site já tem as últimas mudanças.'
  return <p className={`site-sync site-sync-${sync}`} role="status"><span aria-hidden="true" className="site-sync-dot" />{text}</p>
}
