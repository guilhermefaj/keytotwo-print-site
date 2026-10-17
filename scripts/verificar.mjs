// Verificação local antes de abrir PR. Cobre o job Site do CI (.github/workflows/ci.yml) e, além dele, os specs
// que só rodam no stage test (sacola, conta), que em PR de design o CI não exercita.
// Uso: `npm run verificar` ou, só alguns specs, `npm run verificar -- tests/e2e/d1-navigation.spec.ts`.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const only = process.argv.slice(2)
const local = { ...process.env, E2E_PORT: process.env.E2E_PORT || '4181' }
// Porta própria: um servidor velho na 4174 seria reaproveitado pelo Playwright e testaria outro build.
// Build como o do CI: sem .env.local, logo sem API. Variáveis vazias valem mais que o arquivo para o Vite.
const ci = { ...local }
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const name = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=/)?.[1]
    if (name) ci[name] = ''
  }
}
// "carrega direto com 200…" falha por qualquer erro de console. Com o .env.local, o site chama o Supabase hospedado,
// cujo CORS só libera a 5178; por isso esse teste roda no build do CI, e o resto no build com o .env.local.
// Regex sem espaços: no Windows o spawn passa pelo shell, que quebraria o nome em várias palavras.
const directLoad = 'carrega.direto.com.200'

const steps = [
  ['Lint', 'npm', ['run', 'lint'], local],
  ['Fixtures do bloqueio de release', 'node', ['scripts/check-release.mjs', '--self-test'], local],
  ['Testes unitários do blog', 'npm', ['run', 'test:unit'], local],
  ...(only.length ? [] : [
    ['Build como o do CI (sem API; inclui o typecheck)', 'npm', ['run', 'build'], ci],
    ['Conteúdo e preço para release', 'node', ['scripts/check-release.mjs', '--built'], ci],
    ['Smoke: rotas carregam sem erro de console', 'npx', ['playwright', 'test', 'tests/e2e/smoke.spec.ts', '--grep', directLoad], ci],
  ]),
  ['Build com o .env.local (stage test, API simulada nos specs)', 'npm', ['run', 'build'], local],
  ['Testes E2E', 'npx', ['playwright', 'test', ...(only.length ? only : ['--grep-invert', directLoad])], local],
]

const started = Date.now()
for (const [name, command, args, env] of steps) {
  const stepStarted = Date.now()
  console.log(`\n▶ ${name}`)
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  const seconds = Math.round((Date.now() - stepStarted) / 1000)
  if (result.status !== 0) {
    console.error(`\n✘ ${name} falhou (${seconds}s)`)
    process.exit(result.status ?? 1)
  }
  console.log(`✓ ${name} (${seconds}s)`)
}
console.log(`\n✓ Tudo certo em ${Math.round((Date.now() - started) / 1000)}s`)
