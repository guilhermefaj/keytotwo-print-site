import { Children, useEffect, useId, useRef, useState, type ReactNode } from 'react'

export function SnapCarousel({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  const track = useRef<HTMLDivElement>(null)
  const id = useId()
  const count = Children.count(children)
  const [position, setPosition] = useState({ first: 1, last: 1, start: true, end: false })
  function measure() {
    const element = track.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    const visible = Array.from(element.children).map((child, index) => ({ index, bounds: child.getBoundingClientRect() }))
      .filter(child => child.bounds.left >= bounds.left - 2 && child.bounds.right <= bounds.right + 2)
    const next = { first: (visible[0]?.index ?? 0) + 1, last: (visible.at(-1)?.index ?? 0) + 1, start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 }
    setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next)
  }
  useEffect(() => {
    const element = track.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  function move(direction: number) {
    const element = track.current
    if (!element) return
    const distance = (element.firstElementChild?.getBoundingClientRect().width ?? element.clientWidth) + parseFloat(getComputedStyle(element).columnGap || '0')
    element.scrollBy({ left: direction * distance, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  return <div className={`snap-carousel ${className}`} role="region" aria-roledescription="carrossel" aria-label={label}>
    <div className="snap-track" id={id} ref={track} tabIndex={0} aria-label={`${label}: use as setas para navegar`} onScroll={measure} onKeyDown={event => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1) }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); event.currentTarget.scrollTo({ left: event.key === 'Home' ? 0 : event.currentTarget.scrollWidth, behavior: 'instant' }) }
    }}>{children}</div>
    <div className="carousel-controls"><p className="carousel-position" role="status" aria-live="polite" aria-atomic="true">{position.first === position.last ? position.first : `${position.first}–${position.last}`} de {count}</p><div className="carousel-arrows"><button className="icon-button" aria-label={`Anterior: ${label}`} aria-controls={id} disabled={position.start} onClick={() => move(-1)}>←</button><button className="icon-button" aria-label={`Próximo: ${label}`} aria-controls={id} disabled={position.end} onClick={() => move(1)}>→</button></div></div>
  </div>
}
