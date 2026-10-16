import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { IconChevronLeft } from '@tabler/icons-react'
import { Icon } from './Icon'

/** Volta um nível (DESIGN.md › Voltar): chevron à esquerda e o nome do destino, igual em todo o site. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="back-link" to={to}><Icon component={IconChevronLeft} size={20} />{children}</Link>
}
