import { rpc } from '../../_shared/admin.ts'
import { sameSecret } from '../../_shared/compare.ts'
import { env } from '../../_shared/env.ts'
import { errorLabel, HttpError, json } from '../../_shared/http.ts'
import { catalog } from './catalog.ts'

// POST /internal/uptime (2026-10-26): a agenda do banco chama a cada 5 minutos, com o segredo do despacho. Confere o
// que quem compra usa e grava em record_uptime_checks; a varredura dos alertas avisa os admins depois de duas falhas
// seguidas. O site: a página inicial abre com o nome da loja. A loja: o catálogo (o banco e os preços da Stripe) lista
// produtos, todos com preço. O Plunk (2026-11-01, só no modo plunk): a API dele procura um contato que não existe.
const TIMEOUT_MS = 10_000
const NO_CONTACT = '00000000-0000-0000-0000-000000000000'

type Target = 'site' | 'store' | 'plunk'

async function checkSite(): Promise<string | null> {
  const response = await fetch(`${env.siteUrl()}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status !== 200) return `HTTP ${response.status}`
  return (await response.text()).includes('KeyToTwo') ? null : 'a página veio sem o nome da loja'
}

async function checkStore(): Promise<string | null> {
  const { products } = await (await catalog()).json() as { products: { code: string; price: unknown }[] }
  if (!products.length) return 'nenhum produto à venda'
  const missing = products.filter((product) => !product.price).map((product) => product.code)
  return missing.length ? `sem preço: ${missing.join(', ')}` : null
}

// "Contact not found" mostra que a API do Plunk e o banco dele responderam (o /health dele só diz que o processo está de
// pé). Ao atualizar o Plunk, conferir se a resposta continua a mesma (docs/deploy.md).
async function checkPlunk(): Promise<string | null> {
  const response = await fetch(`${env.plunkApiUrl()}/contacts/public/${NO_CONTACT}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (response.status !== 404) return `HTTP ${response.status}`
  const body = await response.json().catch(() => null)
  return body?.error?.message === 'Contact not found' ? null : 'a API respondeu sem procurar o contato'
}

function failure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `não respondeu em ${TIMEOUT_MS / 1000} segundos`
  // o fetch falha assim sem conexão: DNS, recusa ou certificado
  if (error instanceof TypeError) return 'sem conexão'
  return errorLabel(error)
}

async function probe(target: Target, check: () => Promise<string | null>) {
  try {
    const error = await check()
    return error ? { target, ok: false, error } : { target, ok: true }
  } catch (error) {
    return { target, ok: false, error: failure(error) }
  }
}

export async function internalUptime(req: Request): Promise<Response> {
  if (!(await sameSecret(req.headers.get('apikey') ?? '', env.dispatchKey()))) throw new HttpError(401, 'UNAUTHENTICATED', 'Chave inválida.')
  const checks = await Promise.all([
    probe('site', checkSite), probe('store', checkStore), ...(env.emailMode() === 'plunk' ? [probe('plunk', checkPlunk)] : []),
  ])
  await rpc('record_uptime_checks', { p_checks: checks })
  return json({ checks })
}
