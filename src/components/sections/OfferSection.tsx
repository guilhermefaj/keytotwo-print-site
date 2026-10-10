import { Link } from 'react-router'
import { products, packageContents, type Product } from '../../content/products'
import { experience } from '../../content/experience'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { money } from '../../lib/api'
import { ProductPurchaseAction } from './ProductPurchaseAction'
import { TrustLine } from '../checkout/TrustLine'
import { CutLine } from '../ui/CutLine'

// Oferta (DESIGN.md › The Catalog Rule): um card por produto do catálogo; no celular o preço e o
// botão vêm antes da lista (P1-10). O freebie tem lugar reservado só no stage test, com copy em proposta.
export function OfferSection() {
  return <section className="page-section offer-section" aria-labelledby="comprar"><CutLine /><div className="content-width">
    <div className="section-heading"><h2 id="comprar" tabIndex={-1}>O próximo encontro começa aqui.</h2></div>
    <div className="product-list">{products.map(product => <ProductOffer key={product.code} product={product} />)}</div>
    {siteConfig.stage === 'test' && experience.freebie.proposal && <FreebieInvite />}
  </div></section>
}

function ProductOffer({ product }: { product: Product }) {
  const { catalog } = useShop()
  const price = siteConfig.stage === 'preview' ? null : catalog.data?.products.find(item => item.code === product.code)?.price
  return <article className="offer-layout" aria-labelledby={`product-${product.code}`} data-product-code={product.code}>
    <div className="offer-invitation"><h3 className="product-title" id={`product-${product.code}`}>{product.title}</h3><ul className="package-contents">{packageContents.map(item => <li key={item}>{item}</li>)}</ul></div>
    <div className="offer-summary crop-marks"><h4>5 jogos. Muitas próximas rodadas.</h4>
      <p className="offer-price" data-state={price ? undefined : 'pending'}>{price ? money(price.unit_amount, price.currency) : siteConfig.stage === 'preview' ? 'Preço em breve' : catalog.loading ? 'Consultando preço…' : 'Não conseguimos carregar o preço.'}</p>
      <p className="offer-delivery">Download após a confirmação da compra.<br />Acesso sem prazo de expiração.</p>
      <TrustLine />
      {siteConfig.showCartAccess ? <ProductPurchaseAction code={product.code} /> : <p className="offer-coming">Estamos preparando este encontro. Compra disponível em breve.</p>}
    </div>
  </article>
}

// Lugar visual do freebie. A única participação do Kito na home fora da hero: ele convida.
function FreebieInvite() {
  const { tag, title, text, cta } = experience.freebie
  return <aside className="freebie" aria-labelledby="freebie-title">
    <img src="/media/experience/kito-hi-128.webp" srcSet="/media/experience/kito-hi-128.webp 128w, /media/experience/kito-hi-256.webp 256w" sizes="112px" width="128" height="128" alt="" loading="lazy" decoding="async" />
    <div><p className="tag">{tag}</p><h3 id="freebie-title">{title}</h3><p>{text}</p><Link className="button button-secondary" to={cta.href}>{cta.label}</Link></div>
  </aside>
}
