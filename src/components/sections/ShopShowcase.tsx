import { Link } from 'react-router'
import { products } from '../../content/products'
import { games } from '../../content/games'
import { experience } from '../../content/experience'
import { BundleFeature } from '../shop/BundleFeature'
import { GameGrid } from '../shop/GameGrid'
import '../../shop.css'

// Vitrine curta do Início (decisão 9 do responsável): o pacote mais até 3 jogos, reutilizando os
// cards da Loja. A mesma regra de exibição da Loja: à venda só se for `sale` e estiver no /catalog;
// o resto aparece "Em breve" (ProductAvailability).
const showcaseGames = games.slice(0, 3)

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

// Lugar visual do freebie. A única participação do Kito na home fora da hero: ele convida.
// O resgate é backend e vem depois; até lá o bloco só aparece no stage test.
export function FreebieInvite() {
  const { tag, title, text, cta } = experience.freebie
  return <section className="page-section freebie-section"><div className="content-width"><aside className="freebie" aria-labelledby="freebie-title">
    <img src="/media/experience/kito-hi-128.webp" srcSet="/media/experience/kito-hi-128.webp 128w, /media/experience/kito-hi-256.webp 256w" sizes="112px" width="128" height="128" alt="" loading="lazy" decoding="async" />
    <div><p className="tag">{tag}</p><h3 id="freebie-title">{title}</h3><p>{text}</p><Link className="button button-secondary" to={cta.href}>{cta.label}</Link></div>
  </aside></div></section>
}
