// Teste da trigger de senha em auth.users com o GoTrue REAL (docs/data-contract.md v0.3.2, D-18, I-17, P-15).
// Precisa da stack local no ar (supabase start) com as migrações aplicadas. Não grava nada fora de usuários "gotrue-*",
// que ele mesmo apaga no fim. Uso:
//   node supabase/tests/gotrue/trigger-senha.mjs
// Variáveis opcionais: SUPABASE_URL (http://127.0.0.1:54321), MAILPIT_URL (http://127.0.0.1:54324),
// SUPABASE_PUBLISHABLE_KEY (senão lê de `npx supabase status -o json`), SUPABASE_DB_CONTAINER.
// Cenários: A) cadastro legítimo com senha; B) ataque de cadastro prévio, vítima entra por código;
// C) entrada só por código, com senha definida depois; D) ataque de cadastro prévio, vítima usa "esqueci a senha";
// S) usuários do seed no formato do GoTrue (tokens '' e não NULL): o painel/admin lista e o login por código funciona.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MAIL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(`${root}/supabase/config.toml`, 'utf8'))?.[1];
const DB = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
const DOMAIN = 'keytotwo.test';
const MIN_EMAIL_INTERVAL_MS = 62_000; // o Auth só reenvia e-mail ao mesmo endereço depois de 60 s

