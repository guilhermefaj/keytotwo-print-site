import { IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { api, apiMessage, useResource } from '../api'
import { formatSize, imageName, type BlogImage, type BlogImages } from '../blog'
import { formatMoment } from '../format'
import { LoadError } from '../LoadError'

// Galeria (2026-10-23): o que está no bucket público do blog (keytotwo-print-blog), da imagem mais nova à mais antiga,
// para pôr no texto ou usar como capa sem enviar de novo. Abre como diálogo modal; Esc, Fechar ou um clique fora voltam.
// Apagar do bucket só o que nenhum post usa: nem os salvos (used_by, do banco) nem o post aberto, mesmo sem salvar.
export function ImageGallery({ purpose, postId, current, onPick, onClose }: { purpose: 'body' | 'cover'; postId?: string; current: string[]; onPick: (image: BlogImage) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const { data, error, loading, reload } = useResource<BlogImages>('/admin/blog/images')
  const [query, setQuery] = useState('')
  const [removed, setRemoved] = useState<{ paths: string[]; notice?: string }>({ paths: [] })
  useEffect(() => {
    if (!dialog.current!.open) dialog.current!.showModal()
  }, [])
  useEffect(() => { if (data?.images.length) search.current?.focus() }, [data])
  // O cartão apagado some com o foco dentro dele: o foco vai para o aviso.
  useEffect(() => { if (removed.notice) noticeRef.current?.focus() }, [removed])

  const close = () => dialog.current!.close()
  function pick(image: BlogImage) {
    close()
    onPick(image)
  }
  const all = (data?.images ?? []).filter(image => !removed.paths.includes(image.path))
  const term = query.trim().toLowerCase()
  const images = all.filter(image => !term || imageName(image.path).toLowerCase().includes(term))

  // O clique no fundo escurecido cai no próprio <dialog>; o conteúdo fica num <div> que ocupa todo o diálogo.
  return <dialog ref={dialog} className="gallery" aria-labelledby="galeria-titulo" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="gallery-inner">
      <header className="gallery-head">
        <div>
          <h2 id="galeria-titulo">{purpose === 'cover' ? 'Escolher a capa' : 'Galeria de imagens'}</h2>
          <p>{purpose === 'cover' ? 'Escolha uma imagem do bucket do blog para a capa.' : 'Escolha uma imagem do bucket do blog. Ela entra no texto onde está o cursor.'} Só dá para apagar as que nenhum post usa.</p>
        </div>
        <button className="icon-button" type="button" onClick={close}><IconX aria-hidden="true" size={20} stroke={1.75} /><span className="sr-only">Fechar a galeria</span></button>
      </header>
      {removed.notice && <p className="notice gallery-notice" role="status" ref={noticeRef} tabIndex={-1}>{removed.notice}</p>}
      {loading && <p className="status" role="status">Carregando as imagens do bucket…</p>}
      {!loading && error !== undefined && <LoadError error={error} retry={reload} />}
      {data && (all.length === 0
        ? <p className="status">Ainda não há imagens no bucket. Envie a primeira pelo botão {purpose === 'cover' ? 'Enviar capa' : 'Imagem'}.</p>
        : <>
          <div className="gallery-tools">
            <label className="sr-only" htmlFor="galeria-busca">Procurar pelo nome do arquivo</label>
            <input ref={search} id="galeria-busca" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Procurar pelo nome" autoComplete="off" />
            <p className="gallery-count" role="status">{images.length === all.length ? `${all.length} ${all.length === 1 ? 'imagem' : 'imagens'}` : `${images.length} de ${all.length}`}</p>
          </div>
          {data.truncated && <p className="field-help">O bucket tem mais arquivos do que a galeria mostra de uma vez.</p>}
          {images.length === 0
            ? <p className="status">Nenhuma imagem com esse nome.</p>
            : <ul className="gallery-grid" aria-label="Imagens">
              {images.map(image => <GalleryCard key={image.path} image={image} postId={postId} here={current.includes(image.path)} onPick={() => pick(image)}
                onDeleted={() => setRemoved(state => ({ paths: [...state.paths, image.path], notice: `“${imageName(image.path)}” foi apagada do bucket.` }))} />)}
            </ul>}
        </>)}
    </div>
  </dialog>
}

function GalleryCard({ image, postId, here, onPick, onDeleted }: { image: BlogImage; postId?: string; here: boolean; onPick: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState<{ busy: boolean; error?: string } | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  // Cancelar troca a confirmação de volta pelo botão Apagar: o foco volta para ele depois de aparecer.
  useEffect(() => {
    if (confirm || !returnFocus.current) return
    returnFocus.current = false
    opener.current?.focus()
  }, [confirm])
  const name = imageName(image.path)
  const inThisPost = here || image.used_by.some(post => post.id === postId)
  const others = image.used_by.filter(post => post.id !== postId).map(post => `“${post.title}”`)
  const usage = inThisPost
    ? (others.length ? `Neste post e em ${others.join(', ')}` : 'Neste post')
    : others.length ? `Em uso em ${others.join(', ')}` : ''

  function cancel() {
    returnFocus.current = true
    setConfirm(null)
  }
  async function remove() {
    setConfirm({ busy: true })
    try {
      await api(`/admin/blog/images?path=${encodeURIComponent(image.path)}`, { method: 'DELETE' })
      onDeleted()
    } catch (error) {
      setConfirm({ busy: false, error: apiMessage(error) })
    }
  }

  return <li className="gallery-card">
    <button className="gallery-item" type="button" onClick={onPick}>
      <img src={image.url} alt="" loading="lazy" decoding="async" width="240" height="180" />
      <span className="gallery-name">{name}</span>
      <span className="gallery-meta">{formatMoment(image.uploaded_at)} · {formatSize(image.size)}</span>
    </button>
    {usage
      ? <p className="gallery-use" title={usage}>{usage}</p>
      : confirm
        ? <div className="gallery-confirm" role="group" aria-label={`Confirmar: apagar ${name}`}>
          <p>Apagar do bucket? Não dá para desfazer.</p>
          {confirm.error && <p className="field-error" role="alert">{confirm.error}</p>}
          <button className="button button-danger" type="button" disabled={confirm.busy} onClick={() => void remove()}>{confirm.busy ? 'Apagando…' : 'Apagar'}</button>
          <button className="button button-secondary" type="button" disabled={confirm.busy} onClick={cancel} autoFocus>Cancelar</button>
        </div>
        : <button ref={opener} className="text-button text-button-danger gallery-delete" type="button" onClick={() => setConfirm({ busy: false })}>
          Apagar<span className="sr-only"> {name} do bucket</span>
        </button>}
  </li>
}
