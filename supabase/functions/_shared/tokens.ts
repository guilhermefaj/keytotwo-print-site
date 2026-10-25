import { env } from './env.ts'
import { isUuid } from './http.ts'

// Tokens HMAC dos e-mails (docs/api-contract.md 7): <payload>.<assinatura>, ambos em base64url sem preenchimento.
// O propósito (t) faz parte do que é assinado: um token de descadastro não serve como token de entrega.

export const DELIVERY_TTL_SECONDS = 30 * 24 * 3600

interface DeliveryClaims {
  t: 'd'
  e: string // entitlement_id
  g: number // game_id
  x: number // expira em (epoch s)
}

// Descadastro: não expira (RFC 8058); i = emitido em (epoch s).
interface UnsubscribeClaims {
  t: 'u'
  u: string // user_id
  i: number
}

// Indicação (2026-10-25): quem abriu o link do parceiro; p = apelido, l = chegada (epoch s). Vale 30 dias, a janela da
// comissão. O checkout só atribui a venda ao parceiro com este comprovante, não com o que o navegador disser.
interface ReferralClaims {
  t: 'r'
  p: string
  l: number
}
export const REFERRAL_TTL_SECONDS = 30 * 24 * 3600

type VerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: 'invalid' | 'expired' }

const encoder = new TextEncoder()
const B64URL = /^[A-Za-z0-9_-]+$/
// HMAC-SHA256 tem 32 bytes: 43 caracteres em base64url sem preenchimento. Link cortado pelo leitor de e-mail é inválido.
const SIGNATURE_LENGTH = 43

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): ArrayBuffer {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer as ArrayBuffer
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function sign(claims: DeliveryClaims | UnsubscribeClaims | ReferralClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)))
  const [secret] = env.emailLinkSecrets()
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

// Verificação em tempo constante (crypto.subtle.verify), aceitando o segredo anterior durante a rotação.
async function verify(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts.every((p) => p.length > 0 && p.length <= 512 && B64URL.test(p))) return null
  const [payload, signature] = parts
  if (signature.length !== SIGNATURE_LENGTH) return null
  let valid = false
  for (const secret of env.emailLinkSecrets()) {
    if (await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), encoder.encode(payload))) {
      valid = true
      break
    }
  }
  if (!valid) return null
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)))
    return claims && typeof claims === 'object' ? claims : null
  } catch {
    return null
  }
}

export async function signDeliveryToken(entitlementId: string, gameId: number, now = Date.now()): Promise<string> {
  return await sign({ t: 'd', e: entitlementId, g: gameId, x: Math.floor(now / 1000) + DELIVERY_TTL_SECONDS })
}

export async function verifyDeliveryToken(token: string, now = Date.now()): Promise<VerifyResult<DeliveryClaims>> {
  const claims = await verify(token)
  if (!claims || claims.t !== 'd' || !isUuid(claims.e) || !Number.isSafeInteger(claims.g) || typeof claims.x !== 'number') {
    return { ok: false, reason: 'invalid' }
  }
  if (claims.x * 1000 <= now) return { ok: false, reason: 'expired' }
  return { ok: true, claims: claims as unknown as DeliveryClaims }
}

export async function signUnsubscribeToken(userId: string, now = Date.now()): Promise<string> {
  return await sign({ t: 'u', u: userId, i: Math.floor(now / 1000) })
}

export async function verifyUnsubscribeToken(token: string): Promise<VerifyResult<UnsubscribeClaims>> {
  const claims = await verify(token)
  if (!claims || claims.t !== 'u' || !isUuid(claims.u) || typeof claims.i !== 'number') {
    return { ok: false, reason: 'invalid' }
  }
  return { ok: true, claims: claims as unknown as UnsubscribeClaims }
}

export async function signReferralToken(partner: string, now = Date.now()): Promise<string> {
  return await sign({ t: 'r', p: partner, l: Math.floor(now / 1000) })
}

export async function verifyReferralToken(token: string, now = Date.now()): Promise<VerifyResult<ReferralClaims>> {
  const claims = await verify(token)
  if (!claims || claims.t !== 'r' || typeof claims.p !== 'string' || !Number.isSafeInteger(claims.l)) return { ok: false, reason: 'invalid' }
  const landed = (claims.l as number) * 1000
  if (landed > now + 300_000) return { ok: false, reason: 'invalid' }
  if (landed <= now - REFERRAL_TTL_SECONDS * 1000) return { ok: false, reason: 'expired' }
  return { ok: true, claims: claims as unknown as ReferralClaims }
}
