import { authStorageKey } from '../fixtures/session'

// Sessões do admin para os testes: JWT com o aal no payload (o admin só decodifica; a assinatura não é conferida aqui).
export { authStorageKey }
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (claims: object) => `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ sub: 'qa-admin', role: 'authenticated', aud: 'authenticated', exp: 4102444800, ...claims })}.assinatura`
export const verified = { id: 'fator-1', factor_type: 'totp', status: 'verified', friendly_name: 'Admin KeyToTwo', created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z' }

export function user({ admin = true, factors = [verified] as object[] } = {}) {
  return { id: 'qa-admin', email: 'admin@example.test', email_confirmed_at: '2026-01-01', aud: 'authenticated', role: 'authenticated', app_metadata: admin ? { provider: 'google', admin: true } : { provider: 'google' }, user_metadata: {}, factors }
}
export function session(aal: 'aal1' | 'aal2', who = user()) {
  return { access_token: jwt({ aal, email: who.email }), refresh_token: `refresh-${aal}`, expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: who }
}
