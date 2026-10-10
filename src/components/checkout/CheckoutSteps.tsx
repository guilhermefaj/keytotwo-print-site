import '../../purchase.css'

const steps = ['Carrinho', 'Entrar', 'Pagamento', 'Pronto']
export function CheckoutSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  return <nav className="checkout-steps" aria-label="Etapas da compra"><ol>{steps.map((label, index) => <li key={label} aria-current={current === index + 1 ? 'step' : undefined} data-complete={index + 1 < current}>
    <span className="step-number" aria-hidden="true">{index + 1 < current ? '✓' : index + 1}</span><span>{label}</span>
  </li>)}</ol></nav>
}
