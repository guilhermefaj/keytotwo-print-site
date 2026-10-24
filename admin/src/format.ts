// Formatos do admin. Dinheiro é o mesmo do site (src/lib/format.ts); a data por extenso do post vem no PostHeader.
export { money } from '../../src/lib/format.ts'

export const count = (value: number) => new Intl.NumberFormat('pt-BR').format(value)
export const formatShortDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
export const formatMoment = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
