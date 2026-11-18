import { useEffect, useRef, useState } from 'react'
import { AppAuthCard } from '../components/app/AppAuthShell'
import { appCallback, appChecking } from '../content/app-auth'
import { callbackState, clearAppAuthUrl, readAppAuthParams, type CallbackState } from '../lib/app-auth'

// /auth/callback (app KeyToTwo, 2026-11-18): depois de confirmar o cadastro ou a troca de e-mail no app. A confirmação
// já aconteceu no Supabase do app; a página só lê o fim da URL, mostra o caso certo e apaga os dados da barra. Não chama
// o Supabase. O HTML pré-renderizado não conhece o fragmento, então começa em "Um instante" até o navegador ler.
export default function AuthCallback() {
  const [state, setState] = useState<CallbackState | null>(null)
  // Lido uma vez só: no modo estrito do React o efeito roda duas vezes, e na segunda a URL já está limpa.
  const read = useRef<CallbackState | null>(null)
  useEffect(() => {
    read.current ??= callbackState(readAppAuthParams(window.location.search, window.location.hash))
    clearAppAuthUrl()
    setState(read.current)
  }, [])
  if (!state) return <AppAuthCard kito="calm" title={appChecking.title} text={appChecking.text} />
  const copy = appCallback[state]
  return <AppAuthCard kito={state === 'signup' || state === 'email_change' ? 'happy' : 'calm'} title={copy.title} text={copy.text} />
}
