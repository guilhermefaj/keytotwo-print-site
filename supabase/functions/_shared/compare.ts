const encoder = new TextEncoder()

// Compara segredos em tempo constante: HMAC das duas entradas com uma chave aleatória por chamada.
export async function sameSecret(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(expected))
  return await crypto.subtle.verify('HMAC', key, digest, encoder.encode(received))
}
