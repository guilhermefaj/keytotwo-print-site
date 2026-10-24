import { ApiError, apiMessage } from './api'

// Erro ao abrir uma lista ou ficha, com "Tentar de novo". `missing` é o texto para quando ela não existe mais (404):
// aí não adianta tentar, então o botão some.
export function LoadError({ error, retry, missing }: { error: unknown; retry: () => void; missing?: string }) {
  const gone = Boolean(missing) && error instanceof ApiError && error.code === 'NOT_FOUND'
  return <div className="status-error" role="alert">
    <p>{gone ? missing : apiMessage(error)}</p>
    {!gone && <button className="button button-secondary" type="button" onClick={retry}>Tentar de novo</button>}
  </div>
}
