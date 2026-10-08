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
    <div className="section-heading centered-heading"><p className="eyebrow">Levem a ideia para casa</p><h2 id="comprar" tabIndex={-1}>O próximo encontro começa aqui.</h2></div>
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
    <div className="offer-invitation"><p className="eyebrow">Para imprimir · para vocês</p><h3 className="product-title" id={`product-${product.code}`}>Uma boa ideia<br />para jogar juntos.</h3><p>Escolham um cantinho, preparem os materiais e deixem a brincadeira conduzir o encontro.</p><span className="offer-format">Arquivos digitais para imprimir</span></div>
    <div className="offer-summary"><h4>Seu próximo plano a dois</h4><p className="offer-price">{listed?.price ? money(listed.price.unit_amount, listed.price.currency) : 'Preço em breve'}</p><p className="offer-delivery">Na sua conta e por e-mail.<br />Acesso sem prazo de expiração.</p>
      <div className="refund-notice"><p><span>{offer.refund}</span> <Link to="/reembolsos">Ver política</Link></p></div>
      {siteConfig.showCartAccess ? <div className="offer-cart-action"><button className="button button-primary" disabled={!authConfigured || !ready || busy || !listed} onClick={addProduct}><span>{busy ? 'Adicionando…' : 'Adicionar ao carrinho'}</span><span aria-hidden="true">↗</span></button>
        {!authConfigured && <p>O acesso à conta estará disponível em breve.</p>}
        {catalog.loading && <p role="status">Consultando disponibilidade…</p>}
        {catalog.error && <><p role="alert">{catalog.error}</p><button className="text-button" onClick={catalog.reload}>Consultar novamente</button></>}
        {catalog.data && !listed && <p>Esta experiência estará disponível em breve.</p>}
        <p className="form-error" role="alert">{error}</p>{!session && authConfigured && <p className="field-help">Vamos guardar sua escolha. Entre ou crie uma conta para continuar.</p>}</div> : <p className="offer-coming">Estamos preparando este encontro. Compra disponível em breve.</p>}
    </div>
  </article>
}
