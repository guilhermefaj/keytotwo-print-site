// Passo LOCAL (fora do git): grava no Vault do banco local a URL e a chave que o job do pg_cron (private.dispatch_tick) usa para chamar
// a função de borda email-dispatch. Sem os dois segredos o job só enfileira os follow-ups e não chama o despacho (avisa no log do banco).
// Nada disto vai para arquivo versionado nem para a tela: a chave é lida de `supabase status -o env` e segue direto para o banco, por stdin.
//
// Uso (com a stack local no ar, depois de cada `supabase db reset`, porque o Vault vive no banco):
//   node supabase/local/aplicar-dispatch-vault.mjs
// Grava: email_dispatch_url = http://supabase_kong_<project_id>:8000/functions/v1/email-dispatch (o pg_net roda dentro da rede do Docker e fala com o Kong)
//        email_dispatch_key = a secret key local ('default'), enviada no cabeçalho apikey.
// Na nuvem (I6) a chave é outra (uma chave nomeada 'dispatch' criada no painel) e os dois segredos são gravados à mão no Vault.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(`${root}/supabase/config.toml`, 'utf8'))?.[1];
if (!projectId) throw new Error('project_id não encontrado em supabase/config.toml');
const dbContainer = `supabase_db_${projectId}`;
const url = `http://supabase_kong_${projectId}:8000/functions/v1/email-dispatch`;

const env = execSync('npx --no-install supabase@2.118.0 status -o env', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const read = (name) => {
  const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
};
const key = read('SECRET_KEY') || read('SERVICE_ROLE_KEY');
if (!key || !/^[A-Za-z0-9._-]{20,}$/.test(key)) throw new Error('chave secreta local não encontrada em `supabase status -o env`');

// A chave entra só por stdin (\\set), nunca na linha de comando nem na saída.
const sql = `\\set ON_ERROR_STOP on
\\set url '${url}'
\\set key '${key}'
\\o /dev/null
select vault.update_secret(id, :'url', 'email_dispatch_url', 'URL do despacho de e-mail (passo local)') from vault.secrets where name = 'email_dispatch_url';
select vault.create_secret(:'url', 'email_dispatch_url', 'URL do despacho de e-mail (passo local)') where not exists (select 1 from vault.secrets where name = 'email_dispatch_url');
select vault.update_secret(id, :'key', 'email_dispatch_key', 'Chave do despacho de e-mail (passo local)') from vault.secrets where name = 'email_dispatch_key';
select vault.create_secret(:'key', 'email_dispatch_key', 'Chave do despacho de e-mail (passo local)') where not exists (select 1 from vault.secrets where name = 'email_dispatch_key');
\\o
`;
execFileSync('docker', ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-f', '-'], { input: sql, stdio: ['pipe', 'pipe', 'inherit'] });

const out = execFileSync('docker', ['exec', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-F', ' = ', '-c',
  "select name, 'gravado (' || length(decrypted_secret) || ' caracteres)' from vault.decrypted_secrets where name in ('email_dispatch_url', 'email_dispatch_key') order by name"]).toString().trim();
console.log(out);
console.log('O job email-dispatch-tick (a cada 5 min) agora chama o despacho; a URL do despacho é', url);
