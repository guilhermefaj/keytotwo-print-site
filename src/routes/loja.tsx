import { products } from '../content/products'
import { BundleFeature } from '../components/shop/BundleFeature'
import { GameGrid } from '../components/shop/GameGrid'
import { CatalogFeedback } from '../components/shop/ProductAvailability'
import { FreebieSection, showFreebies } from '../components/shop/FreebieSection'

const games = [...new Map(products.flatMap(product => product.games).map(game => [game.id, game])).values()]

export default function Shop() {
  return <main id="conteudo" tabIndex={-1} className="shop-page content-width">
    <header className="shop-heading"><h1>Loja</h1><p>Jogos para casais imprimirem e jogarem em casa. Levem um jogo ou o pacote inteiro.</p><CatalogFeedback quietLoading /></header>
    {products.filter(product => product.kind === 'bundle').map(product => <BundleFeature key={product.code} product={product} priority />)}
    <section className="shop-games" aria-labelledby="shop-games-title"><h2 id="shop-games-title">Jogos para imprimir</h2><GameGrid games={games} /></section>
    {showFreebies && <FreebieSection />}
  </main>
}
