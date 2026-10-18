import { kitoSprites } from '../kito-sprites'

// O Kito da hero: persegue o mouse pelo chão, vai até onde a pessoa toca, pode ser carregado e arremessado.
// Sem mouse na hero (no celular, sempre), um piloto automático alterna o que ele sabe fazer, já começando em movimento,
// para quem chega perceber que ele anda, pula e pode ser pego. Um elemento com o atlas (posição por transform, pose por
// background-position), um laço de requestAnimationFrame que dorme quando o Kito está parado e Pointer Events para
// mouse e toque. Coordenadas em px CSS da camada (a hero inteira). Velocidades e distâncias são medidas na arte
// (256 px) e multiplicadas pela escala da tela, para o passo ser o mesmo no desktop e no celular.

type Anim = keyof typeof kitoSprites.animations
type Mode = 'idle' | 'move' | 'sit' | 'sleep' | 'love' | 'push' | 'clip' | 'carried' | 'airborne'
type Step = [anim: Anim, frame: number, facing?: 1 | -1]
// hop: [quadro inicial, quadro final, altura em px de arte] de um arco que tira o Kito do chão durante o clipe.
type Clip = { steps: Step[]; fps: number; clock: number; then: () => void; hop?: [number, number, number]; slide?: boolean }
type Action = 'walk' | 'run' | 'sprint' | 'jump' | 'wave' | 'hoist' | 'love' | 'sit' | 'push'

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
// Cursor parado perto dele: cochila depois de 4 s, respirando a um quadro a cada 220 ms.
const SLEEP_AFTER = 4000, SLEEP_FRAME = 220
// Piloto automático: peso de cada ação no sorteio. Depois de uma ação parada vem sempre um deslocamento, e depois de
// um deslocamento, na maioria das vezes, uma ação parada: ele nunca fica muito tempo no mesmo lugar.
const MOVES: Array<[Action, number]> = [['walk', 2], ['run', 3], ['sprint', 1.5], ['push', 0.7]]
const STAYS: Array<[Action, number]> = [['jump', 2], ['wave', 2], ['hoist', 1.5], ['love', 1], ['sit', 0.8]]
// Poses de lado espelham para a esquerda; as de frente nunca.
const SIDE = new Set<Anim>(['frontSide', 'side', 'walk', 'run', 'sprint', 'fall', 'push'])
const POSE: Partial<Record<Mode, Anim>> = { idle: 'front', sit: 'sit', sleep: 'sleep', love: 'love', push: 'push' }
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"]'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const approach = (value: number, target: number, delta: number) => value < target ? Math.min(target, value + delta) : Math.max(target, value - delta)
const between = (min: number, max: number) => min + Math.random() * (max - min)
const frames = (anim: Anim, list: number[]): Step[] => list.map(frame => [anim, frame])

