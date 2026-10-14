import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { kitoMotion } from '../kito-motion'

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

export function HeroScene({ obscured = false }: { obscured?: boolean }) {
  const region = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const reducedMotion = useSyncExternalStore(subscribeMotionPreference, motionSnapshot, serverMotionSnapshot)
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, serverVisibilitySnapshot)
  const [manualPause, setManualPause] = useState<boolean | null>(null)
  const userPaused = manualPause ?? reducedMotion
  const [inView, setInView] = useState(false)
  const [ready, setReady] = useState(false)

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
    let lastWidth = 0
    let lastMobile: boolean | null = null
    const resize = new ResizeObserver(() => {
      if (!stage.current || !region.current) return
      const width = stage.current.clientWidth
      const mobile = window.matchMedia('(max-width: 767px)').matches
      // Height-only changes (fonts, mobile URL bar) never move the character.
      if (width === lastWidth && mobile === lastMobile) return
      const cell = mobile ? kitoMotion.mobileCanvas : kitoMotion.desktopCanvas
      const stepDistance = cell * kitoMotion.sourceDistancePerCycle / kitoMotion.sourceCanvas / kitoMotion.frames
      // Each 100 ms tick advances both the pose and the world position. Include
      // one fully offscreen pose before wrapping; never wrap a visible canvas.
      const ticks = Math.floor((width + cell) / stepDistance) + 2
      const duration = ticks / kitoMotion.fps
      // First layout: whole cycles put the visible, centered character on frame 01.
      let tick = Math.round((width + cell) / 2 / stepDistance / kitoMotion.frames) * kitoMotion.frames
      const track = stage.current.querySelector<HTMLElement>('.kito-track')
      const frames = stage.current.querySelector<HTMLElement>('.kito-frames')
      if (lastWidth && track) {
        // Later layouts keep the on-screen position: map the current x to the new step grid.
        const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
        tick = Math.min(ticks - 1, Math.max(0, Math.round(x / stepDistance)))
      }
      region.current.style.setProperty('--travel-distance', `${ticks * stepDistance}px`)
      region.current.style.setProperty('--travel-duration', `${duration}s`)
      region.current.style.setProperty('--travel-ticks', String(ticks))
      region.current.style.setProperty('--motion-delay', `${-tick / kitoMotion.fps}s`)
      region.current.style.setProperty('--walk-cycle-duration', `${kitoMotion.cycleSeconds}s`)
      if (lastWidth && track && frames) {
        // Restart both layers in the same style flush so pose and position stay paired.
        for (const element of [track, frames]) element.style.animationName = 'none'
        void track.offsetWidth
        for (const element of [track, frames]) element.style.animationName = ''
      }
      lastWidth = width
      lastMobile = mobile
      setReady(true)
    })
    if (stage.current) resize.observe(stage.current)
    return () => {
      motionPreference.removeEventListener('change', preferenceChanged)
      intersection.disconnect()
      resize.disconnect()
    }
  }, [])

  const running = ready && !userPaused && visible && inView && !obscured
  return (
    <div ref={region} className="hero-scene-region" data-running={running} data-user-paused={userPaused}
      data-visible={visible} data-in-view={inView}>
      <div className="motion-controls">
        <button type="button" className="motion-button" aria-controls="kito-scene" onClick={() => setManualPause(!userPaused)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            {userPaused ? <path d="M3 1.5 12 7l-9 5.5Z" /> : <path d="M3 2h3v10H3zm5 0h3v10H8z" />}
          </svg>
          {userPaused ? 'Retomar animação' : 'Pausar animação'}
        </button>
      </div>
      <div ref={stage} className="hero-scene" id="kito-scene" aria-hidden="true">
        <img className="cloud cloud-left" src="/media/hero/cloud-a.webp" width="280" height="117" alt="" />
        <img className="cloud cloud-right" src="/media/hero/cloud-b.webp" width="208" height="88" alt="" />
        <svg className="distant-land" width="1440" height="96" viewBox="0 0 1440 96" preserveAspectRatio="none">
          <path d="M0 24h72v12h56v16h64v-8h48v16h100v12h96v-8h88v16h112v-8h88v8h100v-16h64v-8h88v12h56v-20h80v-12h64v-8h80V8h84V0h100v96H0Z" fill="#CFE6D7" />
        </svg>
        <img className="landscape landscape-left" src="/media/hero/foliage-left.webp" width="360" height="119" alt="" />
        <img className="landscape landscape-right" src="/media/hero/foliage-right.webp" width="720" height="298" alt="" />
        <div className="kito-track" style={ready ? undefined : { left: 'calc(50% - var(--sprite-size) / 2)', animationDelay: '0s' }}><div className="kito-frames" /></div>
        <div className="ground"><div className="ground-grass" /><div className="ground-soil" /></div>
      </div>
    </div>
  )
}
