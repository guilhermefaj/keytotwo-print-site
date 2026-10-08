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

async function check(root, built) {
  const config = JSON.parse(readFileSync(path.join(root, 'site.config.json'), 'utf8'))
  const env = loadEnv(process.env.SEO_MODE || 'production', root, 'VITE_SITE_')
  const stage = process.env.VITE_SITE_STAGE || env.VITE_SITE_STAGE || config.stage
  if (!['preview', 'test', 'live'].includes(stage)) throw new Error('VITE_SITE_STAGE inválido')
  if (stage !== 'live') {
    console.log(`Release: stage=${stage}; aprovação comercial exigida somente em live.`)
    return
  }

  const directory = path.join(root, 'src/content')
  const modules = {}
  const errors = []
  for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const exports = await import(pathToFileURL(path.join(directory, name)).href)
    modules[name] = exports
    inspect(exports, `src/content/${name}`, errors)
  }
  const products = modules['products.ts']?.products
  if (!Array.isArray(products) || !products.length) errors.push('Catálogo público ausente ou vazio')
  for (const [index, product] of (products || []).entries()) {
    const offer = product.offer
    if (offer?.priceApproved !== true) errors.push(`Preço não aprovado em products[${index}]`)
    if (typeof offer?.price !== 'string' || !offer.price.trim()) errors.push(`Preço ausente em products[${index}]`)
  }
  const social = modules['experience.ts']?.experience?.social
  if (social) {
    if (!Number.isFinite(social.rating) || social.rating <= 0 || social.rating > 5) errors.push('Placeholder: nota da prova social')
    if (!Number.isInteger(social.reviewCount) || social.reviewCount < 1) errors.push('Placeholder: contagem da prova social')
    if (!Array.isArray(social.testimonials) || !social.testimonials.length) errors.push('Placeholder: relatos ausentes')
    for (const [index, item] of (social.testimonials || []).entries()) {
      if (!item.quote?.trim() || !item.author?.trim()) errors.push(`Placeholder: relato ${index + 1}`)
    }
  }

  if (built) {
    const pages = modules['site.ts']?.publicPages
    if (!pages || !Object.keys(pages).length) errors.push('Rotas públicas ausentes')
    for (const route of Object.keys(pages || {})) {
      const html = path.resolve(root, 'build/client', `.${route}`, 'index.html')
      if (!existsSync(html)) errors.push(`HTML público ausente: ${route}`)
      else if (marker.test(readFileSync(html, 'utf8'))) errors.push(`PENDENTE no HTML público: ${route}`)
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
      ['live limpo', 'live', '"Texto de fixture"', true, 'VALOR DE TESTE', '<h1>Fixture</h1>', 0],
      ['marcador literal', 'live', '"PENDENTE: fixture"', true, 'VALOR DE TESTE', '<h1>Fixture</h1>', 1],
      ['marcador via helper', 'live', 'pending("fixture")', true, 'VALOR DE TESTE', '<h1>Fixture</h1>', 1],
      ['preço não aprovado', 'live', '"Fixture"', false, 'VALOR DE TESTE', '<h1>Fixture</h1>', 1],
      ['preço ausente', 'live', '"Fixture"', true, '', '<h1>Fixture</h1>', 1],
      ['marcador no HTML', 'live', '"Fixture"', true, 'VALOR DE TESTE', '<h1>PENDENTE: fixture</h1>', 1],
      ['preview com pendências', 'preview', 'pending("fixture")', false, '', '<h1>PENDENTE</h1>', 0],
      ['test com pendências', 'test', 'pending("fixture")', false, '', '<h1>PENDENTE</h1>', 0],
      ['prova social incompleta', 'live', '"Fixture"', true, 'VALOR DE TESTE', '<h1>Fixture</h1>', 1],
    ]
    for (const [name, stage, copy, approved, price, html, status] of cases) {
      writeFileSync(path.join(root, 'src/content/experience.ts'), `export const experience = { social: ${name === 'prova social incompleta' ? '{rating:null,reviewCount:null,testimonials:[{quote:null,author:null}]}' : '{rating:4,reviewCount:1,testimonials:[{quote:"FIXTURE de teste",author:"FIXTURE"}]}' } }`)
      writeFileSync(path.join(root, 'src/content/products.ts'), `import { pending } from '../lib/pending'\nexport const products = [{ title: ${copy}, offer: {priceApproved: ${approved}, price: ${JSON.stringify(price)}} }]`)
      writeFileSync(path.join(root, 'build/client/index.html'), html)
      const result = spawnSync(process.execPath, [script, '--root', root, '--built'], {
        env: { ...process.env, VITE_SITE_STAGE: stage }, encoding: 'utf8',
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
