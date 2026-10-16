import { Link } from 'react-router'
import { products } from '../../content/products'
import { packageGames } from '../../content/games'
import { BundleFeature } from '../shop/BundleFeature'
import { GameGrid } from '../shop/GameGrid'
import '../../shop.css'

// Vitrine curta do Início (decisão 9 do responsável): o pacote mais até 3 jogos dele, reutilizando os
// cards da Loja. A mesma regra de exibição da Loja: à venda só se for `sale` e estiver no /catalog;
// o resto aparece "Em breve" (ProductAvailability).
const showcaseGames = packageGames.filter(game => game.confirmed).slice(0, 3)

export function ShopShowcase() {
  const bundle = products.find(product => product.kind === 'bundle')
  return <section className="page-section shop-showcase" aria-labelledby="showcase-title">
    <div className="content-width">
      <div className="from-blog-heading"><h2 id="showcase-title">Jogos para imprimir</h2><Link className="inline-link" to="/loja">Ver os jogos</Link></div>
      {bundle && <BundleFeature product={bundle} />}
      <div className="shop-games"><GameGrid games={showcaseGames} /></div>
    </div>
  </section>
}
