import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { products, productPages } from '../../src/content/products.ts'
import { publicPages } from '../../src/content/site.ts'

test('J001 tem oferta independente sem preço aprovado; vagas sem ficha não viram produtos', () => {
  const single = products.find(product => product.code === 'J001')
  assert.equal(single.slug, 'j001')
  assert.equal(single.offer.price, null)
  assert.equal(single.offer.priceApproved, false)
  assert.deepEqual(single.games.map(game => game.code), ['J001'])
  assert.notEqual(single.offer, products.find(product => product.code === 'P001').offer)
  assert.deepEqual(productPages.map(product => product.slug), ['p001', 'j001'])
  for (const slug of ['hora-dos-artistas', 'tabuleiro-da-sorte', 'jogo-4', 'jogo-5']) assert.equal(Object.hasOwn(publicPages, `/loja/${slug}`), false)
})

test('sitemap live inclui Loja e produtos; preview e test continuam sem URLs indexáveis', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kt-shop-seo-'))
  try {
    for (const stage of ['live', 'preview', 'test']) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/seo-files.mjs', import.meta.url))], {
        cwd: root, env: { ...process.env, VITE_SITE_STAGE: stage, VITE_SITE_URL: 'https://example.test' }, encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      const sitemap = await readFile(path.join(root, 'build/client/sitemap.xml'), 'utf8')
      if (stage === 'live') {
        for (const route of ['/loja', '/loja/p001', '/loja/j001']) assert.ok(sitemap.includes(`<loc>https://example.test${route}</loc>`))
        assert.doesNotMatch(sitemap, /hora-dos-artistas|tabuleiro-da-sorte|jogo-4|jogo-5/)
      } else assert.doesNotMatch(sitemap, /<loc>/)
    }
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('kt-shop-seo-'))
    await rm(root, { recursive: true, force: true })
  }
})
