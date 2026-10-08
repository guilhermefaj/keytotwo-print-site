import { useState } from 'react'
import { Link } from 'react-router'
import { money, type Cart } from '../../lib/api'

// Explicit local demonstration only. Never accepts card details, calls Stripe or grants games.
export function MockPayment({ cart }: { cart: Cart }) {
  const [code, setCode] = useState('')
  const [discounted, setDiscounted] = useState(false)
  const [message, setMessage] = useState('')
  const amount = cart.subtotal?.amount
  const discount = amount === undefined ? 0 : Math.round(amount * .1)
  return <div className="mock-payment"><p className="checkout-demo"><strong>Demonstração de pagamento (mock).</strong> Nenhuma cobrança ou liberação de jogos acontece aqui.</p>
    <section className="coupon" aria-label="Tenho um cupom"><h3>Tenho um cupom</h3><form className="account-form coupon-form" onSubmit={event => { event.preventDefault(); const valid = code.trim().toUpperCase() === 'TESTE10'; setDiscounted(valid); setMessage(valid ? 'Desconto de demonstração aplicado.' : 'Use TESTE10 nesta demonstração.') }}><label htmlFor="demo-coupon">Código do cupom</label><div><input id="demo-coupon" value={code} onChange={event => setCode(event.target.value)} /><button className="button button-secondary" disabled={!code.trim()}>Aplicar cupom</button></div></form></section>
    <p role="status">{message}</p>{amount !== undefined ? <dl className="payment-totals"><div><dt>Subtotal</dt><dd>{money(amount, cart.subtotal!.currency)}</dd></div>{discounted && <div><dt>Desconto TESTE10 (simulação)</dt><dd>−{money(discount, cart.subtotal!.currency)}</dd></div>}<div className="payment-total"><dt>Total da demonstração</dt><dd>{money(amount - (discounted ? discount : 0), cart.subtotal!.currency)}</dd></div></dl> : <p>O total aparecerá quando o preço estiver disponível.</p>}
    {discounted && <button className="text-button" onClick={() => { setDiscounted(false); setMessage('Cupom removido.') }}>Remover cupom</button>}
    <Link className="button button-primary" to="/pedido/confirmacao?session_id=demo">Simular confirmação</Link>
  </div>
}