function keys() {
  if (process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { publishable: process.env.SUPABASE_PUBLISHABLE_KEY, admin: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const out = execSync('npx --no-install supabase@2.118.0 status -o json', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const j = JSON.parse(out);
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY ?? j.PUBLISHABLE_KEY ?? j.ANON_KEY;
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY ?? j.SECRET_KEY ?? j.SERVICE_ROLE_KEY;
  if (!publishable || !admin) throw new Error('chaves locais não encontradas');
  return { publishable, admin };
}
const { publishable: KEY, admin: ADMIN_KEY } = keys();   // as chaves nunca são impressas

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sql(q) {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-F', '|', '-c', q]).toString().trim();
}
async function api(method, path, body, token, apikey = KEY) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { apikey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo vazio */ }
  return { status: res.status, json };
}
const login = (email, password) => api('POST', '/auth/v1/token?grant_type=password', { email, password });
const pwState = (email) => sql(`select case when encrypted_password is null then 'NULL' when encrypted_password = '' then 'VAZIA' when encrypted_password like '$2%' then 'bcrypt' else 'outra' end || '|' || (email_confirmed_at is not null)::text from auth.users where email = '${email}'`);

async function mailCount(email) {
  const { messages } = await (await fetch(`${MAIL}/api/v1/messages?limit=200`)).json();
  return messages.filter((m) => m.To?.some((t) => t.Address === email)).length;
}
async function newCode(email, before) {
  for (let i = 0; i < 30; i++) {
    const { messages } = await (await fetch(`${MAIL}/api/v1/messages?limit=200`)).json();
    const mine = messages.filter((m) => m.To?.some((t) => t.Address === email));
    if (mine.length > before) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${mine[0].ID}`)).json();
      const m = /(?<!\d)(\d{6})(?!\d)/.exec(`${full.Text} ${full.HTML}`);
      if (m) return m[1];
    }
    await sleep(1000);
  }
  throw new Error(`código não chegou para ${email}`);
}

let failed = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? 'ok    ' : 'FALHOU'} ${label}${cond ? '' : ` ${detail}`}`);
  if (!cond) failed++;
}
const confirmedCount = (email) => Number(sql(`select count(*) from public.funnel_events f join auth.users u on u.id = f.user_id where u.email = '${email}' and f.type = 'account_confirmed'`));
const profileCount = (email) => Number(sql(`select count(*) from public.profiles p join auth.users u on u.id = p.user_id where u.email = '${email}'`));

async function verify(type, email, token) {
  let r = await api('POST', '/auth/v1/verify', { type, email, token });
  if (r.status !== 200 && type === 'email') r = await api('POST', '/auth/v1/verify', { type: 'signup', email, token });
  return r;
}

const ts = Date.now().toString(36);
const e = (n) => `gotrue-${n}-${ts}@${DOMAIN}`;

try {
  // ===== S) usuários do seed no formato do GoTrue ================================================
  console.log('\nS) usuários do seed: o GoTrue lê as 4 colunas de token como texto (NULL derruba o admin/users e o login por código)');
  {
    const seeded = Number(sql("select count(*) from auth.users where email like 'teste-%@keytotwo.test'"));
    if (seeded === 0) {
      console.log('pulado: o seed não está aplicado (rode supabase db reset)');
    } else {
      check('nenhum usuário do seed tem token NULL', Number(sql("select count(*) from auth.users where email like 'teste-%@keytotwo.test' and (confirmation_token is null or recovery_token is null or email_change_token_new is null or email_change is null)")) === 0);
      const list = await api('GET', '/auth/v1/admin/users?per_page=50', null, ADMIN_KEY, ADMIN_KEY);
      check('GET /auth/v1/admin/users lista todos os usuários (200, sem "Database error finding users")', list.status === 200, `HTTP ${list.status}`);
      const hasB = Number(sql("select count(*) from auth.users where email = 'teste-b@keytotwo.test'")) === 1;
      if (hasB) {
        const o = await api('POST', '/auth/v1/otp', { email: 'teste-b@keytotwo.test', create_user: false });
        if (o.status === 429) {
          console.log('pulado: o Auth limita 1 e-mail a cada 60 s por endereço (teste-b); rode de novo depois');
        } else {
          check('login por código do usuário do seed (teste-b) é aceito', o.status === 200, `HTTP ${o.status}`);
        }
      }
    }
  }

  // ===== A) cadastro legítimo com senha ==========================================================
  console.log('\nA) cadastro legítimo com senha: confirmar → senha zerada → senha nova vale');
  {
    const email = e('a'); const pw = 'Senha-Antiga-123';
    const n0 = await mailCount(email);
    check('signup responde 200', (await api('POST', '/auth/v1/signup', { email, password: pw })).status === 200);
    check('logo após o cadastro: senha bcrypt, não confirmado, perfil criado, sem account_confirmed',
      pwState(email) === 'bcrypt|false' && profileCount(email) === 1 && confirmedCount(email) === 0, pwState(email));
    check('login com senha antes de confirmar é recusado', (await login(email, pw)).json?.error_code === 'email_not_confirmed');
    const v = await verify('signup', email, await newCode(email, n0));
    check('confirmação por código dá sessão', v.status === 200 && !!v.json?.access_token);
    check('depois da confirmação a senha é ZERADA (vazia) e o e-mail está confirmado', pwState(email) === 'VAZIA|true', pwState(email));
    check('account_confirmed gravado uma vez', confirmedCount(email) === 1);
    check('a senha de antes da confirmação NÃO vale mais', (await login(email, pw)).json?.error_code === 'invalid_credentials');
    check('senha vazia não entra', (await login(email, '')).status >= 400);
    check('a sessão da confirmação segue válida (GET /user)', (await api('GET', '/auth/v1/user', null, v.json.access_token)).status === 200);
    const u = await api('PUT', '/auth/v1/user', { password: 'Senha-Nova-456' }, v.json.access_token);
    check('updateUser define a senha nova', u.status === 200 && pwState(email) === 'bcrypt|true');
    check('a senha nova vale', (await login(email, 'Senha-Nova-456')).status === 200);
    check('a senha antiga continua recusada', (await login(email, pw)).json?.error_code === 'invalid_credentials');
  }

  // ===== B e D) ataque de cadastro prévio: o atacante cadastra o e-mail da vítima ================
  console.log('\nB) ataque de cadastro prévio, a vítima entra por CÓDIGO   |   D) a vítima usa "esqueci a senha"');
  const atkPw = 'Senha-Do-Atacante-1';
  const b = e('b'); const d = e('d');
  check('B: atacante cadastra o e-mail da vítima', (await api('POST', '/auth/v1/signup', { email: b, password: atkPw })).status === 200 && pwState(b) === 'bcrypt|false');
  check('D: atacante cadastra o e-mail da vítima', (await api('POST', '/auth/v1/signup', { email: d, password: atkPw })).status === 200 && pwState(d) === 'bcrypt|false');
  console.log('   (aguardando 62 s: o Auth só reenvia e-mail ao mesmo endereço depois de 60 s)');
  await sleep(MIN_EMAIL_INTERVAL_MS);
  {
    const before = await mailCount(b);
    check('B: a vítima pede o código', (await api('POST', '/auth/v1/otp', { email: b, create_user: true })).status === 200);
    const v = await verify('email', b, await newCode(b, before));
    check('B: a vítima entra com o código', v.status === 200 && !!v.json?.access_token);
    check('B: a senha do atacante foi ZERADA na confirmação', pwState(b) === 'VAZIA|true', pwState(b));
    check('B: o ATACANTE não consegue entrar com a senha dele', (await login(b, atkPw)).json?.error_code === 'invalid_credentials');
  }
  {
    const before = await mailCount(d);
    check('D: a vítima pede "esqueci a senha"', (await api('POST', '/auth/v1/recover', { email: d })).status === 200);
    const v = await verify('recovery', d, await newCode(d, before));
    check('D: a recuperação dá sessão', v.status === 200 && !!v.json?.access_token);
    check('D: a recuperação confirma o e-mail e a senha do atacante é ZERADA', pwState(d) === 'VAZIA|true', pwState(d));
    check('D: o ATACANTE não consegue entrar com a senha dele', (await login(d, atkPw)).json?.error_code === 'invalid_credentials');
    check('D: a vítima define a senha nova e ela vale', (await api('PUT', '/auth/v1/user', { password: 'Senha-Da-Vitima-5' }, v.json.access_token)).status === 200
      && (await login(d, 'Senha-Da-Vitima-5')).status === 200);
    check('D: o atacante segue recusado', (await login(d, atkPw)).json?.error_code === 'invalid_credentials');
  }

  // ===== C) só por código ========================================================================
  console.log('\nC) só por código: e-mail novo, 1º e 2º código, senha definida depois');
  {
    const email = e('c');
    const n0 = await mailCount(email);
    check('o código cria o usuário (GoTrue guarda um bcrypt aleatório, não confirmado)', (await api('POST', '/auth/v1/otp', { email, create_user: true })).status === 200 && pwState(email) === 'bcrypt|false', pwState(email));
    const v = await verify('email', email, await newCode(email, n0));
    check('1ª verificação confirma; senha vira vazia; perfil e account_confirmed', v.status === 200 && pwState(email) === 'VAZIA|true' && profileCount(email) === 1 && confirmedCount(email) === 1, pwState(email));
    await sleep(2000);
    const n1 = await mailCount(email);
    await api('POST', '/auth/v1/otp', { email, create_user: true });
    const v2 = await verify('email', email, await newCode(email, n1));
    check('2º código entra normalmente com a senha vazia', v2.status === 200 && !!v2.json?.access_token);
    check('quem entra por código define a senha depois e ela vale', (await api('PUT', '/auth/v1/user', { password: 'Senha-C-789' }, v2.json.access_token)).status === 200
      && (await login(email, 'Senha-C-789')).status === 200);
    check('account_confirmed continua uma vez só', confirmedCount(email) === 1);
  }
} finally {
  // limpeza: usuários gotrue-* (o perfil cai em cascata; o funil perde só o user_id)
  try { sql(`delete from auth.users where email like 'gotrue-%-${ts}@${DOMAIN}'`); } catch (err) { console.log('limpeza falhou:', err.message); }
}

console.log(failed === 0 ? '\nPASS: trigger de senha confirmada com o GoTrue real' : `\nFAIL: ${failed} verificação(ões) falharam`);
process.exit(failed === 0 ? 0 : 1);
