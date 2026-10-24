// Catálogo no banco (2026-10-24): antes do build, traz o catálogo à venda (GET /catalog da API: o preço da Stripe, o
// riscado da promoção e os jogos de cada produto, na ordem do banco) para src/content/catalog-snapshot.ts. Só os builds
// da VPS rodam isto (BLOG_SOURCE=api no Dockerfile); fora dela, o site usa o retrato do repositório. A versão vai
// para /catalogo/versao.json: o vigia da VPS compara com a do banco, e o admin diz se a loja está em dia. A versão é lida
// antes do catálogo: se ele mudar no meio, a versão gravada fica para trás e o vigia reconstrói de novo. Qualquer falha
// para o build: a loja no ar não muda.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const TIMEOUT_MS = 30_000
const CODE = /^[A-Z][A-Z0-9-]{1,23}$/

const isPrice = (value) => value === null || (Number.isInteger(value?.unit_amount) && value.unit_amount >= 0 && /^[a-z]{3}$/.test(value?.currency ?? ''))
const isListPrice = (value) => value === null || value === undefined || (Number.isInteger(value?.amount) && value.amount > 0 && typeof value?.label === 'string' && value.label.trim() !== '')

export async function exportCatalog({ root, supabaseUrl, apiKey, fetch = globalThis.fetch }) {
  const base = supabaseUrl.replace(/\/+$/, '')
  const headers = { apikey: apiKey, 'Content-Type': 'application/json' }
  const versionResponse = await fetch(`${base}/rest/v1/rpc/get_catalog_version`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!versionResponse.ok) throw new Error(`Catálogo: get_catalog_version respondeu HTTP ${versionResponse.status}`)
  const version = await versionResponse.json()
  if (typeof version !== 'string' || !/^[0-9a-f]{32}$/.test(version)) throw new Error('Catálogo: versão inválida')

  const response = await fetch(`${base}/functions/v1/api/catalog`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Catálogo: /catalog respondeu HTTP ${response.status}`)
  const { products } = await response.json()
  if (!Array.isArray(products)) throw new Error('Catálogo: resposta inválida de /catalog')
  const entries = products.map((product) => {
    const games = Array.isArray(product?.games) ? product.games.map((game) => game?.code) : null
    if (!CODE.test(product?.code ?? '') || !isPrice(product.price) || !isListPrice(product.list_price) || !games?.every((code) => CODE.test(code ?? ''))) {
      throw new Error(`Catálogo: produto inválido em /catalog (${String(product?.code)})`)
    }
    return { code: product.code, price: product.price, list_price: product.list_price ?? null, games }
  })

  await writeFile(path.join(root, 'src/content/catalog-snapshot.ts'), [
    '// Gerado por scripts/catalog-export.mjs no build da VPS, a partir do /catalog. No repositório (local e CI) fica o',
    '// retrato do catálogo do banco em 2026-10-24. Não edite à mão: o preço e os pacotes mudam no admin.',
    "import type { CatalogEntry } from './catalog.ts'",
    '',
    'export const catalogSnapshot: readonly CatalogEntry[] = [',
    ...entries.map((entry) => `  ${JSON.stringify(entry)},`),
    ']',
    '',
  ].join('\n'))
  await mkdir(path.join(root, 'public/catalogo'), { recursive: true })
  await writeFile(path.join(root, 'public/catalogo/versao.json'), `${JSON.stringify({ version })}\n`)
  return { version, products: entries.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const apiKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl || !apiKey) throw new Error('Catálogo: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórias')
  const result = await exportCatalog({ root: process.cwd(), supabaseUrl, apiKey })
  console.log(`Catálogo: ${result.products} produtos da versão ${result.version}`)
}
