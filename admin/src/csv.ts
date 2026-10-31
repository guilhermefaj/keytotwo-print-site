// Planilhas do admin (revisão de UX, 2026-10-31): CSV com ";" e vírgula decimal, que o Excel em português abre direto,
// com BOM para os acentos. Campo com ";", aspas ou quebra de linha vai entre aspas.
type Cell = string | number | null | undefined

const cell = (value: Cell) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const toCsv = (rows: Cell[][]) => `\uFEFF${rows.map(row => row.map(cell).join(';')).join('\r\n')}\r\n`

// Valor em centavos para a planilha: 2990 → "29,90".
export const csvMoney = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','))

export function saveCsv(filename: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
