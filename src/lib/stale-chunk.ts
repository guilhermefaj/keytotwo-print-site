// Depois de uma publicação, uma aba que já estava aberta ainda pede os arquivos da versão anterior, que deixaram de
// existir no servidor. Para o que a página carrega sob demanda (a gaveta da sacola), a falha recarrega a página uma
// vez, já na versão nova, em vez de cair na página de erro. Se a falha se repetir logo depois, ela segue para o erro.
const reloadKey = 'keytotwo:recarregou-versao'

export function reloadOnStaleChunk(error: unknown): Promise<never> {
  try {
    const last = Number(sessionStorage.getItem(reloadKey))
    if (!last || Date.now() - last > 30_000) {
      sessionStorage.setItem(reloadKey, String(Date.now()))
      window.location.reload()
      return new Promise<never>(() => {})
    }
  } catch { /* sem sessionStorage: segue para o erro */ }
  return Promise.reject(error)
}
