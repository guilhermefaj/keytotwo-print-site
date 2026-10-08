// Three actual pages of ONE game, not three games or invented covers.
export function ProductPreview({ compact = false }: { compact?: boolean }) {
  return <figure className={`product-preview${compact ? ' product-preview-compact' : ''}`}>
    <div className="paper-composition">
      {[2, 3, 1].map(page => <img key={page} className={`sample-page sample-page-${page}`} src={`/media/experience/j001-page-${page}-720.webp`} alt={page === 1 ? 'Página real de Rabisque e Adivinhe, com instruções e cartas para recortar.' : `Página ${page} de Rabisque e Adivinhe, com cartas de palavras e frases.`} width="720" height="1019" loading="lazy" decoding="async" />)}
      {!compact && <img className="preview-kito" src="/media/experience/kito-tabuleiro-240.webp" srcSet="/media/experience/kito-tabuleiro-240.webp 240w, /media/experience/kito-tabuleiro-480.webp 480w" sizes="(max-width: 767px) 120px, 190px" width="240" height="240" alt="" loading="lazy" decoding="async" />}
    </div><figcaption>Uma prévia real de Rabisque e Adivinhe.</figcaption>
  </figure>
}
