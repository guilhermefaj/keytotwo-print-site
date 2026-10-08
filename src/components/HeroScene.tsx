import { useEffect, useRef, useState } from 'react'
import { kitoMotion } from '../kito-motion'

export function HeroScene({ obscured = false }: { obscured?: boolean }) {
  const region = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [userPaused, setUserPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const [inView, setInView] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const preferenceChanged = () => {
      // Entering reduced-motion requires a fresh explicit opt-in.
      // Leaving it never overrides a manual pause.
      if (motionPreference.matches) setUserPaused(true)
    }
    const visibilityChanged = () => setVisible(document.visibilityState === 'visible')
    motionPreference.addEventListener('change', preferenceChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
    const intersection = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 })
    if (stage.current) intersection.observe(stage.current)
    const resize = new ResizeObserver(() => {
      if (!stage.current || !region.current) return
      const mobile = window.matchMedia('(max-width: 767px)').matches
      const cell = mobile ? 128 : 192
      const speed = mobile ? kitoMotion.mobilePixelsPerSecond : kitoMotion.desktopPixelsPerSecond
      const duration = (stage.current.clientWidth + cell) / speed
      region.current.style.setProperty('--travel-distance', `${stage.current.clientWidth + cell}px`)
      region.current.style.setProperty('--travel-duration', `${duration}s`)
      region.current.style.setProperty('--travel-delay', `${-duration / 2}s`)
      region.current.style.setProperty('--walk-cycle-duration', `${kitoMotion.cycleSeconds}s`)
      setReady(true)
    })
    if (stage.current) resize.observe(stage.current)
    return () => {
      motionPreference.removeEventListener('change', preferenceChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
      intersection.disconnect()
      resize.disconnect()
    }
  }, [])

  const running = ready && !userPaused && visible && inView && !obscured
  return (
    <div ref={region} className="hero-scene-region" data-running={running} data-user-paused={userPaused}
      data-visible={visible} data-in-view={inView}>
      <div className="motion-controls">
        <button type="button" className="motion-button" aria-controls="kito-scene" onClick={() => setUserPaused(paused => !paused)}>
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
        <div className="kito-track"><div className="kito-frames" /></div>
        <div className="ground"><div className="ground-grass" /><div className="ground-soil" /></div>
      </div>
    </div>
  )
}
