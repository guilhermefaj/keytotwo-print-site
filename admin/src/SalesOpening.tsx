import { IconCalendarEvent } from '@tabler/icons-react'
import { useResource } from './api'
import { formatMoment } from './format'

// Abertura das vendas (revisão de UX, 2026-10-31): enquanto a compra estiver fechada (private.sales_opening), o aviso
// com a data e quantos dias faltam, nas Métricas e no Catálogo. A data é a mesma que a loja recebe do /catalog.
// Quantos dias faltam (arredondado para cima); null quando já abriu.
function daysUntil(at: string): number | null {
  const left = Date.parse(at) - Date.now()
  return left > 0 ? Math.ceil(left / 86_400_000) : null
}

export function SalesOpening() {
  const { data } = useResource<{ sales_open_at?: string | null }>('/catalog')
  const at = data?.sales_open_at
  const days = at ? daysUntil(at) : null
  if (!at || days === null) return null
  return <p className="notice notice-launch" role="status">
    <IconCalendarEvent aria-hidden="true" size={18} stroke={1.75} />
    <span><strong>As vendas abrem em {formatMoment(at)}</strong> ({days === 1 ? 'falta 1 dia' : `faltam ${days} dias`}). Até lá a loja mostra a contagem e ninguém consegue pagar.</span>
  </p>
}
