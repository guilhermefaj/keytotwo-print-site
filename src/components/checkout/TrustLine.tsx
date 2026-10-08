import { Link } from 'react-router'
export function TrustLine() {
  return <div className="purchase-trust"><ul aria-label="Compra e acesso"><li>Pagamento via Stripe</li><li>Acesso após a confirmação</li><li>Jogos também por e-mail</li></ul><Link className="inline-link" to="/ajuda">Precisa de ajuda?</Link></div>
}
