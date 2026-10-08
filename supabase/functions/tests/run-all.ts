// Roda os testes das funções com um arquivo por processo: contrato (sem rede) e cada integração (KT_INTEGRATION=1).
// Env, fetch e singletons valem para o processo inteiro; um processo por arquivo evita qualquer interferência.
// Uso: ver tests/README.md (deno task test:all | test:contract | test:integration).
const mode = Deno.args[0] ?? 'all'
if (!['all', 'contract', 'integration'].includes(mode)) {
  console.error('uso: run-all.ts [all|contract|integration]')
  Deno.exit(2)
}

const dir = new URL('.', import.meta.url)
const config = new URL('../deno.json', import.meta.url)
const files = [...Deno.readDirSync(dir)].map((entry) => entry.name).filter((name) => name.endsWith('.test.ts')).sort()
const isIntegration = (name: string) => name.endsWith('.integration.test.ts')
const selected = files.filter((name) => mode === 'all' || (mode === 'integration') === isIntegration(name))

if (selected.some(isIntegration) && !['API_URL', 'PUBLISHABLE_KEY', 'SECRET_KEY'].every((name) => Deno.env.get(name))) {
  console.error('Integração: carregue antes o ambiente da stack local (API_URL, PUBLISHABLE_KEY, SECRET_KEY de `supabase status -o env`).')
  Deno.exit(2)
}

const results: { file: string; ok: boolean }[] = []
for (const file of selected) {
  const integration = isIntegration(file)
  console.log(`\n=== ${file} (${integration ? 'integração' : 'contrato'}) ===`)
  const permissions = integration ? ['--allow-env', '--allow-read', '--allow-net', '--allow-run=docker'] : ['--allow-env']
  const { success } = await new Deno.Command(Deno.execPath(), {
    args: ['test', '--no-lock', '--config', config.pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...permissions, new URL(file, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    env: { KT_INTEGRATION: integration ? '1' : '0' },
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  results.push({ file, ok: success })
}

console.log('\n=== resumo ===')
for (const { file, ok } of results) console.log(`${ok ? 'ok    ' : 'FALHOU'} ${file}`)
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} arquivos verdes`)
Deno.exit(failed ? 1 : 0)
