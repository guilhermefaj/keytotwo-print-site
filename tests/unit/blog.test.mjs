import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { parseBlogPost, readBlogPosts, summarizeBlogPost } from '../../src/lib/blog.server.ts'
import { formatBlogDate, relatedPosts } from '../../src/lib/blog.ts'
import { blogPostingJsonLd, pageSeo, serializeJsonLd } from '../../src/lib/seo.ts'

function source(overrides = {}, body = '## Texto\n\nUm parágrafo para ler.\n\n> Uma citação.\n\n- Primeiro\n- Segundo') {
  const fields = { title: 'Título de teste', description: 'Resumo de teste', date: '2026-10-09', coverAlt: '', draft: true, ...overrides }
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${body}`
}

test('lê frontmatter, Markdown e data pt-BR sem deslocamento de fuso', () => {
  const post = parseBlogPost(source({ tags: ['Impressão'] }), 'como-imprimir.md')
  assert.equal(post.slug, 'como-imprimir')
  assert.deepEqual(post.tags, ['Impressão'])
  assert.equal(post.draft, true)
  assert.match(post.html, /<h2>Texto<\/h2>/)
  assert.match(post.html, /<blockquote>/)
  assert.match(post.html, /<ul>/)
  assert.equal(formatBlogDate(post.date), '9 de outubro de 2026')
  assert.equal(post.readingMinutes, 1)
  assert.equal('html' in summarizeBlogPost(post), false)
})

test('aceita BOM e CRLF, conta palavras e promove H1 para H2', () => {
  const post = parseBlogPost(`\uFEFF${source({}, `# Título\n\n${'palavra '.repeat(400)}`).replaceAll('\n', '\r\n')}`, 'artigo.md')
  assert.equal(post.wordCount, 401)
  assert.equal(post.readingMinutes, 3)
  assert.match(post.html, /<h2>Título<\/h2>/)
  assert.doesNotMatch(post.html, /<h1>/)
})

for (const filename of ['../fuga.md', 'Acentuação.md', 'Teste.md', 'com espaço.md', 'duplo--hifen.md', 'rss.xml.md', 'teste.txt']) {
  test(`rejeita slug inválido: ${filename}`, () => assert.throws(() => parseBlogPost(source(), filename), /slug inválido/))
}

test('rejeita frontmatter ausente, campos duplicados, tipos e datas inválidos', () => {
  for (const input of [
    '# Sem frontmatter', source().replace('title:', 'draft: false\ntitle:'),
    source({ title: '' }), source({ description: 123 }), source({ date: '2026-02-30' }),
    source({ date: 'ontem' }), source({ draft: 'false' }), source({ tags: 'tag' }),
    source({ tags: [''] }), source({}, ''), source().replace('draft: true\n', ''),
  ]) assert.throws(() => parseBlogPost(input, 'artigo.md'), /Blog artigo.md/)
})

test('autor: opcional, aparado, e vira o author do JSON-LD (sem autor, a KeyToTwo)', () => {
  const post = parseBlogPost(source({ author: '  Equipe KeyToTwo ' }), 'com-autor.md')
  assert.equal(post.author, 'Equipe KeyToTwo')
  assert.equal(summarizeBlogPost(post).author, 'Equipe KeyToTwo')
  assert.deepEqual(blogPostingJsonLd(post).author, { '@type': 'Person', name: 'Equipe KeyToTwo' })
  const anonymous = parseBlogPost(source(), 'sem-autor.md')
  assert.equal(anonymous.author, '')
  assert.equal(blogPostingJsonLd(anonymous).author['@type'], 'Organization')
  assert.throws(() => parseBlogPost(source({ author: 42 }), 'artigo.md'), /author deve ser texto/)
})

test('desliga HTML cru e links executáveis; mantém texto escapado', () => {
  const { html } = parseBlogPost(source({}, '<script>alert(1)</script>\n\n[clique](javascript:alert(1))\n\n<img src=x onerror=alert(1)>'), 'seguro.md')
  assert.doesNotMatch(html, /<script>|<img |href="javascript:/)
  assert.match(html, /&lt;script&gt;/)
})

test('valida capas e alternativas e renderiza imagens locais', () => {
  const post = parseBlogPost(source({ cover: '/images/blog/capa.webp', coverAlt: 'Uma capa' }, '![Descrição](/images/blog/capa.webp)'), 'artigo.md')
  assert.equal(post.coverAlt, 'Uma capa')
  assert.match(post.html, /alt="Descrição"/)
  assert.match(post.html, /loading="lazy"/)
  for (const fields of [{ cover: 'https://example.com/capa.jpg' }, { cover: '/images/blog/../../capa.jpg' }, { cover: '/images/blog/capa.webp', coverAlt: '' }]) {
    assert.throws(() => parseBlogPost(source(fields), 'artigo.md'), /cover/)
  }
  for (const body of ['![](/images/blog/capa.webp)', '![Descrição](https://example.com/capa.jpg)']) {
    assert.throws(() => parseBlogPost(source({}, body), 'artigo.md'), /imagens/)
  }
})

test('ordena posts, filtra rascunhos somente em live e valida arquivos de imagem', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kt-blog-test-'))
  try {
    assert.deepEqual(await readBlogPosts({ root, stage: 'live' }), [])
    await mkdir(path.join(root, 'content/blog'), { recursive: true })
    await writeFile(path.join(root, 'content/blog/rascunho.md'), source({ draft: true }))
    await writeFile(path.join(root, 'content/blog/publicado.md'), source({ draft: false, date: '2026-10-01' }))
    await writeFile(path.join(root, 'content/blog/ignorar.txt'), 'não é post')
    for (const stage of ['preview', 'test']) {
      assert.deepEqual((await readBlogPosts({ root, stage })).map(post => post.slug), ['rascunho', 'publicado'])
    }
    assert.deepEqual((await readBlogPosts({ root, stage: 'live' })).map(post => post.slug), ['publicado'])
    await assert.rejects(readBlogPosts({ root, stage: 'production' }), /Stage inválido/)
    await writeFile(path.join(root, 'content/blog/sem-imagem.md'), source({ cover: '/images/blog/ausente.webp', coverAlt: 'Capa ausente' }))
    await assert.rejects(readBlogPosts({ root, stage: 'test' }), /imagem ausente/)
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('kt-blog-test-'))
    await rm(root, { recursive: true, force: true })
  }
})

test('SEO do artigo usa canonical próprio, capa e JSON-LD escapado', () => {
  const post = parseBlogPost(source({ title: '</script><script>alert(1)</script>', cover: '/images/blog/capa.webp', coverAlt: 'Capa' }), 'seo.md')
  const seo = pageSeo('/blog/seo', post)
  assert.match(seo.canonical, /\/blog\/seo$/)
  assert.equal(seo.robots, 'noindex, nofollow')
  const json = blogPostingJsonLd(post)
  assert.equal(json['@type'], 'BlogPosting')
  assert.match(json.image, /\/images\/blog\/capa.webp$/)
  assert.doesNotMatch(serializeJsonLd(json), /<\/script>/)
  assert.deepEqual(JSON.parse(serializeJsonLd(json)), json)
})

test('campos do Google: opcionais, valem mais que título e resumo no <title> e na descrição; JSON-LD mantém o título', () => {
  const plain = parseBlogPost(source(), 'sem-seo.md')
  assert.deepEqual([plain.seoTitle, plain.seoDescription, plain.shareImage], ['', '', undefined])
  assert.deepEqual([pageSeo('/blog/sem-seo', plain).title, pageSeo('/blog/sem-seo', plain).description], ['Título de teste — KeyToTwo', 'Resumo de teste'])
  const post = parseBlogPost(source({ seoTitle: '  Título curto  ', seoDescription: 'Para o Google.' }), 'com-seo.md')
  const seo = pageSeo('/blog/com-seo', post)
  assert.deepEqual([seo.title, seo.description], ['Título curto — KeyToTwo', 'Para o Google.'])
  assert.deepEqual([blogPostingJsonLd(post).headline, blogPostingJsonLd(post).description], ['Título de teste', 'Para o Google.'])
  assert.equal(summarizeBlogPost(post).seoTitle, 'Título curto')
  assert.throws(() => parseBlogPost(source({ seoTitle: 5 }), 'x.md'), /seoTitle deve ser texto/)
})

test('imagem de compartilhamento: só a do próprio post, em /images/blog/og/<endereço>.jpg', () => {
  const post = parseBlogPost(source({ cover: '/images/blog/capa.webp', coverAlt: 'Capa', shareImage: '/images/blog/og/meu-post.jpg' }), 'meu-post.md')
  assert.equal(post.shareImage, '/images/blog/og/meu-post.jpg')
  assert.equal(summarizeBlogPost(post).shareImage, '/images/blog/og/meu-post.jpg')
  for (const shareImage of ['/images/blog/og/outro-post.jpg', '/images/blog/capa.webp', 'https://exemplo.test/x.jpg']) {
    assert.throws(() => parseBlogPost(source({ shareImage }), 'meu-post.md'), /shareImage deve ser/, shareImage)
  }
})

test('posts relacionados: até 3 com tema em comum, do que divide mais temas ao mais novo; sem tema em comum, nenhum', () => {
  const at = (slug, date, tags) => ({ slug, date, tags, title: slug, description: '', author: '', coverAlt: '', draft: false, readingMinutes: 1, seoTitle: '', seoDescription: '' })
  const post = at('atual', '2026-10-20', ['Jogos', 'Casal'])
  const posts = [post, at('um-tema-novo', '2026-10-22', ['casal']), at('dois-temas', '2026-10-01', ['Jogos', 'Casal']), at('um-tema-velho', '2026-09-01', ['Jogos']),
    at('outro-um-tema', '2026-10-10', ['Jogos']), at('sem-tema', '2026-10-23', ['Receitas'])]
  assert.deepEqual(relatedPosts(post, posts).map(item => item.slug), ['dois-temas', 'um-tema-novo', 'outro-um-tema'])
  assert.deepEqual(relatedPosts(at('isolado', '2026-10-20', ['Receitas novas']), posts), [])
})

test('gerador inclui publicados no sitemap/RSS live e exclui rascunhos; preview mantém selo', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kt-blog-seo-test-'))
  try {
    await mkdir(path.join(root, 'content/blog'), { recursive: true })
    await writeFile(path.join(root, 'content/blog/publicado.md'), source({ title: 'A & B < C', draft: false }))
    await writeFile(path.join(root, 'content/blog/rascunho.md'), source({ draft: true }))
    const script = fileURLToPath(new URL('../../scripts/seo-files.mjs', import.meta.url))
    for (const stage of ['live', 'preview', 'test']) {
      const result = spawnSync(process.execPath, [script], {
        cwd: root, env: { ...process.env, VITE_SITE_STAGE: stage, VITE_SITE_URL: 'https://example.test' }, encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)
      const rss = await readFile(path.join(root, 'build/client/blog/rss.xml'), 'utf8')
      const sitemap = await readFile(path.join(root, 'build/client/sitemap.xml'), 'utf8')
      assert.match(rss, /A &amp; B &lt; C/)
      assert.match(rss, /https:\/\/example.test\/blog\/publicado/)
      assert.doesNotMatch(sitemap, /\/admin/)
      if (stage === 'live') {
        assert.match(sitemap, /https:\/\/example.test\/blog\/publicado/)
        assert.doesNotMatch(sitemap, /rascunho/)
        assert.doesNotMatch(rss, /rascunho/)
      } else {
        assert.doesNotMatch(sitemap, /<loc>/)
        assert.match(rss, /Rascunho: Título de teste/)
      }
    }
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('kt-blog-seo-test-'))
    await rm(root, { recursive: true, force: true })
  }
})
