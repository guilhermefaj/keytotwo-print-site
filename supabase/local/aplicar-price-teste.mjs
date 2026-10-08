// Passo LOCAL (fora do git): põe no P001 do banco local o Price de TESTE da conta Stripe de teste.
// O seed versionado usa o Price fictício `price_TESTE_P001`; o checkout real no ambiente local precisa do Price verdadeiro,
// senão a Stripe responde "No such price". O valor vem de um .env que o git ignora e NUNCA é gravado em arquivo versionado.
//
// Uso (depois de cada `supabase db reset`, com a stack local no ar):
//   node supabase/local/aplicar-price-teste.mjs [caminho-do-.env]
// Onde procura STRIPE_PRICE_ID_P001, nesta ordem: argumento; variável KEYTOTWO_ENV_FILE; supabase/functions/.env;
// D:/Maestri/keytotwo-print-site-secrets/.env. Lê só essa linha. Só mexe no banco local (contêiner supabase_db_<project_id>).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(`${root}/supabase/config.toml`, 'utf8'))?.[1];
if (!projectId) throw new Error('project_id não encontrado em supabase/config.toml');
const container = `supabase_db_${projectId}`;

const candidates = [process.argv[2], process.env.KEYTOTWO_ENV_FILE, `${root}/supabase/functions/.env`,
  'D:/Maestri/keytotwo-print-site-secrets/.env'].filter(Boolean);
const envFile = candidates.find((p) => existsSync(p));
if (!envFile) throw new Error(`nenhum .env encontrado (procurei: ${candidates.join(', ')})`);

const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('STRIPE_PRICE_ID_P001='));
const price = line?.slice('STRIPE_PRICE_ID_P001='.length).trim().replace(/^["']|["']$/g, '');
if (!price || !/^price_[A-Za-z0-9_]+$/.test(price)) {
  throw new Error(`STRIPE_PRICE_ID_P001 ausente ou fora do formato price_... em ${envFile}`);
}

const out = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA',
  '-v', 'ON_ERROR_STOP=1', '-v', `price=${price}`, '-f', '-'],
{ input: "update public.products set stripe_price_id = :'price' where code = 'P001' returning code;\n" }).toString().trim();
if (!out.split('\n').includes('P001')) throw new Error('o produto P001 não existe no banco local (rode supabase db reset)');

console.log(`P001 recebeu o Price de teste (…${price.slice(-4)}) a partir de ${envFile.replace(/\\/g, '/')}`);
