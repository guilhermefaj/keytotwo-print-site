// Sobe os PDFs REAIS dos jogos ao bucket do B2 em {paid|free}/{código}-{nome}.pdf, ex. paid/J001-rabisque-e-adivinhe.pdf
// (docs/data-contract.md). Código J é pago (paid/), código F é grátis (free/); o nome do jogo fica no caminho e a
// versão não, porque os jogos não devem ser versionados (decisões do responsável, 2026-10-16).
// Uso:
//   npx deno@2.9.6 run --no-lock --config supabase/functions/deno.json --allow-read --allow-net \
//     supabase/functions/tests/upload-game-files.ts <modelo de segredos .env> "[J001] Rabisque e Adivinhe.pdf"... [--versao=1.1] [--pasta-free]
// Código e nome vêm do nome do arquivo. Objeto existente nunca é sobrescrito e a chave nunca é reaproveitada para
// conteúdo diferente: um arquivo trocado sobe com --versao=X.Y, que vira o sufixo -vX.Y na chave (a 1.0 não tem sufixo).
// --pasta-free cria free/.bzEmpty, o marcador de pasta do B2, enquanto não há jogo grátis no bucket.
// Nada é impresso além de chave, tamanho, sha256 e o id do arquivo no B2; o registro no banco é outro passo.
import { attachment, presignUrl } from '../_shared/b2.ts'
import { bucketKeys, sha256 } from './upload-config.ts'

const slug = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const [secretsPath, ...rest] = Deno.args
const createFreeFolder = rest.includes('--pasta-free')
const version = rest.find((arg) => arg.startsWith('--versao='))?.slice('--versao='.length) ?? '1.0'
const files = rest.filter((arg) => !arg.startsWith('--'))
if (!secretsPath || !/^\d+\.\d+(\.\d+)?$/.test(version)) throw new Error('Uso: <segredos .env> <arquivos...> [--versao=X.Y] [--pasta-free]')

const { bucket, write, read } = await bucketKeys(secretsPath)

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
  const match = /^\[([JF]\d{3})\]\s*(.+)\.pdf$/i.exec(path.split(/[\\/]/).pop() ?? '')
  if (!match) throw new Error(`Nome fora do padrão "[J001] Nome do jogo.pdf": ${path}`)
  const [, code, name] = match
  const access = code.startsWith('J') ? 'paid' : 'free'
  const key = `${access}/${code}-${slug(name)}${version === '1.0' ? '' : `-v${version}`}.pdf`
  const filename = `${name.trim()}.pdf`
  const data = await Deno.readFile(path)
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const digest = await sha256(bytes)
  if (await exists(key)) { result.push({ object_key: key, status: 'já existe, não sobrescrito' }); continue }

  const b2FileId = await put(key, bytes, { 'Content-Type': 'application/pdf', 'Content-Disposition': attachment(filename) })
  // Conferência com a chave SÓ LEITURA: conteúdo e tamanho.
  const get = await fetch((await presignUrl(read, { key, expiresIn: 60 })).url)
  const back = await get.arrayBuffer()
  result.push({
    code, access, version, object_key: key, filename, size_bytes: bytes.byteLength, sha256: digest, b2_file_id: b2FileId,
    leitura_ok: get.status === 200 && back.byteLength === bytes.byteLength && await sha256(back) === digest,
  })
}
if (createFreeFolder && !(await exists('free/.bzEmpty'))) {
  await put('free/.bzEmpty', new ArrayBuffer(0), { 'Content-Type': 'application/octet-stream' })
  result.push({ object_key: 'free/.bzEmpty', status: 'pasta free criada' })
}
console.log(JSON.stringify({ bucket, arquivos: result }, null, 2))
