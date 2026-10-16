import { useState, type CSSProperties } from 'react'

/** Imagem da galeria: capa (16:9, preenche) ou página real do PDF (inteira sobre a aguada). */
export type GalleryImage = { src: string; srcSet?: string; alt: string; width: number; height: number; fit: 'cover' | 'contain' }

// Galeria do produto (DESIGN.md › Página de produto): a capa abre, as páginas reais vêm depois.
// A prévia do PDF nunca é a primeira imagem nem a miniatura da Loja.
export function ProductGallery({ images, accent }: { images: readonly GalleryImage[]; accent?: string }) {
  const [index, setIndex] = useState(0)
  const current = images[index] ?? images[0]
  if (!current) return null
  return <div className="product-gallery">
    <figure className="product-gallery-main" data-fit={current.fit} data-accent={accent ? '' : undefined} style={accent ? { '--game-accent': accent } as CSSProperties : undefined}>
      <img key={current.src} src={current.src} srcSet={current.srcSet} sizes="(max-width: 767px) 100vw, 600px" alt={current.alt} width={current.width} height={current.height} decoding="async" />
    </figure>
    {images.length > 1 && <ul className="product-gallery-thumbs" aria-label="Imagens do produto">{images.map((image, position) => <li key={image.src}>
      <button type="button" data-fit={image.fit} aria-pressed={position === index} aria-label={`Imagem ${position + 1} de ${images.length}: ${image.alt}`} onClick={() => setIndex(position)}>
        <img src={image.src} alt="" width={image.width} height={image.height} loading="lazy" decoding="async" />
      </button>
    </li>)}</ul>}
  </div>
}
