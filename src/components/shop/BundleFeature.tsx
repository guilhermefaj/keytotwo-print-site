import type { Product } from '../../content/products'
import { ProductAvailability } from './ProductAvailability'
import { GameCover } from '../account/GameCover'
import { accentStyle } from './GameGrid'

// Banner do pacote (DESIGN.md › Banner do pacote), na Loja e no Início: a capa grande e, sob ela, os
// jogos com a miniatura e a cor de cada um; ao lado, o nome, o que vem e a compra.
export function BundleFeature({ product }: { product: Product }) {
  return <article className="shop-bundle" aria-labelledby={`bundle-${product.slug}`} data-shop-product={product.code}>
    <div className="shop-bundle-side">{product.cover && <GameCover name={product.title} art={product.cover} />}
      <ol className="shop-bundle-games" aria-label="Jogos do pacote">{product.games.map(game => <li key={game.id} style={accentStyle(game.accent)}><GameCover code={game.code} name={game.name} /><span>{game.name}</span></li>)}</ol>
    </div>
    <div className="shop-bundle-intro"><h2 id={`bundle-${product.slug}`}>{product.shopHeadline || product.title}</h2><p className="shop-bundle-name">{product.title}</p>
      <ul className="shop-includes">{product.contents.map(line => <li key={line}>{line}</li>)}</ul>
      <ProductAvailability product={product} />
    </div>
  </article>
}
