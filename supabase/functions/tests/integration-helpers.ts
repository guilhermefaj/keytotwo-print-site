// Testes de integração: stack local no ar (supabase start) e KT_INTEGRATION=1. Como rodar: tests/README.md.
// As URLs e chaves vêm de `supabase status -o env`, carregadas no ambiente sem imprimir valores.
// Com KT_INTEGRATION=1 os testes de contrato ficam inertes e ignorados (contract-helpers.ts), então a pasta
// inteira roda num processo só; o deno task test:all roda ainda um arquivo por processo.
// Os usuários criados aqui usam o domínio example.com e o prefixo teste-, e são removidos no fim.
import { GoTrueClient } from '@supabase/auth-js'
import { setBackgroundRunner } from '../_shared/background.ts'

export const enabled = Deno.env.get('KT_INTEGRATION') === '1'

const value = (name: string) => Deno.env.get(name) ?? ''
export const API_URL = value('API_URL') || 'http://127.0.0.1:54321'
export const MAILPIT_URL = value('MAILPIT_URL') || 'http://127.0.0.1:54324'
const PUBLISHABLE_KEY = value('PUBLISHABLE_KEY')
const SECRET_KEY = value('SECRET_KEY')

if (enabled) {
  Deno.env.set('SUPABASE_URL', API_URL)
  Deno.env.set('SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE_KEY)
  Deno.env.set('SUPABASE_SECRET_KEY', SECRET_KEY)
  // O JSON nomeado teria prioridade sobre as chaves locais (env.ts); no teste vale só a chave local.
  Deno.env.delete('SUPABASE_PUBLISHABLE_KEYS')
  Deno.env.delete('SUPABASE_SECRET_KEYS')
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Um executor de segundo plano para o processo inteiro (despacho de e-mail depois da liberação):
// cada arquivo aguarda com settle(), sem trocar o executor de outro arquivo.
const backgroundTasks: Promise<unknown>[] = []
if (enabled) setBackgroundRunner((task) => backgroundTasks.push(task))

export async function settle(): Promise<void> {
  while (backgroundTasks.length) await Promise.all(backgroundTasks.splice(0))
}

// Rede até serviço externo de teste (B2): uma nova tentativa curta se a conexão falhar (TypeError do fetch).
export async function fetchRetry(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    await sleep(1_000)
    return await fetch(input, init)
  }
}
const run = crypto.randomUUID().slice(0, 8)
export const testEmail = (who: string) => `teste-${who}-${run}@example.com`

export function authClient(): GoTrueClient {
  return new GoTrueClient({ url: `${API_URL}/auth/v1`, headers: { apikey: PUBLISHABLE_KEY }, persistSession: false, autoRefreshToken: false })
}

const adminHeaders = () => ({ apikey: SECRET_KEY, 'Content-Type': 'application/json' })

// Usuário confirmado com senha: a senha entra numa atualização depois da criação, porque a trigger
// de auth.users (data-contract 2.10) zera a senha gravada antes da primeira confirmação.
export async function createUser(email: string, options: { password?: string; confirmed?: boolean } = {}): Promise<string> {
  const confirmed = options.confirmed ?? true
  const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, email_confirm: confirmed, password: confirmed ? undefined : options.password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`criar usuário falhou (HTTP ${res.status})`)
  if (confirmed && options.password) {
    const update = await fetch(`${API_URL}/auth/v1/admin/users/${body.id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ password: options.password }),
    })
    await update.body?.cancel()
    if (!update.ok) throw new Error(`definir senha falhou (HTTP ${update.status})`)
  }
  return body.id
}

// Comportamento da trigger com o admin: senha enviada junto da criação já confirmada não vale.
export async function createConfirmedWithPasswordAtOnce(email: string, password: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  await res.body?.cancel()
  if (!res.ok) throw new Error(`criar usuário falhou (HTTP ${res.status})`)
}

export async function passwordSession(email: string, password: string): Promise<string> {
  const { data, error } = await authClient().signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`login falhou (${error?.code ?? 'sem sessão'})`)
  return data.session.access_token
}

// Remove os usuários deste teste; devolve quantos saíram e quantos o banco recusou (ex.: FK de histórico).
// A listagem do admin falha se algum usuário do banco tiver colunas de token NULL (seed inserido por SQL).
export async function removeTestUsers(): Promise<{ removed: number; kept: number }> {
  const res = await fetch(`${API_URL}/auth/v1/admin/users?per_page=200`, { headers: adminHeaders() })
  const listed = await res.json()
  if (!res.ok || !Array.isArray(listed.users)) {
    console.error(`limpeza: listagem do admin falhou (HTTP ${res.status}); usuários de teste ficaram no banco local`)
    return { removed: 0, kept: -1 }
  }
  const users: { id: string; email?: string }[] = listed.users
  let removed = 0
  let kept = 0
  for (const user of users.filter((u) => u.email?.endsWith(`-${run}@example.com`))) {
    const del = await fetch(`${API_URL}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: adminHeaders() })
    await del.body?.cancel()
    if (del.ok) removed++
    else kept++
  }
  return { removed, kept }
}

interface Mail {
  subject: string
  text: string
  html: string
}

// Último e-mail para `to` recebido depois de `after` (epoch ms), lido do Mailpit.
export async function lastMail(to: string, after: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const { messages } = await search.json()
    const fresh = (messages ?? []).filter((m: { Created: string }) => Date.parse(m.Created) > after)
    if (fresh.length) {
      const msg = await (await fetch(`${MAILPIT_URL}/api/v1/message/${fresh[0].ID}`)).json()
      return { subject: msg.Subject, text: msg.Text ?? '', html: msg.HTML ?? '' }
    }
    await sleep(500)
  }
  throw new Error('e-mail não chegou ao Mailpit')
}

// Quantos e-mails o Mailpit tem para `to` com o assunto que contém `subject`.
export async function mailCount(to: string, subject: string): Promise<number> {
  const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`)
  const { messages } = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)).json()
  return (messages ?? []).length
}

export function code(mail: Mail): string {
  const match = /\b(\d{6})\b/.exec(mail.text)
  if (!match) throw new Error('e-mail sem código')
  return match[1]
}

export function verifyLink(mail: Mail): string {
  const match = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(mail.html)
  if (!match) throw new Error('e-mail sem link de verificação')
  return match[1].replace(/&amp;/g, '&')
}
