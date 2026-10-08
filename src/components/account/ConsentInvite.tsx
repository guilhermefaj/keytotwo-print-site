import { useState } from 'react'
import { useLocation } from 'react-router'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { MarketingPreference } from './MarketingPreference'

export function ConsentInvite() {
  const { session } = useAuth()
  const { account } = useShop()
  const { pathname } = useLocation()
  const [dismissedUser, setDismissedUser] = useState('')
  const marketing = account.data?.marketing
  const id = session?.user.id
  // Transitional fallback only for older API versions without prompted_at.
  // It is preference state, never an authentication/authorization decision.
  let locallySeen = false
  if (id && typeof window !== 'undefined') {
    try { locallySeen = localStorage.getItem(`ktt-marketing-prompt:${id}`) === 'seen' } catch { /* Storage may be unavailable. */ }
  }
  if (!id || !marketing || pathname === '/entrar' || marketing.opted_in || dismissedUser === id || (marketing.prompted_at === undefined ? locallySeen : marketing.prompted_at !== null)) return null
  function rememberLocally() {
    try { localStorage.setItem(`ktt-marketing-prompt:${id}`, 'seen') } catch { /* Server marker is authoritative when supported. */ }
    setDismissedUser(id!)
  }
  async function dismiss() {
    if (marketing!.prompted_at !== undefined) await api('/account/marketing/prompt', { method: 'POST' })
    rememberLocally(); account.reload()
  }
  return <aside className="consent-invite content-width" aria-labelledby="consent-title"><h2 id="consent-title">Quer receber novidades?</h2><p>Essa escolha é separada dos termos e não é necessária para comprar ou acessar seus jogos.</p><MarketingPreference marketing={marketing} source="signup_prompt" onSaved={() => { rememberLocally(); account.reload() }} onDismiss={dismiss} /></aside>
}
