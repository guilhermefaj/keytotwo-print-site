import { IconCheck } from '@tabler/icons-react'
import { Icon } from '../ui/Icon'
import '../../purchase.css'

const steps = ['Sacola', 'Entrar', 'Pagamento', 'Pronto'] as const
// `current` conta as quatro etapas. Quem já entrou não passa por "Entrar": a sequência mostra três
// passos, numerados de novo, sem uma etapa concluída fora de ordem.
export function CheckoutSteps({ current, signedIn = false }: { current: 1 | 2 | 3 | 4; signedIn?: boolean }) {
  const visible = steps.map((label, index) => ({ label, step: index + 1 })).filter(item => !signedIn || item.label !== 'Entrar')
  return <nav className="checkout-steps" aria-label="Etapas da compra"><ol>{visible.map(({ label, step }, index) => {
    const complete = step < current
    return <li key={label} aria-current={current === step ? 'step' : undefined} data-complete={complete}>
      <span className="step-number" aria-hidden="true">{complete ? <Icon component={IconCheck} size={16} /> : index + 1}</span><span>{label}</span>
    </li>
  })}</ol></nav>
}
