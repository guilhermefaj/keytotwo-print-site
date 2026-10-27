import { useCallback, useSyncExternalStore } from 'react'
import { salesOpenAt } from '../content/catalog-snapshot'
import { useShop } from './shop-context'

// A prévia do lançamento (2026-10-27): até a abertura das vendas, o /catalog leva a hora (no build, o retrato do
// catálogo) e o site mostra o cronômetro no lugar da compra. Na hora marcada abre sozinho; o POST /checkout também
// recusa antes dela (SALES_NOT_OPEN), e o vigia da VPS reconstrói os sites sem a prévia.
export function useSalesOpening(): number | null {
  const { catalog } = useShop()
  const value = catalog.data && 'sales_open_at' in catalog.data ? catalog.data.sales_open_at ?? null : salesOpenAt
  const parsed = value ? Date.parse(value) : NaN
  const opensAt = Number.isFinite(parsed) ? parsed : null
  const opened = useReached(opensAt)
  return opensAt !== null && !opened ? opensAt : null
}

// Se a hora já chegou; avisa a tela quando chega. No pré-render e na hidratação, "ainda não", como no HTML. O setTimeout
// vai até ~24,8 dias: acima disso, confere de novo nesse prazo.
function useReached(at: number | null) {
  const subscribe = useCallback((onChange: () => void) => {
    if (at === null) return () => {}
    let timer = 0
    const check = () => {
      const left = at - Date.now()
      if (left <= 0) onChange()
      else timer = window.setTimeout(check, Math.min(left, 2 ** 31 - 1))
    }
    check()
    return () => window.clearTimeout(timer)
  }, [at])
  return useSyncExternalStore(subscribe, () => at !== null && Date.now() >= at, () => false)
}

const part = (at: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...options }).format(at)

// "9 de novembro, às 19h" (no horário de Brasília); com minutos, "às 19h30".
export function openingLabel(at: number) {
  const minutes = Number(part(at, { minute: 'numeric' }))
  return `${part(at, { day: 'numeric', month: 'long' })}, às ${Number(part(at, { hour: 'numeric', hourCycle: 'h23' }))}h${minutes ? String(minutes).padStart(2, '0') : ''}`
}
