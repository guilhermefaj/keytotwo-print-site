// Adapted from shadcn/ui Sheet (MIT), new-york registry, 2026-10-08.
// Radix supplies modal focus containment, Escape, and focus restoration.
// Only the right-hand mobile navigation variant is needed by this prototype.
import type { ComponentProps } from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close
export const SheetTitle = SheetPrimitive.Title
export const SheetDescription = SheetPrimitive.Description

export function SheetContent({ children, ...props }: ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="sheet-overlay" />
      <SheetPrimitive.Content className="sheet-content" {...props}>
        <SheetPrimitive.Close className="icon-button sheet-close" aria-label="Fechar menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" />
          </svg>
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}
