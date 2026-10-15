import { IconScissors } from '@tabler/icons-react'
import { Icon } from './Icon'

/** Linha de recorte com tesoura: separa duas folhas. Decorativa; ver DESIGN.md › Linha de recorte. */
export function CutLine({ className = '' }: { className?: string }) {
  return <div className={`cut-line ${className}`.trim()} aria-hidden="true">
    <Icon component={IconScissors} size={24} />
  </div>
}
