import { products } from '../content/products'
import { BundleFeature } from '../components/shop/BundleFeature'
import { GameGrid, PackCard } from '../components/shop/GameGrid'
import { CatalogFeedback } from '../components/shop/ProductAvailability'
import { FreebieSection } from '../components/shop/FreebieSection'

const games = [...new Map(products.flatMap(product => product.games).map(game => [game.id, game])).values()]
const bundle = products.find(product => product.kind === 'bundle' && product.availability === 'sale')

export default function Shop() {
  return <main id="conteudo" tabIndex={-1} className="shop-page content-width">
    <header className="shop-heading"><h1>Loja</h1><p>Jogos para casais imprimirem e jogarem em casa. Levem um jogo ou o pacote inteiro.</p><CatalogFeedback quietLoading /></header>
    {products.filter(product => product.kind === 'bundle').map(product => <BundleFeature key={product.code} product={product} priority />)}
    <section className="shop-games" aria-labelledby="shop-games-title"><h2 id="shop-games-title">Jogos para imprimir</h2><GameGrid games={games} extra={bundle && <PackCard bundle={bundle} />} /></section>
    <FreebieSection />
  </main>
}
