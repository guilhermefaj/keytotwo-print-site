import { IconBrandWhatsapp, IconCheck, IconLink, IconShare } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { useDismiss } from '../../lib/use-dismiss'

// Compartilhar o post (2026-10-23): WhatsApp (link do wa.me, sem script de terceiros), copiar o link e, no aparelho que
// tem, o compartilhar do sistema. Nada é rastreado. No prerender o botão do sistema não aparece; só depois de carregar.
// Desde 2026-10-24 (responsável): atalho em ícones em cada post da lista e no topo do post, e um botão flutuante que
// acompanha a leitura depois que o atalho do topo sai da tela.
const noSubscribe = () => () => {}
const canShare = () => typeof navigator.share === 'function'

function useShare(title: string, url: string) {
  const native = useSyncExternalStore(noSubscribe, canShare, () => false)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }
  return {
    native, copied, copy,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
    share: () => void navigator.share({ title, url }).catch(() => {}),
    status: copied === 'ok' ? 'Link copiado.' : copied === 'fail' ? `Não deu para copiar. O link é ${url}` : '',
  }
}

// Atalho em ícones: na lista, um por post; no post, sob o título.
export function ShareLinks({ title, url, label, ref }: { title: string; url: string; label: string; ref?: RefObject<HTMLDivElement | null> }) {
  const share = useShare(title, url)
  return <div ref={ref} className="blog-share" role="group" aria-label={label}>
    <span className="blog-share-label" aria-hidden="true">Compartilhar</span>
    <ul>
      <li><a className="icon-button" href={share.whatsapp} target="_blank" rel="noopener" aria-label="WhatsApp (abre em nova aba)" title="WhatsApp"><IconBrandWhatsapp aria-hidden="true" size={20} stroke={1.75} /></a></li>
      <li><button className="icon-button" type="button" onClick={() => void share.copy()} aria-label={share.copied === 'ok' ? 'Link copiado' : 'Copiar o link'} title="Copiar o link">{share.copied === 'ok' ? <IconCheck aria-hidden="true" size={20} stroke={1.75} /> : <IconLink aria-hidden="true" size={20} stroke={1.75} />}</button></li>
      {share.native && <li><button className="icon-button" type="button" onClick={share.share} aria-label="Mais opções" title="Mais opções"><IconShare aria-hidden="true" size={20} stroke={1.75} /></button></li>}
    </ul>
    <p className="blog-share-status" role="status">{share.status}</p>
  </div>
}

// Botão flutuante do post: aparece quando o atalho do topo (start) saiu por cima da tela e o texto (body) ainda está
// nela. No aparelho com o compartilhar do sistema, abre direto; nos outros, abre WhatsApp e Copiar o link.
export function FloatingShare({ title, url, start, body }: { title: string; url: string; start: RefObject<HTMLElement | null>; body: RefObject<HTMLElement | null> }) {
  const share = useShare(title, url)
  const [past, setPast] = useState(false)
  const [reading, setReading] = useState(false)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const visible = past && reading

  useEffect(() => {
    const top = start.current, text = body.current
    if (!top || !text || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const shown = entry.target === top ? !entry.isIntersecting && entry.boundingClientRect.top < 0 : entry.isIntersecting
        if (entry.target === top) setPast(shown)
        else setReading(shown)
        // O botão saiu da tela: o painel fecha junto.
        if (!shown) setOpen(false)
      }
    })
    observer.observe(top)
    observer.observe(text)
    return () => observer.disconnect()
  }, [start, body])

  useDismiss(open, setOpen, root, toggle)

  return <div ref={root} className="blog-share-float" data-visible={visible || undefined}>
    {open && <div id={panelId} className="blog-share-float-panel" role="group" aria-label="Opções para compartilhar">
      <a className="button button-secondary" href={share.whatsapp} target="_blank" rel="noopener"><IconBrandWhatsapp aria-hidden="true" size={20} stroke={1.75} />WhatsApp<span className="sr-only"> (abre em nova aba)</span></a>
      <button className="button button-secondary" type="button" onClick={() => void share.copy()}><IconLink aria-hidden="true" size={20} stroke={1.75} />{share.copied === 'ok' ? 'Link copiado' : 'Copiar o link'}</button>
      <p className="blog-share-status" role="status">{share.status}</p>
    </div>}
    <button ref={toggle} className="blog-share-float-button" type="button" aria-label="Compartilhar este post" title="Compartilhar"
      aria-expanded={share.native ? undefined : open} aria-controls={share.native || !open ? undefined : panelId}
      onClick={() => share.native ? share.share() : setOpen(value => !value)}>
      <IconShare aria-hidden="true" size={22} stroke={1.75} />
    </button>
  </div>
}
