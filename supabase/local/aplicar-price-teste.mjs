// Passo LOCAL (fora do git): põe nos produtos do banco local o Price de TESTE da conta Stripe de teste.
// O seed versionado usa Prices fictícios (`price_TESTE_<código>`); o checkout real no ambiente local precisa do Price verdadeiro,
// senão a Stripe responde "No such price". Os valores vêm de um .env que o git ignora e NUNCA são gravados em arquivo versionado.
//
// Uso (depois de cada `supabase db reset`, com a stack local no ar):
//   node supabase/local/aplicar-price-teste.mjs [--dry-run] [caminho-do-.env]
// Para cada linha STRIPE_PRICE_ID_<CÓDIGO>=price_... do .env (P001, J001, e os próximos avulsos J002…), atualiza
// products.stripe_price_id do produto com esse código. Produto sem linha no .env não é tocado; linha sem produto no banco
// é avisada e ignorada. Com --dry-run só mostra o que mudaria (…últimos 4 caracteres), sem gravar.
// Onde procura o .env, nesta ordem: argumento; variável KEYTOTWO_ENV_FILE; supabase/functions/.env;
// D:/Maestri/keytotwo-print-site-secrets/.env. Lê só as linhas STRIPE_PRICE_ID_*. Só mexe no banco local (contêiner supabase_db_<project_id>).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(`${root}/supabase/config.toml`, 'utf8'))?.[1];
if (!projectId) throw new Error('project_id não encontrado em supabase/config.toml');
const container = `supabase_db_${projectId}`;

const candidates = [args.find((a) => !a.startsWith('--')), process.env.KEYTOTWO_ENV_FILE, `${root}/supabase/functions/.env`,
  'D:/Maestri/keytotwo-print-site-secrets/.env'].filter(Boolean);
const envFile = candidates.find((p) => existsSync(p));
if (!envFile) throw new Error(`nenhum .env encontrado (procurei: ${candidates.join(', ')})`);

const prices = new Map();
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^STRIPE_PRICE_ID_([A-Za-z0-9-]+)=(.*)$/.exec(line);
  if (!m) continue;
  const price = m[2].trim().replace(/^["']|["']$/g, '');
  if (!/^price_[A-Za-z0-9_]+$/.test(price)) throw new Error(`STRIPE_PRICE_ID_${m[1]} fora do formato price_... em ${envFile}`);
  prices.set(m[1], price);
}
if (!prices.size) throw new Error(`nenhuma linha STRIPE_PRICE_ID_<CÓDIGO> em ${envFile}`);

const psql = (sql, vars = {}) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA',
  '-v', 'ON_ERROR_STOP=1', ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', '-'], { input: sql }).toString().trim();

const where = envFile.replaceAll('\\', '/');
for (const [code, price] of prices) {
  const current = psql("select stripe_price_id from public.products where code = :'code';\n", { code });
  if (!current) { console.log(`${code}: sem produto no banco local, ignorado (rode supabase db reset?)`); continue; }
  if (current === price) { console.log(`${code}: já está com o Price de teste (…${price.slice(-4)})`); continue; }
  if (dryRun) { console.log(`${code}: [dry-run] mudaria …${current.slice(-4)} → …${price.slice(-4)}`); continue; }
  psql("update public.products set stripe_price_id = :'price' where code = :'code';\n", { code, price });
  console.log(`${code}: recebeu o Price de teste (…${price.slice(-4)}) a partir de ${where}`);
}
