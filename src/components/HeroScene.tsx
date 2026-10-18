import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react'
import type { Kito } from '../lib/kito-playground'
import { kitoSprites } from '../kito-sprites'
import { Icon } from './ui/Icon'

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
// Server and first hydration render agree: paused until browser preferences load.
const serverMotionSnapshot = () => true
const serverVisibilitySnapshot = () => false

// O motor e o atlas só descem quando a cena roda pela primeira vez; antes disso o Kito é a pose de frente do servidor.
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
  const [manualPause, setManualPause] = useState<boolean | null>(null)
  const userPaused = manualPause ?? reducedMotion
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const preferenceChanged = () => {
      // Entering reduced-motion requires a fresh explicit opt-in.
      // Leaving it never overrides a manual pause.
      if (motionPreference.matches) setManualPause(true)
    }
    motionPreference.addEventListener('change', preferenceChanged)
    const intersection = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 })
    if (stage.current) intersection.observe(stage.current)
    return () => {
      motionPreference.removeEventListener('change', preferenceChanged)
      intersection.disconnect()
      kito.current?.destroy()
      kito.current = null
    }
  }, [])

  const running = !userPaused && visible && inView && !obscured
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
    <div ref={region} className="hero-scene-region" data-running={running} data-user-paused={userPaused}
      data-visible={visible} data-in-view={inView}>
      <div className="motion-controls">
        <button type="button" className="motion-button" aria-controls="kito-scene" onClick={() => setManualPause(!userPaused)}>
          <Icon component={userPaused ? IconPlayerPlayFilled : IconPlayerPauseFilled} size={16} />
          {userPaused ? 'Retomar animação' : 'Pausar animação'}
        </button>
      </div>
      {/* Desempenho: a cena é decorativa; a pose do Kito é leve e entra com prioridade baixa, depois do título. */}
      <div ref={stage} className="hero-scene" id="kito-scene" aria-hidden="true">
        <img className="cloud cloud-left" src="/media/hero/cloud-a.webp" width="280" height="117" alt="" fetchPriority="low" />
        <img className="cloud cloud-right" src="/media/hero/cloud-b.webp" width="208" height="88" alt="" fetchPriority="low" />
        <img className="cloud cloud-far" src="/media/hero/cloud-a.webp" width="280" height="117" alt="" fetchPriority="low" />
        <svg className="distant-land" width="1440" height="96" viewBox="0 0 1440 96" preserveAspectRatio="none">
          <path d="M0 24h72v12h56v16h64v-8h48v16h100v12h96v-8h88v16h112v-8h88v8h100v-16h64v-8h88v12h56v-20h80v-12h64v-8h80V8h84V0h100v96H0Z" fill="#CFE6D7" />
        </svg>
        <img className="landscape landscape-left" src="/media/hero/foliage-left.webp" width="360" height="119" alt="" fetchPriority="low" />
        <img className="landscape landscape-right" src="/media/hero/foliage-right.webp" width="720" height="298" alt="" fetchPriority="low" />
        <div className="ground"><div className="ground-grass" /><div className="ground-soil" /></div>
      </div>
      {/* A camada do Kito cobre a hero inteira: ele anda no chão da cena, mas pode ser carregado por cima do texto. */}
      <div ref={layer} className="kito-layer" aria-hidden="true">
        <div ref={shadow} className="kito-shadow" />
        <div ref={sprite} className="kito-sprite"><div ref={hitbox} className="kito-hitbox" /></div>
      </div>
    </div>
  )
}
