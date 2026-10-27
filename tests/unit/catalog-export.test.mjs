import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { exportCatalog } from '../../scripts/catalog-export.mjs'

// Exportação do catálogo (scripts/catalog-export.mjs): a API é simulada; o arquivo gerado é carregado como o build faz.
const VERSION = 'b'.repeat(32)
const SUPABASE = 'https://projeto.supabase.teste'
const pack = { code: 'P001', kind: 'bundle', name: 'Pacote', price: { unit_amount: 2990, currency: 'brl' }, list_price: { amount: 3990, label: 'Preço de lançamento' }, games: [{ code: 'J001', name: 'A' }, { code: 'J004', name: 'B' }] }
const single = { code: 'J001', kind: 'single', name: 'A', price: { unit_amount: 990, currency: 'brl' }, games: [{ code: 'J001', name: 'A' }] }

const BANNER = { code: 'BLACK26', text: 'Black Friday: 30% com {cupom}' }

function fakeFetch({ products = [pack, single], banner = BANNER, salesOpenAt, version = VERSION, status = 200 } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', apikey: new Headers(init.headers).get('apikey') })
    if (url.endsWith('/rest/v1/rpc/get_catalog_version')) return new Response(JSON.stringify(version))
    return new Response(JSON.stringify({ products, banner, ...(salesOpenAt === undefined ? {} : { sales_open_at: salesOpenAt }) }), { status })
  }
  return { fetch, calls }
}

async function withRoot(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'kt-catalog-export-'))
  try {
    await mkdir(path.join(root, 'src/content'), { recursive: true })
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('catálogo: a versão (antes) e o /catalog viram o retrato do build e o /catalogo/versao.json', async () => {
  await withRoot(async (root) => {
    const { fetch, calls } = fakeFetch()
    const result = await exportCatalog({ root, supabaseUrl: `${SUPABASE}/`, apiKey: 'publicavel', fetch })
    assert.deepEqual(result, { version: VERSION, products: 2 })
    assert.deepEqual(calls.map(call => [call.method, call.url, call.apikey]), [
      ['POST', `${SUPABASE}/rest/v1/rpc/get_catalog_version`, 'publicavel'],
      ['GET', `${SUPABASE}/functions/v1/api/catalog`, 'publicavel'],
    ])
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'public/catalogo/versao.json'), 'utf8')), { version: VERSION })
    // O arquivo gerado é TypeScript de verdade: o tipo vem de catalog.ts, que aqui não existe; o Node só tira os tipos.
    const { catalogSnapshot, promoBanner, salesOpenAt } = await import(pathToFileURL(path.join(root, 'src/content/catalog-snapshot.ts')).href)
    assert.deepEqual(catalogSnapshot, [
      { code: 'P001', price: { unit_amount: 2990, currency: 'brl' }, list_price: { amount: 3990, label: 'Preço de lançamento' }, games: ['J001', 'J004'] },
      { code: 'J001', price: { unit_amount: 990, currency: 'brl' }, list_price: null, games: ['J001'] },
    ])
    assert.deepEqual(promoBanner, BANNER)
    // A API de antes da prévia não manda a abertura: a loja fica aberta.
    assert.equal(salesOpenAt, null)
  })
})

test('catálogo: na prévia do lançamento, o build guarda a abertura das vendas', async () => {
  await withRoot(async (root) => {
    await exportCatalog({ root, supabaseUrl: SUPABASE, apiKey: 'k', fetch: fakeFetch({ salesOpenAt: '2026-11-09T22:00:00.000Z' }).fetch })
    const { salesOpenAt } = await import(pathToFileURL(path.join(root, 'src/content/catalog-snapshot.ts')).href)
    assert.equal(salesOpenAt, '2026-11-09T22:00:00.000Z')
  })
})

test('catálogo: sem cupom com faixa, a faixa do build é null', async () => {
  await withRoot(async (root) => {
    await exportCatalog({ root, supabaseUrl: SUPABASE, apiKey: 'k', fetch: fakeFetch({ banner: null }).fetch })
    const { promoBanner } = await import(pathToFileURL(path.join(root, 'src/content/catalog-snapshot.ts')).href)
    assert.equal(promoBanner, null)
  })
})

test('catálogo: resposta ruim para o build sem gravar nada', async () => {
  for (const [label, options] of [
    ['HTTP 500', { status: 500 }],
    ['versão inválida', { version: 'x' }],
    ['produto sem código', { products: [{ ...single, code: 'j1' }] }],
    ['preço inválido', { products: [{ ...single, price: { unit_amount: '990', currency: 'brl' } }] }],
    ['riscado sem rótulo', { products: [{ ...pack, list_price: { amount: 3990, label: ' ' } }] }],
    ['faixa sem código', { banner: { code: 'black 26', text: 'Black Friday' } }],
    ['abertura que não é data', { salesOpenAt: 'amanhã' }],
  ]) {
    await withRoot(async (root) => {
      await assert.rejects(exportCatalog({ root, supabaseUrl: SUPABASE, apiKey: 'k', fetch: fakeFetch(options).fetch }), /Catálogo:/, label)
      await assert.rejects(readFile(path.join(root, 'src/content/catalog-snapshot.ts')), label)
    })
  }
})
