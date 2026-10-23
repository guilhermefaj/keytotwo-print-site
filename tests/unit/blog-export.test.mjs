import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { exportBlog } from '../../scripts/blog-export.mjs'
import { readBlogPosts } from '../../src/lib/blog.server.ts'

// Exportação do blog (scripts/blog-export.mjs): a API e o bucket são simulados; o resultado passa pelo leitor do build.
const VERSION = 'a'.repeat(32)
const MEDIA = 'https://blog.s3.teste.backblazeb2.com'
const post = (extra = {}) => ({
  slug: 'jogos-para-casais', title: 'Jogos: "para" casais', description: 'Ideias para a noite.', author: 'Equipe KeyToTwo', date: '2026-10-23',
  cover: '/images/blog/2026/10/ab12cd34-capa.webp', cover_alt: 'Mesa com o jogo', tags: ['Jogos', 'Casal'],
  body: '# Começo\n\nTexto com ---\n\n---\n\n![Cartas na mesa](/images/blog/2026/10/ef56ab78-cartas.webp)', ...extra,
})

function fakeFetch({ posts = [post()], status = 200, images = {} } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    calls.push({ url, apikey: new Headers(init.headers).get('apikey') })
    if (url.endsWith('/blog/posts')) return new Response(JSON.stringify({ version: VERSION, posts, media_base: MEDIA }), { status })
    const key = url.slice(MEDIA.length + 1)
    // null no mapa: a imagem falta no bucket. A capa é uma imagem de verdade (vira a de compartilhar); as outras, bytes quaisquer.
    if (images[key] === null) return new Response('nada', { status: 404 })
    return new Response(images[key] ?? (key.endsWith('-capa.webp') ? await readFile('public/media/icons/kito-192.png') : 'imagem'))
  }
  return { fetch, calls }
}

async function withRoot(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'kt-blog-export-'))
  try {
    await mkdir(path.join(root, 'content/blog'), { recursive: true })
    await writeFile(path.join(root, 'content/blog/exemplo-do-repositorio.md'), '---\ntitle: x\n---\nx')
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('troca os arquivos do repositório pelos publicados, baixa as imagens e grava a versão', () => withRoot(async root => {
  const { fetch, calls } = fakeFetch()
  const result = await exportBlog({ root, apiUrl: 'https://api.teste/functions/v1/api/', apiKey: 'chave-publica', fetch })
  assert.deepEqual(result, { version: VERSION, posts: 1, images: 2 })
  assert.equal(existsSync(path.join(root, 'content/blog/exemplo-do-repositorio.md')), false)
  assert.deepEqual(calls.map(call => call.url).sort(), [
    'https://api.teste/functions/v1/api/blog/posts', `${MEDIA}/2026/10/ab12cd34-capa.webp`, `${MEDIA}/2026/10/ef56ab78-cartas.webp`])
  assert.equal(calls.find(call => call.url.endsWith('/blog/posts')).apikey, 'chave-publica')
  const [read] = await readBlogPosts({ root, stage: 'live' })
  assert.equal(read.title, 'Jogos: "para" casais')
  assert.equal(read.author, 'Equipe KeyToTwo')
  assert.equal(read.date, '2026-10-23')
  assert.deepEqual(read.tags, ['Jogos', 'Casal'])
  assert.equal(read.draft, false)
  assert.match(read.html, /<h2>Começo<\/h2>[\s\S]*<hr>[\s\S]*src="\/images\/blog\/2026\/10\/ef56ab78-cartas.webp"/)
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'public/blog/versao.json'), 'utf8')), { version: VERSION })
  // A capa vira a imagem de compartilhar: JPEG 1200×630 no endereço do post.
  assert.equal(read.shareImage, '/images/blog/og/jogos-para-casais.jpg')
  const share = await sharp(path.join(root, 'public/images/blog/og/jogos-para-casais.jpg')).metadata()
  assert.deepEqual([share.format, share.width, share.height], ['jpeg', 1200, 630])
  assert.deepEqual([read.seoTitle, read.seoDescription], ['', ''])
}))

test('campos do Google vão para o frontmatter; post sem capa não ganha imagem de compartilhar', () => withRoot(async root => {
  const { fetch } = fakeFetch({ posts: [post({ cover: null, cover_alt: '', body: 'Texto.', seo_title: 'Título curto', seo_description: 'Para o Google.' })] })
  await exportBlog({ root, apiUrl: 'https://api.teste/functions/v1/api', apiKey: 'chave', fetch })
  const [read] = await readBlogPosts({ root, stage: 'live' })
  assert.deepEqual([read.seoTitle, read.seoDescription, read.shareImage], ['Título curto', 'Para o Google.', undefined])
  assert.equal(existsSync(path.join(root, 'public/images/blog/og')), false)
}))

test('sem posts publicados: content/blog vazio e versão gravada', () => withRoot(async root => {
  const { fetch } = fakeFetch({ posts: [] })
  assert.deepEqual(await exportBlog({ root, apiUrl: 'https://api.teste', apiKey: 'k', fetch }), { version: VERSION, posts: 0, images: 0 })
  assert.deepEqual(await readBlogPosts({ root, stage: 'live' }), [])
}))

test('para o build quando a API falha, um post não passa nas regras ou falta imagem no bucket', () => withRoot(async root => {
  await assert.rejects(exportBlog({ root, apiUrl: 'https://api.teste', apiKey: 'k', fetch: fakeFetch({ status: 503 }).fetch }), /HTTP 503/)
  await assert.rejects(exportBlog({ root, apiUrl: 'https://api.teste', apiKey: 'k', fetch: fakeFetch({ posts: [post({ body: '![x](https://fora.test/x.png)' })] }).fetch }), /jogos-para-casais.md: imagens do texto/)
  await assert.rejects(exportBlog({ root, apiUrl: 'https://api.teste', apiKey: 'k', fetch: fakeFetch({ images: { '2026/10/ab12cd34-capa.webp': null } }).fetch }), /ab12cd34-capa.webp respondeu HTTP 404/)
}))
