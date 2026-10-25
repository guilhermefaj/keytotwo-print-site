import { useState, type ReactNode } from 'react'
import { supabase } from './supabase'

// Tela do portão: o logo, um título e o conteúdo, centralizados numa folha.
export function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return <main className="gate" id="conteudo">
    <div className="gate-card">
      <p className="gate-logo">KeyToTwo</p>
      <p className="tag">Admin</p>
      <h1>{title}</h1>
      {children}
    </div>
  </main>
}

export function SignOut({ className = 'button button-secondary', icon }: { className?: string; icon?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  return <button className={className} type="button" disabled={busy} onClick={() => { setBusy(true); void supabase?.auth.signOut().finally(() => setBusy(false)) }}>{icon}<span>{busy ? 'Saindo…' : 'Sair'}</span></button>
}
