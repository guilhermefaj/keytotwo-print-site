import { IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { apiMessage, useResource } from '../api'
import { formatMoment, formatSize, imageName, type BlogImage, type BlogImages } from '../blog'

// Galeria (2026-10-23): o que está no bucket público do blog (keytotwo-print-blog), da imagem mais nova à mais antiga,
// para pôr no texto ou usar como capa sem enviar de novo. Abre como diálogo modal; Esc, Fechar ou um clique fora voltam.
export function ImageGallery({ purpose, onPick, onClose }: { purpose: 'body' | 'cover'; onPick: (image: BlogImage) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const { data, error, loading, reload } = useResource<BlogImages>('/admin/blog/images')
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!dialog.current!.open) dialog.current!.showModal()
  }, [])
  useEffect(() => { if (data?.images.length) search.current?.focus() }, [data])

  const close = () => dialog.current!.close()
  function pick(image: BlogImage) {
    close()
    onPick(image)
  }
  const term = query.trim().toLowerCase()
  const images = (data?.images ?? []).filter(image => !term || imageName(image.path).toLowerCase().includes(term))

  // O clique no fundo escurecido cai no próprio <dialog>; o conteúdo fica num <div> que ocupa todo o diálogo.
  return <dialog ref={dialog} className="gallery" aria-labelledby="galeria-titulo" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="gallery-inner">
      <header className="gallery-head">
        <div>
          <h2 id="galeria-titulo">{purpose === 'cover' ? 'Escolher a capa' : 'Galeria de imagens'}</h2>
          <p>{purpose === 'cover' ? 'Escolha uma imagem do bucket do blog para a capa.' : 'Escolha uma imagem do bucket do blog. Ela entra no texto onde está o cursor.'}</p>
        </div>
        <button className="icon-button" type="button" onClick={close}><IconX aria-hidden="true" size={20} stroke={1.75} /><span className="sr-only">Fechar a galeria</span></button>
      </header>
      {loading && <p className="status" role="status">Carregando as imagens do bucket…</p>}
      {!loading && error !== undefined && <div className="status-error" role="alert"><p>{apiMessage(error)}</p><button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button></div>}
      {data && (data.images.length === 0
        ? <p className="status">Ainda não há imagens no bucket. Envie a primeira pelo botão {purpose === 'cover' ? 'Enviar capa' : 'Imagem'}.</p>
        : <>
          <div className="gallery-tools">
            <label className="sr-only" htmlFor="galeria-busca">Procurar pelo nome do arquivo</label>
            <input ref={search} id="galeria-busca" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Procurar pelo nome" autoComplete="off" />
            <p className="gallery-count" role="status">{images.length === data.images.length ? `${data.images.length} ${data.images.length === 1 ? 'imagem' : 'imagens'}` : `${images.length} de ${data.images.length}`}</p>
          </div>
          {data.truncated && <p className="field-help">O bucket tem mais arquivos do que a galeria mostra de uma vez.</p>}
          {images.length === 0
            ? <p className="status">Nenhuma imagem com esse nome.</p>
            : <ul className="gallery-grid" aria-label="Imagens">
              {images.map(image => <li key={image.path}>
                <button className="gallery-item" type="button" onClick={() => pick(image)}>
                  <img src={image.url} alt="" loading="lazy" decoding="async" width="240" height="180" />
                  <span className="gallery-name">{imageName(image.path)}</span>
                  <span className="gallery-meta">{formatMoment(image.uploaded_at)} · {formatSize(image.size)}</span>
                </button>
              </li>)}
            </ul>}
        </>)}
    </div>
  </dialog>
}
