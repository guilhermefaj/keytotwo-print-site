// Formatos do admin. Dinheiro é o mesmo do site (src/lib/format.ts); a data por extenso do post vem no PostHeader.
export { money } from '../../src/lib/format.ts'

export const count = (value: number) => new Intl.NumberFormat('pt-BR').format(value)
export const formatShortDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
export const formatMoment = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value))

// "Hoje, 17:10", "Ontem, 15:50" ou "29 de out., 17:02" (revisão de UX, 2026-10-31): nas listas, o que entrou hoje salta
// aos olhos. Os dias são os de Brasília.
const brDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date)
const brTime = (date: Date) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date)
export function relativeMoment(value: string, now = new Date()) {
  const date = new Date(value)
  const day = brDay(date)
  if (day === brDay(now)) return `Hoje, ${brTime(date)}`
  if (day === brDay(new Date(now.getTime() - 86_400_000))) return `Ontem, ${brTime(date)}`
  return formatMoment(value)
}
