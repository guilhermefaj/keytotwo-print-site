// Node 24: validate evaluated public copy, including pending() and shared offers.
// Preview/test remain usable while commercial and legal approval is pending.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadEnv } from 'vite'
import { readBlogPosts } from '../src/lib/blog.server.ts'

const script = fileURLToPath(import.meta.url)
const marker = /\bPENDENTE\b/i

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Content modules use TypeScript's extensionless relative imports.
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

function inspect(value, location, errors, seen = new WeakSet()) {
  if (typeof value === 'string' && marker.test(value)) errors.push(`PENDENTE em ${location}`)
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const [key, child] of Object.entries(value)) inspect(child, `${location}.${key}`, errors, seen)
}

const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

async function check(root, built) {
  const config = JSON.parse(readFileSync(path.join(root, 'site.config.json'), 'utf8'))
  const env = loadEnv('production', root, 'VITE_SITE_')
  const stage = process.env.VITE_SITE_STAGE || env.VITE_SITE_STAGE || config.stage
  if (!['preview', 'test', 'live'].includes(stage)) throw new Error('VITE_SITE_STAGE inválido')
  if (stage !== 'live') {
    console.log(`Release: stage=${stage}; aprovação comercial exigida somente em live.`)
    return
  }

  const directory = path.join(root, 'src/content')
  const modules = {}
  const errors = []
  const posts = await readBlogPosts({ root, stage })
  inspect(posts, 'content/blog (publicados)', errors)
  for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const exports = await import(pathToFileURL(path.join(directory, name)).href)
    modules[name] = exports
    inspect(exports, `src/content/${name}`, errors)
  }
  const products = modules['products.ts']?.products
  if (!Array.isArray(products) || !products.length) errors.push('Catálogo público ausente ou vazio')
  // O preço vem do catálogo do banco (catalog.ts, desde 2026-10-24): a trava confere só a ação de compra.
  for (const [index, product] of (products || []).entries()) {
    if (product.availability === 'sale') {
      if (product.purchaseAction !== 'cart') errors.push(`Produto à venda sem ação de compra em products[${index}]`)
    } else if (product.availability === 'soon') {
      if (product.purchaseAction != null) errors.push(`Produto em breve com ação de compra em products[${index}]`)
    } else errors.push(`Disponibilidade inválida em products[${index}]`)
  }
  // Relatos de exemplo (placeholder: true) não travam: o live os filtra, e sem relato real a seção some. O build confere
  // que nenhum chegou ao HTML. Relato real tem texto, autor e a nota que o casal deu, de 1 a 5; sem média nem contagem.
  const social = modules['experience.ts']?.experience?.social
  const examples = (social?.testimonials || []).filter(item => item.placeholder === true && item.quote?.trim())
  for (const [index, item] of (social?.testimonials || []).entries()) {
    if (item.placeholder === true) continue
    if (!item.quote?.trim() || !item.author?.trim()) errors.push(`Relato incompleto: ${index + 1}`)
    if (!Number.isInteger(item.rating) || item.rating < 1 || item.rating > 5) errors.push(`Relato sem nota de 1 a 5: ${index + 1}`)
  }

  if (built) {
    const pages = modules['site.ts']?.publicPages
    if (!pages || !Object.keys(pages).length) errors.push('Rotas públicas ausentes')
    for (const route of [...Object.keys(pages || {}), ...posts.map(post => `/blog/${post.slug}`)]) {
      const html = path.resolve(root, 'build/client', `.${route}`, 'index.html')
      if (!existsSync(html)) errors.push(`HTML público ausente: ${route}`)
      else {
        const content = readFileSync(html, 'utf8')
        if (marker.test(content)) errors.push(`PENDENTE no HTML público: ${route}`)
        // Sem o nonce, o CSP do nginx barraria o script e a página não funcionaria (scripts/html-priorities.mjs).
        if (/<script(?![^>]*\snonce="__CSP_NONCE__")(?![^>]*type="application\/ld\+json")[\s>]/.test(content)) errors.push(`Script sem o nonce do CSP: ${route}`)
        if (examples.some(item => content.includes(item.quote) || content.includes(escapeHtml(item.quote)))) errors.push(`Relato de exemplo no HTML público: ${route}`)
      }
    }
    for (const post of (await readBlogPosts({ root, stage: 'preview' })).filter(post => post.draft)) {
      for (const artifact of [`blog/${post.slug}/index.html`, `blog/${post.slug}.data`]) {
        if (existsSync(path.join(root, 'build/client', artifact))) errors.push(`Rascunho no build live: ${artifact}`)
      }
      for (const file of ['sitemap.xml', 'blog/rss.xml']) {
        const artifact = path.join(root, 'build/client', file)
        if (existsSync(artifact) && readFileSync(artifact, 'utf8').includes(`/blog/${post.slug}`)) errors.push(`Rascunho em ${file}: ${post.slug}`)
      }
    }
  }
  if (errors.length) throw new Error(`Release live bloqueada (${errors.length} pendências):\n${errors.join('\n')}`)
  console.log('Release live aprovada: conteúdo sem PENDENTE e preços aprovados.')
}

