import { errorResponse } from './http.ts'

// Limite por visitante (2026-11-09, lançamento): freia robô e enxurrada antes de chegarem ao banco, à Stripe ou ao B2.
// Conta na memória de cada instância da função: não soma carga no banco justamente durante um ataque e, sem endereço
// conhecido, deixa passar. Não é um limite exato, porque cada instância conta o seu; contra quem distribui os pedidos
// entre muitos endereços, o que vale é a proteção da plataforma. O IP só fica aqui durante a janela e não vai para log.
interface Rule { name: string; limit: number; windowMs: number }

const MINUTE = 60_000
// Os limites folgam para muita gente atrás do mesmo IP de operadora, comum em celular no Brasil.
const DOWNLOAD: Rule = { name: 'download', limit: 30, windowMs: 10 * MINUTE }
const CHECKOUT: Rule = { name: 'checkout', limit: 20, windowMs: MINUTE }
const FORM: Rule = { name: 'form', limit: 40, windowMs: MINUTE }
const GENERAL: Rule = { name: 'general', limit: 300, windowMs: MINUTE }

// Admin e agendamentos têm autenticação própria e não podem ser barrados por engano.
export function ruleFor(path: string): Rule | null {
  if (path.startsWith('/admin/') || path.startsWith('/internal/')) return null
  if (/^\/(free\/|free-download$|download-url$|d\/)/.test(path)) return DOWNLOAD
  if (/^\/checkout(\/|$)/.test(path)) return CHECKOUT
  if (/^\/(account\/|csp-report$|referral\/visit$|email\/unsubscribe$)/.test(path)) return FORM
  return GENERAL
}

// A Cloudflare na frente da Supabase é quem define o cf-connecting-ip; o que vier do cliente é sobrescrito.
export function clientIp(req: Request): string | null {
  const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? '').trim()
  return ip && ip.length <= 64 ? ip : null
}

const MAX_BUCKETS = 50_000
const buckets = new Map<string, { count: number; resetAt: number }>()

function sweep(now: number) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
  if (buckets.size >= MAX_BUCKETS) buckets.clear()
}

// Segundos até liberar, ou null se o pedido pode seguir.
export function hit(key: string, rule: Rule, now = Date.now()): number | null {
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now)
    bucket = { count: 0, resetAt: now + rule.windowMs }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  return bucket.count > rule.limit ? Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) : null
}

export function rateLimit(req: Request, path: string, now = Date.now()): Response | null {
  const rule = ruleFor(path)
  const ip = rule && clientIp(req)
  if (!rule || !ip) return null
  const wait = hit(`${rule.name}:${ip}`, rule, now)
  if (wait === null) return null
  return errorResponse(429, 'RATE_LIMITED', 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.', { headers: { 'Retry-After': String(wait) } })
}

export const resetRateLimit = () => buckets.clear()
