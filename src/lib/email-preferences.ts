import { api, ApiError } from './api'
import { siteConfig } from './site-config'

// I5 is integrated. A preview or explicit mock must never change a real preference.
export const emailPreferencesMock = siteConfig.stage === 'preview' || (siteConfig.stage !== 'live' && import.meta.env.VITE_EMAIL_PREFERENCES_MODE === 'mock')

// O link do e-mail: o token assinado (e-mails do site) ou o id do contato no Plunk, com o do e-mail de origem (rodapé dos
// e-mails dele, que o Traefik traz para cá desde 2026-11-01).
export type UnsubscribeLink = { token: string } | { contact: string; email_id?: string }

export async function unsubscribeEmail(link: UnsubscribeLink, signal: AbortSignal) {
  // The server verifies the HMAC or the Plunk contact. No decoding, logging or persistence in the client.
  const result = await api<{ status: 'unsubscribed' }>('/email/unsubscribe', { method: 'POST', body: link, public: true, signal })
  if (result.status !== 'unsubscribed') throw new ApiError('INTERNAL_ERROR')
}
