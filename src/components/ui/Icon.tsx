import type { IconProps, TablerIcon } from '@tabler/icons-react'

// Família de ícones do site: Tabler outline, traço 1,75, currentColor e aria-hidden por padrão.
// O rótulo acessível fica sempre no controle (aria-label ou texto visível). Ver DESIGN.md › Ícones.
// 32 só para ilustrar (etapas de Como funciona, O que vocês precisam); controles ficam em 16–24.
export type IconSize = 16 | 20 | 24 | 32

export function Icon({ component: Glyph, size = 20, stroke = 1.75, ...props }: { component: TablerIcon; size?: IconSize; stroke?: number | string } & Omit<IconProps, 'size' | 'stroke'>) {
  return <Glyph size={size} stroke={stroke} aria-hidden="true" {...props} />
}
