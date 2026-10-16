import type { ReactNode } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { Icon } from './Icon'

/** Cabeça de um <details> (DESIGN.md › Abre e fecha): texto e chevron Tabler, que gira quando abre. */
export function Summary({ children }: { children: ReactNode }) {
  return <summary><span>{children}</span><Icon component={IconChevronDown} size={20} /></summary>
}
