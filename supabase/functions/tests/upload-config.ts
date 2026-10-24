// O que as duas ferramentas de upload ao B2 (upload-game-files.ts e upload-test-pdfs.ts) dividem: o sha256 em hex e as
// chaves do bucket lidas do modelo de segredos .env. A de ESCRITA só sai daqui; nada é impresso.
import type { B2Config } from '../_shared/b2.ts'

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
export const sha256 = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))

export async function bucketKeys(secretsPath: string): Promise<{ bucket: string; write: B2Config; read: B2Config }> {
  const secrets: Record<string, string> = {}
  for (const line of (await Deno.readTextFile(secretsPath)).split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m) secrets[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  const base = { endpoint: secrets.B2_ENDPOINT.replace(/^https?:\/\//, '').replace(/\/+$/, ''), region: secrets.B2_REGION, bucket: secrets.B2_BUCKET }
  return {
    bucket: base.bucket,
    write: { ...base, keyId: secrets.B2_WRITE_KEY_ID, secret: secrets.B2_WRITE_APPLICATION_KEY },
    read: { ...base, keyId: secrets.B2_READ_KEY_ID, secret: secrets.B2_READ_APPLICATION_KEY },
  }
}
