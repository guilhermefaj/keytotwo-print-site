import { kitoSprites } from '../kito-sprites'

// O Kito da hero: persegue o mouse pelo chão, vai até onde a pessoa toca, pode ser carregado e arremessado,
// e, sozinho, passeia, senta e joga. Um elemento com o atlas (posição por transform, pose por background-position),
// um laço de requestAnimationFrame que dorme quando o Kito está parado e Pointer Events para mouse e toque.
// Coordenadas em px CSS da camada (a hero inteira). Velocidades e distâncias são medidas na arte (256 px) e
// multiplicadas pela escala da tela, para o passo ser o mesmo no desktop e no celular.

type Anim = keyof typeof kitoSprites.animations
type Mode = 'idle' | 'move' | 'sit' | 'play' | 'love' | 'push' | 'clip' | 'carried' | 'airborne'
type Step = [anim: Anim, frame: number, facing?: 1 | -1]
type Clip = { steps: Step[]; fps: number; clock: number; then: () => void; hop?: boolean; slide?: boolean }

export type Kito = { setRunning(running: boolean): void; destroy(): void }

const { cell, columns, rows, animations } = kitoSprites
const carry = animations.carry
const WALK = 90, RUN = 240, SPRINT = 460
// Passada por quadro, em px de arte: a cadência dos pés acompanha a velocidade, sem patinar.
const STRIDE = { walk: 9, run: 15.7, sprint: 23.3 }
const ACCEL = 900, BRAKE = 1400, GRAVITY = 3200
// Para sair do lugar o cursor precisa se afastar mais do que para parar: tremidas do mouse não viram passos.
const START_DISTANCE = 40, ARRIVE_DISTANCE = 12
const DRAG_THRESHOLD = 6
// Poses de lado espelham para a esquerda; as de frente nunca.
const SIDE = new Set<Anim>(['frontSide', 'side', 'walk', 'run', 'sprint', 'fall', 'push', 'play'])
const POSE: Partial<Record<Mode, Anim>> = { idle: 'front', sit: 'sit', play: 'play', love: 'love', push: 'push' }
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"]'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const approach = (value: number, target: number, delta: number) => value < target ? Math.min(target, value + delta) : Math.max(target, value - delta)
const between = (min: number, max: number) => min + Math.random() * (max - min)

