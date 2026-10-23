import { IconBrandWhatsapp, IconLink, IconShare } from '@tabler/icons-react'
import { useState, useSyncExternalStore } from 'react'

// Compartilhar o post (2026-10-23): WhatsApp (link do wa.me, sem script de terceiros), copiar o link e, no aparelho que
// tem, o compartilhar do sistema. Nada é rastreado. No prerender o botão do sistema não aparece; só depois de carregar.
const noSubscribe = () => () => {}
const canShare = () => typeof navigator.share === 'function'

export function ShareLinks({ title, url }: { title: string; url: string }) {
  const native = useSyncExternalStore(noSubscribe, canShare, () => false)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }
  return <section className="blog-share" aria-labelledby="blog-share-title">
    <h2 id="blog-share-title">Compartilhar</h2>
    <ul>
      <li><a className="button button-secondary" href={whatsapp} target="_blank" rel="noopener"><IconBrandWhatsapp aria-hidden="true" size={20} stroke={1.75} />WhatsApp<span className="sr-only"> (abre em nova aba)</span></a></li>
      <li><button className="button button-secondary" type="button" onClick={() => void copy()}><IconLink aria-hidden="true" size={20} stroke={1.75} />{copied === 'ok' ? 'Link copiado' : 'Copiar o link'}</button></li>
      {native && <li><button className="button button-secondary" type="button" onClick={() => void navigator.share({ title, url }).catch(() => {})}><IconShare aria-hidden="true" size={20} stroke={1.75} />Mais opções</button></li>}
    </ul>
    <p className="blog-share-status" role="status">{copied === 'ok' ? 'O link do post foi copiado.' : copied === 'fail' ? `Não deu para copiar. O link é ${url}` : ''}</p>
  </section>
}
