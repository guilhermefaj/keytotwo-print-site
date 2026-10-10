import { products, packageContents, type Product } from '../../content/products'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { money } from '../../lib/api'
import { ProductPreview } from './ProductPreview'
import { ProductPurchaseAction } from './ProductPurchaseAction'
import { TrustLine } from '../checkout/TrustLine'

export function OfferSection() {
  return <section className="page-section offer-section" aria-labelledby="comprar"><div className="content-width">
    <div className="section-heading centered-heading"><p className="eyebrow">Levem a ideia para casa</p><h2 id="comprar" tabIndex={-1}>O próximo encontro começa aqui.</h2></div>
    <div className="product-list">{products.map(product => <ProductOffer key={product.code} product={product} />)}</div>
  </div></section>
}

function ProductOffer({ product }: { product: Product }) {
  const { catalog } = useShop()
  const price = siteConfig.stage === 'preview' ? null : catalog.data?.products.find(item => item.code === product.code)?.price
  return <article className="offer-layout" aria-labelledby={`product-${product.code}`} data-product-code={product.code}>
    <div className="offer-invitation"><p className="eyebrow">Para imprimir · para vocês</p><h3 className="product-title" id={`product-${product.code}`}>{product.title}</h3><ProductPreview compact /></div>
    <div className="offer-summary"><h4>5 jogos. Muitas próximas rodadas.</h4><ul className="package-contents">{packageContents.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="offer-price">{price ? money(price.unit_amount, price.currency) : siteConfig.stage === 'preview' ? 'Preço em breve' : catalog.loading ? 'Consultando preço…' : 'Preço indisponível'}</p>
      {price && siteConfig.stage === 'test' && <p className="test-price-label">Valor de teste</p>}
      <p className="offer-delivery">Download após a confirmação da compra.<br />Acesso sem prazo de expiração.</p>
      <TrustLine />
      {siteConfig.showCartAccess ? <ProductPurchaseAction code={product.code} /> : <p className="offer-coming">Estamos preparando este encontro. Compra disponível em breve.</p>}
    </div>
  </article>
}
