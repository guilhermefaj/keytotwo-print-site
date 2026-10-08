import { api, ApiError, apiErrorMessage } from './api'
import { siteConfig } from './seo'

// I4 is integrated: test/live use the API; preview and an explicit local mock stay isolated.
export const deliveryMock = siteConfig.stage === 'preview' || (siteConfig.stage !== 'live' && import.meta.env.VITE_DELIVERY_MODE === 'mock')
export type FreeGame = { available: false } | { available: true; game: { name: string }; file: { id: string; version: string; size_bytes: number } }
export type DownloadLink = { url: string; expires_at: string; filename?: string | null }

export function fileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = bytes >= 1_000_000 ? { divisor: 1_000_000, label: 'MB' } : { divisor: 1_000, label: 'KB' }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / units.divisor)} ${units.label}`
}

export async function freshDownload(fileId: string, isFree = false, signal?: AbortSignal): Promise<DownloadLink> {
  // No signed URL is cached or stored. Every click rechecks entitlement on the server.
  for (let attempt = 0; attempt < 2; attempt++) {
    const link = await api<DownloadLink>(isFree ? '/free-download' : '/download-url', { method: 'POST', body: { file_id: fileId }, public: isFree, signal })
    const url = new URL(link.url)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('INVALID_DOWNLOAD_URL')
    if (Date.parse(link.expires_at) > Date.now() + 5000) return link
  }
  throw new ApiError('LINK_EXPIRED')
}

export function openDownload(link: DownloadLink) {
  // B2 signs Content-Disposition: attachment. Native download avoids holding the PDF
  // in browser memory or requiring cross-origin fetch permissions. No popup needed.
  const anchor = document.createElement('a')
  anchor.href = link.url
  anchor.download = link.filename || ''
  anchor.referrerPolicy = 'no-referrer'
  anchor.rel = 'noreferrer'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

export function downloadError(error: unknown) {
  const code = error instanceof ApiError ? error.code : ''
  const messages: Record<string, string> = {
    LINK_EXPIRED: 'O link venceu antes de abrir. Clique em Baixar PDF para gerar um novo.',
    FILE_UNAVAILABLE: 'Sua compra continua na sua conta. O arquivo está temporariamente indisponível; tente novamente mais tarde ou procure ajuda.',
    FILE_NOT_FOUND: 'O arquivo foi atualizado. Estamos conferindo a versão disponível; tente baixar novamente.',
    NOT_ENTITLED: 'Não foi possível confirmar seu acesso a este arquivo. Confira o pedido na sua conta ou procure ajuda.',
  }
  return messages[code] || apiErrorMessage(error)
}
