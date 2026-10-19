import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../lib/api'
import { deliveryMock, downloadError, freshDownload, openDownload } from '../../lib/downloads'

export function DownloadButton({ fileId, gameCode, isFree = false, onRefresh }: { fileId?: string; gameCode?: string; isFree?: boolean; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(() => () => request.current?.abort(), [])
  async function download() {
    if (!fileId || busy) return
    setError(''); setMessage('')
    // Preserve the selected game in RequireAuth's next even if the API expires the session.
    if (gameCode) await navigate(`${location.pathname}${location.search}#jogo-${encodeURIComponent(gameCode)}`, { replace: true, preventScrollReset: true })
    if (deliveryMock) { setMessage('Demonstração do download: o PDF será aberto quando a entrega estiver conectada. Nenhum arquivo foi baixado.'); return }
    const controller = new AbortController(); request.current = controller; setBusy(true)
    try {
      const link = await freshDownload(fileId, isFree, controller.signal)
      if (controller.signal.aborted) return
      openDownload(link)
      setMessage('Abrimos o PDF. Se ele não aparecer, clique em Baixar PDF de novo.')
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(downloadError(cause))
      if (cause instanceof ApiError && cause.code === 'FILE_NOT_FOUND') onRefresh()
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="download-action"><button className="button button-primary" disabled={!fileId || busy} onClick={download}>{busy ? 'Preparando PDF…' : 'Baixar PDF'}</button>
    {!fileId && <p className="field-help">O PDF está em preparação. Sua compra continua na sua conta. <Link className="inline-link" to="/ajuda">Preciso de ajuda</Link></p>}
    <p role="status" className="form-message">{message}</p><p role="alert" className="form-error">{error}</p>
    {error && <Link className="inline-link" to="/ajuda">Preciso de ajuda</Link>}
  </div>
}
