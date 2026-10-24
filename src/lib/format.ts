// Formatos de exibição do site e do admin. Sem import: o admin usa este arquivo também (admin/Dockerfile copia).
export const money = (amount: number, currency: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount / 100)

// "2026-10-09" vira "9 de outubro de 2026", sem fuso: a data do post não tem hora.
export const formatDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

// Data curta no fuso de Brasília (Portal e pedidos).
export const dateLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' }).format(new Date(value))

// Preço do conteúdo ("R$ 29,90") em decimal ("29.90"), para o JSON-LD do produto e o valor do GA.
export const priceDecimal = (price: string) => price.replace(/[^\d,]/g, '').replace(',', '.')
