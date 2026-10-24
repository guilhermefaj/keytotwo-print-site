import { api, ApiError } from './api'
import { siteConfig } from './site-config'

// I5 is integrated. A preview or explicit mock must never change a real preference.
export const emailPreferencesMock = siteConfig.stage === 'preview' || (siteConfig.stage !== 'live' && import.meta.env.VITE_EMAIL_PREFERENCES_MODE === 'mock')

export async function unsubscribeEmail(token: string, signal: AbortSignal) {
  // The server verifies the HMAC. No decoding, logging or persistence in the client.
  const result = await api<{ status: 'unsubscribed' }>('/email/unsubscribe', { method: 'POST', body: { token }, public: true, signal })
  if (result.status !== 'unsubscribed') throw new ApiError('INTERNAL_ERROR')
}
