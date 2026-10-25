import { rpc } from './admin.ts'
import { runDetached } from './background.ts'

// Uso da infraestrutura (2026-10-25): cada chamada das funções soma 1 no contador da hora (private.api_usage), em
// segundo plano, depois da resposta. As Métricas do admin mostram o mês contra o limite do plano grátis.
export type UsageArea = 'public' | 'account' | 'admin' | 'webhooks' | 'schedule'

export function countCall(area: UsageArea): void {
  runDetached('uso', () => rpc('record_api_usage', { p_area: area }))
}

// Rotas da api sem sessão: a loja de quem ainda não entrou, o blog, os links dos e-mails e o CSP.
const PUBLIC = /^\/(catalog|cart\/quote|free-games|blog\/.*|referral\/visit|csp-report|email\/unsubscribe|d\/.*)$/

// O tipo de uma rota da api, pelo caminho (o que não existe conta como público: é quem bate à porta sem sessão).
export function apiArea(path: string): UsageArea {
  if (path.startsWith('/admin/')) return 'admin'
  if (path.startsWith('/internal/')) return 'schedule'
  if (PUBLIC.test(path)) return 'public'
  const known = /^\/(cart|account|library|checkout|order-status|download-url|free-download)(\/|$)/.test(path)
  return known ? 'account' : 'public'
}
