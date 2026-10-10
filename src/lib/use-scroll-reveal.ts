import { useEffect, type RefObject } from 'react'

/** Progressive enhancement: content remains visible without JS or IntersectionObserver. */
export function useScrollReveal(scope: RefObject<HTMLElement | null>, selector = '.page-section') {
  useEffect(() => {
    const root = scope.current
    if (!root || !('IntersectionObserver' in window)) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let observer: IntersectionObserver | undefined
    const elements = Array.from(root.querySelectorAll<HTMLElement>(selector))
    const reveal = (element: HTMLElement) => {
      element.dataset.reveal = 'visible'
      observer?.unobserve(element)
    }
    const setup = () => {
      observer?.disconnect()
      if (reduced.matches) { elements.forEach(reveal); return }
      observer = new IntersectionObserver(entries => {
        entries.filter(entry => entry.isIntersecting).forEach((entry, index) => {
          const element = entry.target as HTMLElement
          element.style.setProperty('--reveal-delay', `${Math.min(index, 3) * 60}ms`)
          reveal(element)
        })
      }, { threshold: 0, rootMargin: '0px 0px -32px 0px' })
      elements.forEach(element => {
        if (element.dataset.reveal === 'visible' || element.getBoundingClientRect().top < window.innerHeight) reveal(element)
        else { element.dataset.reveal = 'pending'; observer?.observe(element) }
      })
    }
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        const element = event.target.closest<HTMLElement>('[data-reveal]')
        if (element) reveal(element)
      }
    }
    setup()
    reduced.addEventListener('change', setup)
    root.addEventListener('focusin', onFocus)
    return () => {
      observer?.disconnect()
      reduced.removeEventListener('change', setup)
      root.removeEventListener('focusin', onFocus)
      elements.forEach(element => { delete element.dataset.reveal; element.style.removeProperty('--reveal-delay') })
    }
  }, [scope, selector])
}
