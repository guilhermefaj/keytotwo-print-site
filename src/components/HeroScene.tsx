import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Kito } from '../lib/kito-playground'
import { kitoSprites } from '../kito-sprites'

function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
const motionSnapshot = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const visibilitySnapshot = () => document.visibilityState === 'visible'
// Server and first hydration render agree: still until browser preferences load.
// Sem botão de pausa (decisão do responsável, 2026-10-18): quem pede movimento reduzido ao sistema vê o Kito parado.
const serverMotionSnapshot = () => true
const serverVisibilitySnapshot = () => false

// O motor e o atlas só descem quando a cena roda pela primeira vez; antes disso o Kito é a pose parada do servidor.
async function loadKito() {
  const atlas = new Image()
  atlas.fetchPriority = 'low'
  atlas.src = kitoSprites.atlas
  const [{ startKito }] = await Promise.all([import('../lib/kito-playground'), atlas.decode().catch(() => undefined)])
  return startKito
}

export function HeroScene({ obscured = false }: { obscured?: boolean }) {
  const region = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const sprite = useRef<HTMLDivElement>(null)
  const hitbox = useRef<HTMLDivElement>(null)
  const shadow = useRef<HTMLDivElement>(null)
  const kito = useRef<Kito | null>(null)
  const reducedMotion = useSyncExternalStore(subscribeMotionPreference, motionSnapshot, serverMotionSnapshot)
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, serverVisibilitySnapshot)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const intersection = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 })
    if (stage.current) intersection.observe(stage.current)
    return () => {
      intersection.disconnect()
      kito.current?.destroy()
      kito.current = null
    }
  }, [])

  const running = !reducedMotion && visible && inView && !obscured
  useEffect(() => {
    if (!running) return
    let cancelled = false
    if (kito.current) kito.current.setRunning(true)
    else loadKito().then(startKito => {
      const hero = region.current?.closest<HTMLElement>('.hero')
      if (cancelled || !hero || !layer.current || !sprite.current || !hitbox.current || !shadow.current) return
      kito.current = startKito({ hero, layer: layer.current, sprite: sprite.current, hitbox: hitbox.current, shadow: shadow.current })
      kito.current.setRunning(true)
    }).catch(() => undefined) // Sem o motor, o Kito fica parado de frente: a cena é decorativa.
    return () => {
      cancelled = true
      kito.current?.setRunning(false)
    }
  }, [running])

  return (
    <div ref={region} className="hero-scene-region" data-running={running} data-visible={visible} data-in-view={inView}>
      {/* Desde 2026-10-24 sem paisagem: o Kito anda no pé da hero, por cima da foto também (DESIGN.md › Hero). */}
      <div ref={stage} className="hero-scene" aria-hidden="true"><div className="ground" /></div>
      {/* A camada do Kito cobre a hero inteira: ele anda no pé dela e pode ser carregado por cima do texto e da foto. */}
      <div ref={layer} className="kito-layer" aria-hidden="true">
        <div ref={shadow} className="kito-shadow" />
        <div ref={sprite} className="kito-sprite"><div ref={hitbox} className="kito-hitbox" /></div>
      </div>
    </div>
  )
}
