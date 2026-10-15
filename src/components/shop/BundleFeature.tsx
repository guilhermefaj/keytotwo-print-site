import type { Product } from '../../content/products'
import { ProductAvailability } from './ProductAvailability'

export function BundleFeature({ product }: { product: Product }) {
  return <article className="shop-bundle" aria-labelledby={`bundle-${product.slug}`} data-shop-product={product.code}>
    <div className="shop-bundle-intro"><h2 id={`bundle-${product.slug}`}>{product.shopHeadline || product.title}</h2><p className="shop-bundle-name">{product.title}</p>
      <ul className="shop-includes">{product.contents.map(line => <li key={line}>{line}</li>)}</ul>
      <ProductAvailability product={product} />
    </div>
    <ol className="shop-bundle-games" aria-label="Jogos do pacote">{product.games.map(game => <li key={game.id}>{game.name}</li>)}</ol>
  </article>
}
