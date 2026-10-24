// Baixa um JSON como arquivo (exportar os dados, no site e no admin). O link entra na página e a URL fica viva alguns
// segundos: há navegador que cancela o download se ela some logo depois do clique. Sem import: o admin usa também.
export function saveJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
