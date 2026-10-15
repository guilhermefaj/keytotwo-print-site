export function DataStatus({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  if (loading) return <p role="status">Carregando seus dados…</p>
  if (error) return <div className="data-error"><p role="alert">{error}</p><button className="button button-secondary" onClick={retry}>Tentar novamente</button></div>
  return null
}
