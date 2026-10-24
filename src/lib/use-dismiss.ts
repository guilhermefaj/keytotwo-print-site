import { useEffect, type RefObject } from 'react'

// Painel aberto (menu da conta, compartilhar): Esc fecha e devolve o foco ao botão que abriu; tocar fora fecha.
export function useDismiss(open: boolean, setOpen: (open: boolean) => void, root: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open, setOpen, root, trigger])
}
