// Adapted from shadcn/ui Sheet (MIT), new-york registry, 2026-10-08.
// Radix supplies modal focus containment, Escape, and focus restoration.
import type { ComponentProps } from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { IconX } from '@tabler/icons-react'
import { Icon } from './Icon'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close
export const SheetTitle = SheetPrimitive.Title
export const SheetDescription = SheetPrimitive.Description

export function SheetContent({ children, className = '', closeLabel = 'Fechar menu', ...props }: ComponentProps<typeof SheetPrimitive.Content> & { closeLabel?: string }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="sheet-overlay" />
      <SheetPrimitive.Content className={`sheet-content ${className}`} {...props}>
        <SheetPrimitive.Close className="icon-button sheet-close" aria-label={closeLabel}>
          <Icon component={IconX} size={24} />
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}