function selfTest() {
  const root = mkdtempSync(path.join(tmpdir(), 'kt-release-fixtures-'))
  try {
    mkdirSync(path.join(root, 'src/content'), { recursive: true })
    mkdirSync(path.join(root, 'src/lib'), { recursive: true })
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(path.join(root, 'site.config.json'), '{"stage":"preview"}')
    writeFileSync(path.join(root, 'src/lib/pending.ts'), 'export const pending = (subject: string) => `PENDENTE: ${subject}`')
    writeFileSync(path.join(root, 'src/content/site.ts'), 'export const publicPages = {"/": {title: "Fixture"}}')
    mkdirSync(path.join(root, 'build/client'), { recursive: true })
    const cases = [
      ['live limpo', 'live', '"Texto de fixture"', '<h1>Fixture</h1>', 0],
      ['marcador literal', 'live', '"PENDENTE: fixture"', '<h1>Fixture</h1>', 1],
      ['marcador via helper', 'live', 'pending("fixture")', '<h1>Fixture</h1>', 1],
      ['marcador no HTML', 'live', '"Fixture"', '<h1>PENDENTE: fixture</h1>', 1],
      ['preview com pendências', 'preview', 'pending("fixture")', '<h1>PENDENTE</h1>', 0],
      ['test com pendências', 'test', 'pending("fixture")', '<h1>PENDENTE</h1>', 0],
      ['relato incompleto', 'live', '"Fixture"', '<h1>Fixture</h1>', 1, 'sale', 'cart', /Relato incompleto/],
      ['relato sem nota', 'live', '"Fixture"', '<h1>Fixture</h1>', 1, 'sale', 'cart', /Relato sem nota/],
      ['relato de exemplo fora do HTML', 'live', '"Fixture"', '<h1>Fixture</h1>', 0],
      ['relato de exemplo no HTML', 'live', '"Fixture"', '<p>FIXTURE do exemplo</p>', 1, 'sale', 'cart', /Relato de exemplo no HTML/],
      ['soon sem compra', 'live', '"Fixture"', '<h1>Fixture</h1>', 0, 'soon', null],
      ['soon com compra', 'live', '"Fixture"', '<h1>Fixture</h1>', 1, 'soon', 'cart', /Produto em breve com ação de compra/],
      ['soon ainda com pendência', 'live', 'pending("fixture")', '<h1>Fixture</h1>', 1, 'soon', null, /PENDENTE em/],
      ['sale sem compra', 'live', '"Fixture"', '<h1>Fixture</h1>', 1, 'sale', null, /Produto à venda sem ação de compra/],
      ['disponibilidade desconhecida', 'live', '"Fixture"', '<h1>Fixture</h1>', 1, 'invalid', null, /Disponibilidade inválida/],
      ['script com o nonce', 'live', '"Fixture"', '<script nonce="__CSP_NONCE__">1</script><script type="application/ld+json">{}</script>', 0],
      ['script sem o nonce', 'live', '"Fixture"', '<script type="module">1</script>', 1, 'sale', 'cart', /Script sem o nonce do CSP/],
    ]
    for (const [name, stage, copy, html, status, availability = 'sale', purchaseAction = 'cart', diagnostic = /Release live bloqueada/] of cases) {
      const example = '{testimonials:[{quote:"FIXTURE do exemplo",author:"FIXTURE",rating:5,placeholder:true}]}'
      const social = {
        'relato incompleto': '{testimonials:[{quote:null,author:null,rating:5}]}',
        'relato sem nota': '{testimonials:[{quote:"FIXTURE",author:"FIXTURE"}]}',
        'relato de exemplo fora do HTML': example,
        'relato de exemplo no HTML': example,
      }[name]
      writeFileSync(path.join(root, 'src/content/experience.ts'), `export const experience = { social: ${social ?? '{testimonials:[{quote:"FIXTURE de teste",author:"FIXTURE",rating:5}]}'} }`)
      // Um primeiro produto à venda garante que a trava avalia também os seguintes.
      writeFileSync(path.join(root, 'src/content/products.ts'), `import { pending } from '../lib/pending'\nexport const products = [{availability:'sale',purchaseAction:'cart'}, { title: ${copy}, availability: ${JSON.stringify(availability)}, purchaseAction: ${JSON.stringify(purchaseAction)} }]`)
      writeFileSync(path.join(root, 'build/client/index.html'), html)
      const result = spawnSync(process.execPath, [script, '--root', root, '--built'], {
        env: { ...process.env, VITE_SITE_STAGE: stage }, encoding: 'utf8',
      })
      assert.equal(result.status, status, `${name}: ${result.stderr || result.stdout}`)
      if (status === 1) assert.match(result.stderr, diagnostic)
      console.log(`Fixture OK: ${name}`)
    }
    // Use approved test-only fixtures; no real commercial copy is rewritten.
    writeFileSync(path.join(root, 'src/content/products.ts'), 'export const products = [{availability: "sale", purchaseAction: "cart"}]')
    writeFileSync(path.join(root, 'src/content/experience.ts'), 'export const experience = {}')
    writeFileSync(path.join(root, 'build/client/index.html'), '<h1>Fixture</h1>')
    mkdirSync(path.join(root, 'content/blog'), { recursive: true })
    mkdirSync(path.join(root, 'build/client/blog/fixture'), { recursive: true })
    for (const [name, draft, title, body, html, status] of [
      ['post publicado limpo', false, 'Fixture', 'Texto', '<h1>Fixture</h1>', 0],
      ['post com metadado pendente', false, 'PENDENTE', 'Texto', '<h1>Fixture</h1>', 1],
      ['post com corpo pendente', false, 'Fixture', 'PENDENTE', '<h1>Fixture</h1>', 1],
      ['post com HTML pendente', false, 'Fixture', 'Texto', '<p>PENDENTE</p>', 1],
      ['rascunho indevido no build', true, 'Fixture', 'Texto', '<h1>Fixture</h1>', 1],
      ['rascunho pendente excluído', true, 'PENDENTE', 'PENDENTE', '', 0],
    ]) {
      writeFileSync(path.join(root, 'content/blog/fixture.md'), `---\ntitle: ${title}\ndescription: Fixture\ndate: '2026-01-01'\ncoverAlt: ''\ndraft: ${draft}\n---\n${body}`)
      const target = path.join(root, 'build/client/blog/fixture/index.html')
      if (html) writeFileSync(target, html)
      else rmSync(target, { force: true })
      const result = spawnSync(process.execPath, [script, '--root', root, '--built'], {
        env: { ...process.env, VITE_SITE_STAGE: 'live' }, encoding: 'utf8',
      })
      assert.equal(result.status, status, `${name}: ${result.stderr || result.stdout}`)
      if (status === 1) assert.match(result.stderr, /Release live bloqueada/)
      console.log(`Fixture OK: ${name}`)
    }
  } finally {
    // Delete only this process's uniquely created fixture directory.
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('kt-release-fixtures-'))
    rmSync(root, { recursive: true, force: true })
  }
}

try {
  if (process.argv.includes('--self-test')) selfTest()
  else {
    const index = process.argv.indexOf('--root')
    if (index !== -1 && !process.argv[index + 1]) throw new Error('--root exige um diretório')
    await check(path.resolve(index === -1 ? process.cwd() : process.argv[index + 1]), process.argv.includes('--built'))
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