export function startKito({ hero, layer, sprite, hitbox, shadow }: { hero: HTMLElement; layer: HTMLElement; sprite: HTMLElement; hitbox: HTMLElement; shadow: HTMLElement }): Kito {
  let scale = 0.75, size = cell * scale, width = 0, ground = 0, ceiling = 0, left = 0
  let running = false, raf = 0, timer = 0, last = 0, drawn = ''
  let now = performance.now()
  const s = {
    x: 0, y: 0, vx: 0, vy: 0, facing: -1 as 1 | -1, hop: 0,
    mode: 'idle' as Mode, since: now, anim: 'front' as Anim, frame: 0, clip: null as Clip | null,
    // target: x que o Kito persegue; mouse: o cursor está na hero; goal: de onde veio um alvo que some ao chegar
    // (toque, piloto automático ou empurrar a borda); cap: passo máximo; tripAt: distância em que tropeça no sprint.
    target: null as number | null, mouse: false, goal: null as null | 'tap' | 'auto' | 'push', cap: SPRINT, tripAt: 0,
    traveled: 0, phase: 0, braking: false, hovered: false, loveUntil: 0,
    // O piloto automático começa correndo e depois acena; nextAt é a pausa, em ms, antes da próxima ação.
    nextAt: 0, queue: ['run', 'wave'] as Action[], lastAction: null as Action | null,
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
  const celebrate = (then = idle) => play(frames('jump', [0, 1, 2, 3, 4, 5, 6]), 12, then, { hop: [3, 6, 22] })
  // Aceno duplo: a mão sobe, balança duas vezes e desce.
  const wave = (then = idle) => play(frames('wave', [0, 1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 7, 8]), 11, then)
  // Uma mão invisível ergue o Kito e o põe de volta: a dica de que dá para pegá-lo.
  const hoist = () => play(frames('hoist', [0, 1, 2, 3, 4, 5, 6, 7, 8]), 9, idle, { hop: [2, 7, 40] })
  const greet = (then = idle) => Math.random() < 0.5 ? celebrate(then) : wave(then)
  const stumble = (from: number, to: number) => frames('fall', Array.from({ length: to - from + 1 }, (_, i) => from + i))

  function turn(dir: 1 | -1) {
    play([['frontSide', 0], ['front', 0], ['frontSide', 0, dir]], 14, () => setMode('move'))
  }

  // Alvo do piloto automático a `distance` px de arte, para o lado que tiver espaço.
  function go(distance: number, cap: number, trips = false) {
    const step = distance * scale * (Math.random() < 0.5 ? -1 : 1)
    const target = s.x + step < minX() || s.x + step > maxX() ? s.x - step : s.x + step
    s.target = clamp(target, minX(), maxX())
    s.goal = 'auto'
    s.cap = cap
    s.tripAt = trips ? Math.abs(s.target - s.x) * 0.5 : 0
  }

  function autopilot() {
    let action = s.queue.shift()
    if (!action) {
      const moved = MOVES.some(([name]) => name === s.lastAction)
      const options = (moved && Math.random() < 0.7 ? STAYS : MOVES).filter(([name]) => name !== s.lastAction)
      let roll = Math.random() * options.reduce((sum, [, weight]) => sum + weight, 0)
      action = options.find(([, weight]) => (roll -= weight) < 0)?.[0] ?? 'run'
    }
    s.lastAction = action
    s.nextAt = between(300, 900)
    if (action === 'walk') go(between(140, 260), WALK)
    else if (action === 'run') go(between(280, 520), RUN)
    else if (action === 'sprint') go(width / scale * between(0.5, 0.75), SPRINT, Math.random() < 0.35)
    else if (action === 'jump') celebrate()
    else if (action === 'wave') wave()
    else if (action === 'hoist') hoist()
    else if (action === 'love') { setMode('love'); s.loveUntil = now + 1400 }
    else if (action === 'sit') { setMode('sit'); s.nextAt = between(1200, 2000) }
    else { s.target = s.x < width / 2 ? -width : width * 2; s.goal = 'push'; s.cap = RUN; s.tripAt = 0 }
  }

  // Decide o próximo passo de quem está no chão, sem quadro em andamento.
  function think(dt: number) {
    const target = s.target === null ? null : clamp(s.target, minX(), maxX())
    const dx = target === null ? 0 : target - s.x
    const moving = s.mode === 'move'
    if (target !== null && Math.abs(dx) > (moving ? ARRIVE_DISTANCE : START_DISTANCE) * scale) {
      const dir: 1 | -1 = dx > 0 ? 1 : -1
      if (!moving) {
        // Levanta (ou acorda num susto), vira para o lado do alvo e sai andando.
        if (s.mode === 'sleep') return play([['jump', 1], ['jump', 2], ['front', 0]], 10, () => turn(dir))
        if (s.mode === 'sit') return play([['front', 0]], 6, () => turn(dir))
        return dir === s.facing ? play([['frontSide', 0, dir]], 12, () => setMode('move')) : turn(dir)
      }
      if (dir !== s.facing) {
        // Em sprint, mudar de lado às vezes termina num tropeço (sorteado uma vez por virada); senão freia e vira.
        const trips = !s.braking && Math.abs(s.vx) > 300 * scale && Math.random() < 0.4
        s.braking = true
        if (trips) return play(stumble(3, 8), 11, () => { s.braking = false; turn(dir) }, { slide: true })
        s.vx = approach(s.vx, 0, BRAKE * scale * dt)
        if (Math.abs(s.vx) < 20 * scale) { s.vx = 0; s.braking = false; return turn(dir) }
      } else {
        const distance = Math.abs(dx) / scale
        // Longe, sprint; a meia distância, corrida; perto, caminhada. A frenagem amacia a troca.
        const gait = Math.min(s.cap, distance > 500 ? SPRINT : distance > 110 ? RUN : WALK)
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
      // Piloto automático: alguns sprints terminam num tropeço no meio do caminho, e ele segue.
      if (s.tripAt && s.traveled > s.tripAt && speed > 250) {
        s.tripAt = 0
        return play(stumble(3, 8), 11, () => setMode('move'), { slide: true })
      }
      return
    }
    if (moving) {
      // Chegou: cumprimenta quando a viagem foi longa e foi a pessoa quem chamou (não quando parou numa borda).
      const called = s.traveled > size && (s.mouse || s.goal === 'tap') && s.target === target
      s.vx = 0
      s.traveled = 0
      s.nextAt = s.goal === 'tap' ? between(1500, 3000) : between(250, 700)
      if (s.goal === 'tap' || s.goal === 'auto') { s.target = null; s.goal = null }
      if (s.goal !== 'push') return called ? greet() : settle()
    }
    // Cursor além da borda que o Kito alcança: ele empurra a borda.
    const raw = s.target
    const pushing = raw !== null && raw !== target && Math.abs(target! - s.x) <= START_DISTANCE * scale
    if (pushing) {
      if (s.mode !== 'push') { setMode('push'); s.facing = raw! < s.x ? -1 : 1 }
      s.phase += dt * 8
      s.frame = Math.floor(s.phase) % animations.push.count
      if (s.goal === 'push' && now - s.since > 1600) { s.target = null; s.goal = null }
      return
    }
    if (s.mode === 'push') return settle()
    if (s.hovered && s.mode !== 'love') return setMode('love')
    if (s.mode === 'love' && !s.hovered && now > s.loveUntil) return setMode('idle')
    const waited = now - s.since
    if (s.mode === 'sleep') s.frame = Math.floor(waited / SLEEP_FRAME) % animations.sleep.count
    if (s.mouse) {
      if (s.mode === 'idle' && waited > SLEEP_AFTER) setMode('sleep')
    } else if (!s.goal && waited > s.nextAt && (s.mode === 'idle' || s.mode === 'sit' || s.mode === 'sleep')) autopilot()
  }

  function advanceClip(dt: number) {
    const clip = s.clip!
    clip.clock += dt
    if (clip.slide) {
      s.x = clamp(s.x + s.vx * dt, minX(), maxX())
      s.vx = approach(s.vx, 0, 1600 * scale * dt)
    }
    const index = Math.floor(clip.clock * clip.fps)
    if (clip.hop) {
      const [from, to, height] = clip.hop
      s.hop = Math.sin(Math.PI * clamp((clip.clock * clip.fps - from) / (to - from), 0, 1)) * height * scale
    }
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
    s.nextAt = between(1200, 2500)
    // A queda da arte é de costas (os pés vão para a frente): ele olha para o lado de onde veio e escorrega de costas.
    if (hard) {
      if (Math.abs(s.vx) > 30 * scale) s.facing = s.vx > 0 ? -1 : 1
      play(stumble(4, 8), 10, idle, { slide: true })
    }
    else { s.vx = 0; play(frames('jump', [6, 1, 2, 0]), 14, idle) }
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
    if (s.mode === 'sleep') return SLEEP_FRAME - (waited % SLEEP_FRAME)
    if (s.mode === 'love' && s.hovered) return Infinity
    if (s.mode === 'love') return s.loveUntil - now
    if (s.mouse) return s.mode === 'idle' ? SLEEP_AFTER - waited : Infinity
    return s.nextAt - waited
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
  function chase(x: number, goal: 'tap' | null) {
    s.target = x
    s.goal = goal
    s.cap = SPRINT
    s.tripAt = 0
    s.queue = []
    wake()
  }
  function onHeroMove(event: PointerEvent) {
    if (event.pointerType === 'touch' || s.drag) return
    s.mouse = true
    chase(event.clientX - left, null)
  }
  function onHeroLeave(event: PointerEvent) {
    if (event.pointerType === 'touch' || s.drag) return
    s.mouse = false
    s.target = null
    s.since = performance.now()
    s.nextAt = between(600, 1500)
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
    chase(event.clientX - left, 'tap')
  }

  // Kito: pressionar e arrastar carrega; clique ou toque sem arrastar faz ele pular ou acenar.
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
      s.frame = carry.angles.indexOf(0)
      s.hovered = false
      s.goal = null
      s.tripAt = 0
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
      // No toque não há hover: depois do pulo ou do aceno ele segura o coração por um instante.
      if (event.type === 'pointerup' && s.mode !== 'clip') {
        const touch = event.pointerType !== 'mouse'
        s.target = null
        s.goal = null
        s.nextAt = between(1500, 3000)
        greet(touch ? () => { s.loveUntil = performance.now() + 1800; setMode('love') } : idle)
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
    // Com o mouse, depois de cair ele volta para perto do cursor; no toque, segue o piloto automático.
    s.target = event.pointerType === 'mouse' ? event.clientX - left : null
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
