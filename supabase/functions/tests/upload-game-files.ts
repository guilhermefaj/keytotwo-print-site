// Sobe os PDFs REAIS dos jogos ao bucket do B2 em {paid|free}/{código}/{versão}/{código}-v{versão}.pdf
// (docs/data-contract.md). Código J é pago (paid/), código F é grátis (free/) — decisão do responsável, 2026-10-16.
// Uso:
//   npx deno@2.9.6 run --no-lock --config supabase/functions/deno.json --allow-read --allow-net \
//     supabase/functions/tests/upload-game-files.ts <modelo de segredos .env> <versão> "[J001] Nome.pdf"... [--pasta-free]
// O código vem do nome do arquivo. Objeto existente nunca é sobrescrito (arquivo publicado é imutável).
// --pasta-free cria free/.bzEmpty, o marcador de pasta do B2, enquanto não há jogo grátis no bucket.
// Nada é impresso além de chave, tamanho, sha256 e o id do arquivo no B2; o registro no banco é outro passo.
import { type B2Config, presignUrl } from '../_shared/b2.ts'

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest('SHA-256', bytes))

const [secretsPath, version, ...rest] = Deno.args
const createFreeFolder = rest.includes('--pasta-free')
const files = rest.filter((arg) => arg !== '--pasta-free')
if (!secretsPath || !/^\d+\.\d+(\.\d+)?$/.test(version ?? '')) throw new Error('Uso: <segredos .env> <versão, ex. 1.0> <arquivos...> [--pasta-free]')

const secrets: Record<string, string> = {}
for (const line of (await Deno.readTextFile(secretsPath)).split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
  if (m) secrets[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const base = { endpoint: secrets.B2_ENDPOINT.replace(/^https?:\/\//, '').replace(/\/+$/, ''), region: secrets.B2_REGION, bucket: secrets.B2_BUCKET }
const write: B2Config = { ...base, keyId: secrets.B2_WRITE_KEY_ID, secret: secrets.B2_WRITE_APPLICATION_KEY }
const read: B2Config = { ...base, keyId: secrets.B2_READ_KEY_ID, secret: secrets.B2_READ_APPLICATION_KEY }

async function exists(key: string) {
  const head = await fetch((await presignUrl(read, { method: 'HEAD', key, expiresIn: 60 })).url, { method: 'HEAD' })
  await head.body?.cancel()
  if (head.status !== 200 && head.status !== 404) throw new Error(`HEAD de ${key} falhou (HTTP ${head.status})`)
  return head.status === 200
}

async function put(key: string, body: ArrayBuffer, headers: Record<string, string>) {
  const response = await fetch((await presignUrl(write, { method: 'PUT', key, expiresIn: 300 })).url, { method: 'PUT', headers, body })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`upload de ${key} falhou (HTTP ${response.status})`)
  return response.headers.get('x-amz-version-id')
}

const result = []
for (const path of files) {
  const code = /^\[([JF]\d{3})\]/.exec(path.split(/[\\/]/).pop() ?? '')?.[1]
  if (!code) throw new Error(`Nome sem código [J000] ou [F000]: ${path}`)
  const access = code.startsWith('J') ? 'paid' : 'free'
  const filename = `${code}-v${version}.pdf`
  const key = `${access}/${code}/${version}/${filename}`
  const data = await Deno.readFile(path)
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const digest = await sha256(bytes)
  if (await exists(key)) { result.push({ object_key: key, status: 'já existe, não sobrescrito' }); continue }

  const b2FileId = await put(key, bytes, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` })
  // Conferência com a chave SÓ LEITURA: conteúdo, tipo e disposição.
  const get = await fetch((await presignUrl(read, { key, expiresIn: 60 })).url)
  const back = await get.arrayBuffer()
  result.push({
    code, access, object_key: key, filename, size_bytes: bytes.byteLength, sha256: digest, b2_file_id: b2FileId,
    leitura_ok: get.status === 200 && back.byteLength === bytes.byteLength && await sha256(back) === digest,
    content_type: get.headers.get('content-type'), content_disposition: get.headers.get('content-disposition'),
  })
}
if (createFreeFolder && !(await exists('free/.bzEmpty'))) {
  await put('free/.bzEmpty', new ArrayBuffer(0), { 'Content-Type': 'application/octet-stream' })
  result.push({ object_key: 'free/.bzEmpty', status: 'pasta free criada' })
}
console.log(JSON.stringify({ bucket: base.bucket, arquivos: result }, null, 2))
