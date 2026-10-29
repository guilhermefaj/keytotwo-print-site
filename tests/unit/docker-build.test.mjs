import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// O `docker build` só enxerga o que o .dockerignore libera e o Dockerfile copia. Um script novo no `npm run build`
// que fique de fora quebra o deploy (aconteceu com scripts/html-priorities.mjs), então a lista é conferida aqui.
const root = new URL('../../', import.meta.url)
const read = file => readFileSync(new URL(file, root), 'utf8')
const { scripts } = JSON.parse(read('package.json'))

// Scripts .mjs que um script do package.json chama, seguindo os `npm run <outro>`.
function buildScripts(name, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const command = scripts[name] ?? ''
  const nested = [...command.matchAll(/npm run ([\w:-]+)/g)].flatMap(match => buildScripts(match[1], seen))
  return [...new Set([...command.matchAll(/scripts\/[\w.-]+\.mjs/g)].map(match => match[0]).concat(nested))]
}

// Glob do .dockerignore como regex: `**` cruza pastas, `*` não; o padrão vale para a pasta e o que está dentro dela.
function globToRegex(pattern) {
  const body = pattern.split('**').map(part => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')).join('.*')
  return new RegExp(`^(?:.*/)?${body}(?:/.*)?$`)
}

// Padrões do .dockerignore em ordem; o último que casa decide (com `!`, o arquivo volta para o contexto).
function ignored(file) {
  let excluded = false
  for (const raw of read('.dockerignore').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negated = line.startsWith('!')
    if (globToRegex((negated ? line.slice(1) : line).replace(/^\*\*\//, '')).test(file)) excluded = !negated
  }
  return excluded
}

const copiedBy = dockerfile => read(dockerfile).split(/\r?\n/).filter(line => /^COPY\s/.test(line) && !line.includes('--from=')).flatMap(line => line.split(/\s+/).slice(1, -1))
const copied = copiedBy('Dockerfile')

// Arquivos que um arquivo importa por caminho relativo, seguindo os imports do código (.ts, .tsx, .mjs).
function localImports(file, found = new Set()) {
  for (const [, spec] of read(file).matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = path.posix.join(path.posix.dirname(file), spec)
    const target = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(new URL(candidate, root)) && statSync(new URL(candidate, root)).isFile())
    if (!target || found.has(target)) continue
    found.add(target)
    if (/\.(?:tsx?|mjs)$/.test(target)) localImports(target, found)
  }
  return found
}

test('o build cita scripts que existem e os conhecemos', () => {
  const used = buildScripts('build')
  assert.ok(used.includes('scripts/html-priorities.mjs'), 'o build roda o html-priorities')
  for (const file of used) assert.doesNotThrow(() => read(file), `${file} existe`)
})

test('todo scripts/*.mjs do build é copiado pelo Dockerfile e liberado pelo .dockerignore', () => {
  for (const file of buildScripts('build')) {
    assert.ok(copied.some(source => source === file || source === 'scripts/' || source === 'scripts'), `Dockerfile copia ${file}`)
    assert.equal(ignored(file), false, `.dockerignore libera ${file}`)
  }
})

test('os scripts que o Dockerfile roda também entram na imagem', () => {
  const run = [...read('Dockerfile').matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map(match => match[1])
  assert.ok(run.length > 0)
  for (const file of run) {
    assert.ok(copied.includes(file), `Dockerfile copia ${file}`)
    assert.equal(ignored(file), false, `.dockerignore libera ${file}`)
  }
})

test('o .dockerignore continua barrando segredos e o que não vai para a imagem', () => {
  for (const file of ['.env.local', 'supabase/functions/api/index.ts', 'tests/unit/shop.test.mjs', 'scripts/verificar.mjs', 'node_modules/react/index.js']) assert.equal(ignored(file), true, file)
})

// O admin importa alguns arquivos do site e do _shared; um import novo de fora de admin/ que o admin/Dockerfile não
// copia quebra a imagem do admin (aconteceu com src/lib/blog.ts, 2026-10-29).
test('admin: tudo de fora de admin/ que o código do admin importa é copiado pelo admin/Dockerfile', () => {
  const adminCopied = copiedBy('admin/Dockerfile')
  const sources = readdirSync(new URL('admin/src/', root), { recursive: true }).filter(file => /\.tsx?$/.test(file)).map(file => `admin/src/${file.replaceAll('\\', '/')}`)
  const outside = [...new Set(sources.flatMap(file => [...localImports(file)]))].filter(file => !file.startsWith('admin/'))
  assert.ok(outside.includes('src/components/blog/PostHeader.tsx'), 'segue os imports até o topo do post')
  for (const file of outside) {
    assert.ok(adminCopied.includes(file), `admin/Dockerfile copia ${file}`)
    assert.equal(ignored(file), false, `.dockerignore libera ${file}`)
  }
})
