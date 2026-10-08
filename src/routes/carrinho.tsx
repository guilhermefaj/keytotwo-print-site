import { Link } from 'react-router'
import { offer } from '../content/offer'

type CartItem = { id: string; name: string; quantity: number; priceLabel: string }
// Structural view only. No storage, payment request, inventory or invented items.
const items: CartItem[] = []

export default function Carrinho() {
  return <main id="conteudo" tabIndex={-1} className="cart-page content-width">
    <p className="eyebrow">Sua escolha</p><h1>Carrinho</h1>
    <p className="legal-pending">PENDENTE: carrinho funcional e finalização da compra. Esta página apresenta a estrutura; ainda não é possível adicionar ou comprar itens.</p>
    <div className="cart-layout"><section aria-labelledby="cart-items-title"><h2 id="cart-items-title">Itens do carrinho <span className="cart-total">({items.length})</span></h2>
      {items.length === 0 ? <div className="cart-empty"><h3>Seu carrinho está vazio</h3><p>Conheça o pacote de jogos para imprimir e confira o que já está definido.</p><a className="button button-primary" href="/#comprar">Ver pacote</a></div> :
        <ul className="cart-items">{items.map(item => <li key={item.id}><h3>{item.name}</h3><p>Quantidade: {item.quantity}</p><p>{item.priceLabel}</p></li>)}</ul>}
    </section><aside className="cart-summary" aria-labelledby="cart-summary-title"><h2 id="cart-summary-title">Finalizar a compra</h2><p>A compra é somente para usuários cadastrados. Crie uma conta ou entre para continuar.</p><p>PENDENTE: preços, total do pedido e integração do pagamento no Stripe.</p>
      <div className="refund-notice"><p><strong>{offer.refund}</strong></p><p className="pending-copy">{offer.legalReview}</p></div>
      <Link className="button button-primary" to="/entrar?next=%2Fcarrinho" aria-describedby="checkout-login">Finalizar compra</Link><p id="checkout-login" className="pending-copy">Você será levado à página Entrar. Cadastro e pagamento ainda não estão disponíveis.</p>
      <Link className="inline-link" to="/reembolsos">Ler a política de reembolsos</Link>
    </aside></div>
  </main>
}
