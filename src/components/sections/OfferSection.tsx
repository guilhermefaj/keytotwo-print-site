import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { products, type Product } from '../../content/products'
import { siteConfig } from '../../lib/seo'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { apiErrorMessage, money } from '../../lib/api'
import { authConfigured, loginDestination } from '../../lib/supabase'

export function OfferSection() {
  return <section className="page-section offer-section" aria-labelledby="comprar"><div className="content-width">
    <div className="section-heading"><p className="eyebrow">Para imprimir e jogar juntos</p><h2 id="comprar" tabIndex={-1}>Conheça a oferta</h2></div>
    <div className="product-list">{products.map(product => <ProductOffer key={product.code} product={product} />)}</div>
  </div></section>
}

function ProductOffer({ product }: { product: Product }) {
  const { offer } = product
  const { session, ready } = useAuth()
  const { catalog, add, busy } = useShop()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const listed = catalog.data?.products.find(item => item.code === product.code)
  async function addProduct() {
    if (!session) { navigate(loginDestination('/carrinho', product.code)); return }
    setError('')
    try { await add(product.code); navigate('/carrinho') }
    catch (cause) { setError(apiErrorMessage(cause)) }
  }
  return <article className="offer-layout" aria-labelledby={`product-${product.code}`} data-product-code={product.code}>
    <div><h3 className="product-title" id={`product-${product.code}`}>{product.title}</h3><p className="pending-copy">{offer.name}</p>
      <ul className="offer-games">{product.games.map(game => <li key={game.id}>{game.name}{!game.confirmed && <span className="pending-label">PENDENTE</span>}</li>)}</ul>
      <p>Produto digital. Impressão e materiais de preparação são providenciados por vocês.</p><p className="pending-copy">{offer.materials}</p>
    </div>
    <div className="offer-summary"><p className="eyebrow">Preço do pacote</p><p className="offer-price">{listed?.price ? money(listed.price.unit_amount, listed.price.currency) : siteConfig.showCartAccess ? 'Preço indisponível' : offer.price}</p><p>{offer.payment}</p>
      <div className="offer-availability"><strong>Oferta em preparação</strong><p>PENDENTE: composição final, arquivos e condições de compra. {siteConfig.showCartAccess ? 'O pagamento ainda não está habilitado.' : 'Ainda não é possível adicionar produtos ao carrinho.'}</p>
      </div>
      <dl className="offer-conditions"><div><dt>Conta e entrega</dt><dd>{offer.delivery}</dd></div><div><dt>Acesso aos arquivos</dt><dd>{offer.access} {offer.updates}</dd></div><div><dt>Condições de uso</dt><dd>{offer.license}</dd></div></dl>
      <div className="refund-notice"><h3>Antes de comprar</h3><p><strong>{offer.refund}</strong></p><p className="pending-copy">{offer.legalReview}</p><Link className="inline-link" to="/reembolsos">Ler a política de reembolsos</Link></div>
      {siteConfig.showCartAccess && <div className="offer-cart-action"><button className="button button-primary" disabled={!authConfigured || !ready || busy || !listed} onClick={addProduct}>Adicionar ao carrinho</button>
        {!authConfigured && <p className="pending-copy">PENDENTE: configuração de acesso deste ambiente.</p>}
        {catalog.loading && <p role="status">Consultando disponibilidade…</p>}
        {catalog.error && <><p role="alert">{catalog.error}</p><button className="text-button" onClick={catalog.reload}>Consultar novamente</button></>}
        {catalog.data && !listed && <p>Este produto não está disponível para adicionar agora.</p>}
        <p className="form-error" role="alert">{error}</p><Link className="inline-link" to="/carrinho">Ver carrinho</Link></div>}
      <nav className="offer-links" aria-label="Condições e ajuda"><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link><Link to="/ajuda">Ajuda</Link></nav>
    </div>
  </article>
}
