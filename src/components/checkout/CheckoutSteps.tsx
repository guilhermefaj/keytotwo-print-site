import { IconCheck } from '@tabler/icons-react'
import { Icon } from '../ui/Icon'
import '../../purchase.css'

const steps = ['Carrinho', 'Entrar', 'Pagamento', 'Pronto']
export function CheckoutSteps({ current, signedIn = false }: { current: 1 | 2 | 3 | 4; signedIn?: boolean }) {
  return <nav className="checkout-steps" aria-label="Etapas da compra"><ol>{steps.map((label, index) => {
    const complete = index + 1 < current || (signedIn && label === 'Entrar' && current === 1)
    return <li key={label} aria-current={current === index + 1 ? 'step' : undefined} data-complete={complete}>
      <span className="step-number" aria-hidden="true">{complete ? <Icon component={IconCheck} size={16} /> : index + 1}</span><span>{label}</span>
    </li>
  })}</ol></nav>
}
