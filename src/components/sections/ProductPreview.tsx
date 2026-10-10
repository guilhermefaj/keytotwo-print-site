// Three actual pages of ONE game, not three games or invented covers. Sem Kito nem fundo colorido:
// as folhas ficam sobre o Papel, como saíram da impressora (direção B).
export function ProductPreview() {
  return <figure className="product-preview">
    <div className="paper-composition">
      {[2, 3, 1].map(page => <img key={page} className={`sample-page sample-page-${page}`} src={`/media/experience/j001-page-${page}-720.webp`} alt={page === 1 ? 'Página real de Rabisque e Adivinhe, com instruções e cartas para recortar.' : `Página ${page} de Rabisque e Adivinhe, com cartas de palavras e frases.`} width="720" height="1019" loading="lazy" decoding="async" />)}
    </div><figcaption>Uma prévia real de Rabisque e Adivinhe.</figcaption>
  </figure>
}