export function startKito({ hero, layer, sprite, hitbox, shadow }: { hero: HTMLElement; layer: HTMLElement; sprite: HTMLElement; hitbox: HTMLElement; shadow: HTMLElement }): Kito {
  let scale = 0.75, size = cell * scale, width = 0, ground = 0, ceiling = 0, left = 0
  let running = false, raf = 0, timer = 0, last = 0, drawn = ''
  let now = performance.now()
  const s = {
    x: 0, y: 0, vx: 0, vy: 0, facing: -1 as 1 | -1, hop: 0,
    mode: 'idle' as Mode, since: now, anim: 'front' as Anim, frame: 0, clip: null as Clip | null,
    // target: x que o Kito persegue; mouse: o cursor está na hero; goal: alvo de um toque ou de um passeio, some ao chegar.
    target: null as number | null, mouse: false, goal: null as null | 'tap' | 'wander', traveled: 0, phase: 0, braking: false,
    hovered: false, loveUntil: 0, nextAt: between(2500, 5000),
    tilt: 0, spin: 0, handVx: 0,
    drag: null as null | { id: number; x: number; y: number; at: number; carrying: boolean; samples: Array<[t: number, x: number, y: number]> },
    tap: null as null | { id: number; x: number; y: number; at: number },
  }

  const minX = () => size * 0.32
  const maxX = () => width - size * 0.32

  function measure() {
    const rect = layer.getBoundingClientRect()
    size = sprite.getBoundingClientRect().width || size
    scale = size / cell
    width = rect.width
    left = rect.left
    const style = getComputedStyle(layer)
    ground = rect.height - (parseFloat(style.getPropertyValue('--floor-height')) || 0) + (parseFloat(style.getPropertyValue('--foot-sink')) || 0)
    ceiling = parseFloat(getComputedStyle(hero).paddingTop) || 0
    sprite.style.backgroundSize = `${columns * size}px ${rows * size}px`
    s.x = clamp(s.x, minX(), maxX())
    if (s.mode !== 'carried' && s.mode !== 'airborne') s.y = ground
    drawn = ''
  }

  function setMode(mode: Mode) {
    s.mode = mode
    s.since = now
    s.clip = null
    const pose = POSE[mode]
    if (pose) { s.anim = pose; s.frame = 0 }
  }

  function play(steps: Step[], fps: number, then: () => void, extra: Partial<Clip> = {}) {
    s.mode = 'clip'
    s.clip = { steps, fps, clock: 0, then, ...extra }
    applyStep(steps[0])
  }

  function applyStep([anim, frame, facing]: Step) {
    s.anim = anim
    s.frame = frame
    if (facing) s.facing = facing
  }

  const idle = () => setMode(s.hovered ? 'love' : 'idle')
  const settle = () => play([['frontSide', 0]], 8, idle)
  const celebrate = (then = idle) => play([0, 1, 2, 3, 4, 5, 6].map(frame => ['jump', frame]), 12, then, { hop: true })
  const range = (from: number, to: number): Step[] => Array.from({ length: to - from + 1 }, (_, i) => ['fall', from + i])

  function turn(dir: 1 | -1) {
    play([['frontSide', 0], ['front', 0], ['frontSide', 0, dir]], 14, () => setMode('move'))
  }

  function wander() {
    const distance = between(150, 600) * scale * (Math.random() < 0.5 ? -1 : 1)
    let target = s.x + distance
    if (target < minX() || target > maxX()) target = s.x - distance
    s.target = clamp(target, minX(), maxX())
    s.goal = 'wander'
  }

  // Decide o próximo passo de quem está no chão, sem quadro em andamento.
  function think(dt: number) {
    const target = s.target === null ? null : clamp(s.target, minX(), maxX())
    const dx = target === null ? 0 : target - s.x
    const moving = s.mode === 'move'
    if (target !== null && Math.abs(dx) > (moving ? ARRIVE_DISTANCE : START_DISTANCE) * scale) {
      const dir: 1 | -1 = dx > 0 ? 1 : -1
      if (!moving) {
        // Levanta de frente, vira para o lado do alvo e sai andando.
        if (s.mode === 'sit' || s.mode === 'play') return play([['front', 0]], 6, () => turn(dir))
        return dir === s.facing ? play([['frontSide', 0, dir]], 12, () => setMode('move')) : turn(dir)
      }
      if (dir !== s.facing) {
        // Em sprint, mudar de lado às vezes termina num tropeço (sorteado uma vez por virada); senão freia e vira.
        const trips = !s.braking && Math.abs(s.vx) > 300 * scale && Math.random() < 0.4
        s.braking = true
        if (trips) return play(range(3, 8), 11, () => { s.braking = false; turn(dir) }, { slide: true })
        s.vx = approach(s.vx, 0, BRAKE * scale * dt)
        if (Math.abs(s.vx) < 20 * scale) { s.vx = 0; s.braking = false; return turn(dir) }
      } else {
        const distance = Math.abs(dx) / scale
        // Longe, sprint; a meia distância, corrida; perto, caminhada. A frenagem amacia a troca.
        const gait = distance > 500 ? SPRINT : distance > 110 ? RUN : WALK
        const want = Math.min(gait, Math.max(WALK * 0.5, Math.sqrt(2 * BRAKE * 0.6 * distance))) * scale
        const speed = Math.abs(s.vx)
        s.vx = dir * (speed < want ? Math.min(want, speed + ACCEL * scale * dt) : Math.max(want, speed - BRAKE * scale * dt))
      }
      s.x = clamp(s.x + s.vx * dt, minX(), maxX())
      s.traveled += Math.abs(s.vx * dt)
      const speed = Math.abs(s.vx) / scale
      const gait = speed > 300 ? 'sprint' : speed > 150 ? 'run' : 'walk'
      s.anim = gait
      s.phase += dt * Math.max(speed / STRIDE[gait], 5)
      s.frame = Math.floor(s.phase) % animations[gait].count
      return
    }
    if (moving) {
      // Chegou: comemora quando a viagem foi longa e foi a pessoa quem chamou (não quando parou numa borda).
      const called = s.traveled > size && (s.mouse || s.goal === 'tap') && s.target === target
      s.vx = 0
      s.traveled = 0
      if (s.goal) { s.target = null; s.goal = null }
      s.nextAt = between(2500, 5000)
      return called ? celebrate() : settle()
    }
    // Cursor além da borda que o Kito alcança: ele empurra a borda.
    const raw = s.target
    const pushing = raw !== null && raw !== target && Math.abs(target! - s.x) <= START_DISTANCE * scale
    if (pushing) {
      if (s.mode !== 'push') { setMode('push'); s.facing = raw! < s.x ? -1 : 1 }
      s.phase += dt * 8
      s.frame = Math.floor(s.phase) % animations.push.count
      return
    }
    if (s.mode === 'push') return settle()
    if (s.hovered && s.mode !== 'love') return setMode('love')
    if (s.mode === 'love' && !s.hovered && now > s.loveUntil) return setMode('idle')
    const waited = now - s.since
    if (s.mouse) {
      // Com o cursor por perto e parado: senta e, depois de um tempo, joga no tabuleiro, virado para o lado em que parou.
      if (s.mode === 'idle' && waited > 3500) setMode('sit')
      else if (s.mode === 'sit' && waited > 10000) setMode('play')
    } else if (waited > s.nextAt && (s.mode === 'idle' || s.mode === 'sit' || s.mode === 'play')) {
      // Sozinho: passeia, senta e joga, sem pressa.
      const roll = Math.random()
      s.nextAt = between(6000, 11000)
      if (s.mode === 'idle' && roll < 0.4) setMode('sit')
      else if (s.mode === 'sit' && roll < 0.5) setMode('play')
      else wander()
    }
  }

  function advanceClip(dt: number) {
    const clip = s.clip!
    clip.clock += dt
    if (clip.slide) {
      s.x = clamp(s.x + s.vx * dt, minX(), maxX())
      s.vx = approach(s.vx, 0, 1600 * scale * dt)
    }
    const index = Math.floor(clip.clock * clip.fps)
    // Pulo: os quadros 3 a 5 tiram o Kito do chão por um arco curto.
    s.hop = clip.hop ? Math.max(0, Math.sin(Math.PI * clamp((clip.clock * clip.fps - 3) / 3, 0, 1))) * 22 * scale : 0
    if (index >= clip.steps.length) { s.clip = null; s.hop = 0; clip.then(); return }
    applyStep(clip.steps[index])
  }

  // Pêndulo: a mão anda para um lado e o corpo atrasa, girando no sentido do movimento.
  function swing(dt: number, vx: number) {
    const target = clamp(vx / scale * 0.02, -20, 20)
    s.spin += (60 * (target - s.tilt) - 7 * s.spin) * dt
    s.tilt += s.spin * dt
    let best = 0
    carry.angles.forEach((angle, i) => { if (Math.abs(angle - s.tilt) < Math.abs(carry.angles[best] - s.tilt)) best = i })
    s.anim = 'carry'
    s.frame = best
  }

  const feetBelowGrab = () => (carry.feet[s.frame] - carry.grab[s.frame][1]) * scale

  function fly(dt: number) {
    s.vy += GRAVITY * scale * dt
    s.vx *= Math.exp(-0.8 * dt)
    s.x += s.vx * dt
    s.y += s.vy * dt
    const side = size * 0.3
    if (s.x < side) { s.x = side; s.vx = Math.abs(s.vx) * 0.45 }
    if (s.x > width - side) { s.x = width - side; s.vx = -Math.abs(s.vx) * 0.45 }
    if (s.y < ceiling + 30 * scale) { s.y = ceiling + 30 * scale; s.vy = Math.abs(s.vy) * 0.3 }
    swing(dt, s.vx)
    if (s.y + feetBelowGrab() < ground) return
    // Aterrissa: queda alta ou arremesso forte rola no chão; queda curta só amortece.
    const hard = s.vy / scale > 1500 || Math.abs(s.vx) / scale > 900
    s.y = ground
    s.vy = 0
    s.x = clamp(s.x, minX(), maxX())
    s.tilt = s.spin = 0
    s.traveled = 0
    s.nextAt = between(2500, 5000)
    if (hard) { s.facing = s.vx < 0 ? -1 : 1; play(range(4, 8), 10, idle, { slide: true }) }
    else { s.vx = 0; play([['jump', 6], ['jump', 1], ['jump', 2], ['jump', 0]], 14, idle) }
  }

  function step(dt: number) {
    if (s.mode === 'carried') swing(dt, s.handVx)
    else if (s.mode === 'airborne') fly(dt)
    else if (s.clip) advanceClip(dt)
    else think(dt)
  }

  const device = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio

  function render() {
    const carried = s.anim === 'carry'
    const index = animations[s.anim].start + s.frame
    const [ax, ay] = carried ? carry.grab[s.frame] : [cell / 2, animations[s.anim].ground]
    const flip = s.facing < 0 && SIDE.has(s.anim)
    const x = device(s.x - ax * scale), y = device(s.y - s.hop - ay * scale)
    const key = `${index}|${x}|${y}|${flip}|${s.mode}`
    if (key === drawn) return
    drawn = key
    sprite.style.transform = `translate3d(${x}px, ${y}px, 0)${flip ? ' scaleX(-1)' : ''}`
    // A sombra fica no chão e encolhe com a altura dos pés: é ela que mostra o quanto ele subiu.
    const feet = carried ? s.y + feetBelowGrab() : s.y - s.hop
    const near = clamp(1 - (ground - feet) / (2.5 * size), 0.3, 1)
    shadow.style.transform = `translateX(${device(s.x)}px) translateX(-50%) scale(${near.toFixed(2)})`
    sprite.style.backgroundPosition = `${-(index % columns) * size}px ${-Math.floor(index / columns) * size}px`
    sprite.dataset.mode = s.mode === 'clip' ? s.anim : s.mode
  }

  // Quanto o laço pode dormir: zero enquanto algo se move; senão, até o próximo evento do relógio.
  function restFor() {
    if (s.clip || s.drag || s.mode === 'move' || s.mode === 'push' || s.mode === 'carried' || s.mode === 'airborne') return 0
    // Alvo longe ou além da borda (empurrando): o laço segue acordado.
    if (s.target !== null && (Math.abs(clamp(s.target, minX(), maxX()) - s.x) > START_DISTANCE * scale || s.target !== clamp(s.target, minX(), maxX()))) return 0
    const waited = now - s.since
    if (s.mode === 'love') return s.hovered ? Infinity : Math.max(16, s.loveUntil - now)
    if (s.mouse) return s.mode === 'idle' ? 3500 - waited : s.mode === 'sit' ? 10000 - waited : Infinity
    return Math.max(16, s.nextAt - waited)
  }

  function tick(time: number) {
    raf = 0
    now = time
    step(Math.min(0.05, (time - last) / 1000))
    last = time
    render()
    if (!running) return
    const rest = restFor()
    if (rest <= 0) raf = requestAnimationFrame(tick)
    else if (Number.isFinite(rest)) timer = window.setTimeout(wake, rest)
  }

  function wake() {
    clearTimeout(timer)
    if (!running || raf) return
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function point(event: PointerEvent) {
    const rect = layer.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  // Hero: o mouse vira alvo; um toque curto fora de links e botões também.
  function onHeroMove(event: PointerEvent) {
    if (event.pointerType === 'touch' || s.drag) return
    s.mouse = true
    s.goal = null
    s.target = event.clientX - left
    wake()
  }
  function onHeroLeave(event: PointerEvent) {
    if (event.pointerType === 'touch' || s.drag) return
    s.mouse = false
    s.target = null
    s.since = performance.now()
    s.nextAt = between(2500, 5000)
    wake()
  }
  function onHeroDown(event: PointerEvent) {
    if (event.pointerType !== 'mouse') s.tap = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
  }
  function onHeroUp(event: PointerEvent) {
    const tap = s.tap
    s.tap = null
    if (!tap || tap.id !== event.pointerId || s.drag || !running) return
    if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10 || event.timeStamp - tap.at > 500) return
    if ((event.target as Element).closest?.(INTERACTIVE)) return
    s.target = event.clientX - left
    s.goal = 'tap'
    wake()
  }

  // Kito: pressionar e arrastar carrega; clique ou toque sem arrastar faz ele pular.
  function onKitoDown(event: PointerEvent) {
    if (!running || s.drag || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    event.stopPropagation()
    hitbox.setPointerCapture(event.pointerId)
    const { x, y } = point(event)
    s.drag = { id: event.pointerId, x, y, at: event.timeStamp, carrying: false, samples: [[event.timeStamp, x, y]] }
    wake()
  }
  function holdAt(x: number, y: number) {
    s.x = clamp(x, size * 0.2, width - size * 0.2)
    s.y = clamp(y, ceiling + 30 * scale, ground - feetBelowGrab())
  }
  function onKitoMove(event: PointerEvent) {
    const drag = s.drag
    if (!drag || drag.id !== event.pointerId) return
    const { x, y } = point(event)
    if (!drag.carrying) {
      if (Math.hypot(x - drag.x, y - drag.y) < DRAG_THRESHOLD) return
      drag.carrying = true
      s.clip = null
      s.hop = 0
      setMode('carried')
      s.vx = s.vy = s.tilt = s.spin = s.handVx = 0
      s.anim = 'carry'
      s.frame = 2
      s.hovered = false
      document.documentElement.dataset.kitoCarrying = 'true'
    }
    drag.samples.push([event.timeStamp, x, y])
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0][0] > 100) drag.samples.shift()
    const [t0, x0] = drag.samples[0]
    s.handVx = event.timeStamp > t0 ? (x - x0) / ((event.timeStamp - t0) / 1000) : 0
    holdAt(x, y)
    wake()
  }
  function onKitoUp(event: PointerEvent) {
    const drag = s.drag
    if (!drag || drag.id !== event.pointerId) return
    s.drag = null
    delete document.documentElement.dataset.kitoCarrying
    if (!drag.carrying) {
      // No toque não há hover: depois do pulo ele segura o coração por um instante.
      if (event.type === 'pointerup' && s.mode !== 'clip') {
        const touch = event.pointerType !== 'mouse'
        celebrate(touch ? () => { s.loveUntil = performance.now() + 1800; setMode('love') } : idle)
      }
      return wake()
    }
    // Solta com a velocidade da mão nos últimos 100 ms: dá para arremessar.
    const [t0, x0, y0] = drag.samples[0]
    const seconds = (event.timeStamp - t0) / 1000
    const throwable = event.type === 'pointerup' && seconds > 0.01
    const limit = 2400 * scale
    s.vx = throwable ? clamp((s.x - x0) / seconds, -limit, limit) : 0
    s.vy = throwable ? clamp((s.y - y0) / seconds, -limit, limit) : 0
    // Com o mouse, depois de cair ele volta para perto do cursor.
    if (event.pointerType === 'mouse') { s.target = event.clientX - left; s.goal = null }
    setMode('airborne')
    wake()
  }
  function onKitoEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    s.hovered = true
    wake()
  }
  function onKitoLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    s.hovered = false
    wake()
  }

  const resize = new ResizeObserver(() => { measure(); render() })
  const listeners: Array<[EventTarget, string, (event: PointerEvent) => void]> = [
    [hero, 'pointermove', onHeroMove], [hero, 'pointerleave', onHeroLeave], [hero, 'pointerdown', onHeroDown], [hero, 'pointerup', onHeroUp],
    [hitbox, 'pointerdown', onKitoDown], [hitbox, 'pointermove', onKitoMove], [hitbox, 'pointerup', onKitoUp], [hitbox, 'pointercancel', onKitoUp],
    [hitbox, 'pointerenter', onKitoEnter], [hitbox, 'pointerleave', onKitoLeave],
  ]

  // Começa onde o servidor desenhou o Kito parado (64 % da largura), já com o atlas.
  measure()
  s.x = clamp(width * 0.64, minX(), maxX())
  s.y = ground
  layer.dataset.live = 'true'
  render()
  resize.observe(layer)
  for (const [target, type, listener] of listeners) target.addEventListener(type, listener as EventListener)

  return {
    setRunning(next) {
      running = next
      if (running) return wake()
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      raf = 0
      if (s.drag) {
        if (hitbox.hasPointerCapture(s.drag.id)) hitbox.releasePointerCapture(s.drag.id)
        if (s.drag.carrying) { s.vx = s.vy = 0; setMode('airborne') }
        s.drag = null
        delete document.documentElement.dataset.kitoCarrying
      }
    },
    destroy() {
      this.setRunning(false)
      resize.disconnect()
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener as EventListener)
    },
  }
}
