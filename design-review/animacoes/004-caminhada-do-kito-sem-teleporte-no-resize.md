# 004 — Caminhada do Kito: manter a posição ao redimensionar e registrar o QA das regras

- **Status**: TODO
- **Commit**: dacf7cd
- **Severity**: LOW
- **Category**: Interruptibility · Purpose (regras de marca da hero)
- **Estimated scope**: 1 arquivo (`src/components/HeroScene.tsx`), ~20 linhas no efeito do `ResizeObserver`

## Contexto (não mudar)

A caminhada já segue as regras do prompt da hero (`G:/Meu Drive/09-Second-brain/10-Projetos/01-KeyToTwo-Print/Desenvolvimento/Prompt - Hero Kito em pixel art.md`, seção "Coreografia"), conferidas nesta auditoria:

- Duas camadas separadas: `.kito-track` desloca (`kito-travel`, `steps(ticks)`), `.kito-frames` troca a pose (`kito-steps`, 12 poses, `steps(1, end)`), `src/styles.css:72-90`.
- 10 FPS, ciclo de 1,2 s, avanço de `S × 520 / 1254 / 12` px por tique (medido: ~66 px/s a 192 px), `src/kito-motion.ts` e `src/components/HeroScene.tsx:41-53`.
- Volta só fora da tela; começa visível e centralizado na pose 01; pausa fora de vista, com aba oculta e com menu/drawer abertos; `prefers-reduced-motion` começa pausado com o botão "Retomar animação" (`HeroScene.tsx:22-25,65,74`). Evidência: `design-review/capturas/home-1280-hero.webp`, `home-375-movimento-reduzido.webp`.

Nada disso deve mudar.

## Problem

O `ResizeObserver` recalcula `--travel-distance`, `--travel-duration`, `--travel-ticks` e `--motion-delay` a **cada** mudança de tamanho do palco — inclusive quando só a altura muda (carregamento de fonte, barra de endereço do celular encolhendo ao rolar). Como a duração da animação muda com a animação em andamento, o progresso é reinterpretado e o Kito **salta** para outro ponto do chão, dentro da área visível. O prompt da hero proíbe: "Não faça teleportes dentro da área visível".

```tsx
// src/components/HeroScene.tsx:39-57 — atual
const resize = new ResizeObserver(() => {
  if (!stage.current || !region.current) return
  const mobile = window.matchMedia('(max-width: 767px)').matches
  const cell = mobile ? kitoMotion.mobileCanvas : kitoMotion.desktopCanvas
  const stepDistance = cell * kitoMotion.sourceDistancePerCycle / kitoMotion.sourceCanvas / kitoMotion.frames
  // Each 100 ms tick advances both the pose and the world position. Include
  // one fully offscreen pose before wrapping; never wrap a visible canvas.
  const ticks = Math.floor((stage.current.clientWidth + cell) / stepDistance) + 2
  const duration = ticks / kitoMotion.fps
  // Whole cycles put the initial visible, centered character on frame 01.
  const initialTick = Math.round((stage.current.clientWidth + cell) / 2 / stepDistance / kitoMotion.frames) * kitoMotion.frames
  region.current.style.setProperty('--travel-distance', `${ticks * stepDistance}px`)
  region.current.style.setProperty('--travel-duration', `${duration}s`)
  region.current.style.setProperty('--travel-ticks', String(ticks))
  region.current.style.setProperty('--motion-delay', `${-initialTick / kitoMotion.fps}s`)
  region.current.style.setProperty('--walk-cycle-duration', `${kitoMotion.cycleSeconds}s`)
  setReady(true)
})
if (stage.current) resize.observe(stage.current)
```

## Target

1. Mudança só de altura não faz nada.
2. Mudança de largura (girar o celular, redimensionar a janela) recalcula a pista **preservando a posição atual na tela**: converte o `translateX` atual em tique da nova grade, reinicia as duas camadas juntas a partir desse tique (pose = tique mod 12, a mesma relação que já existe).

```tsx
// src/components/HeroScene.tsx — alvo do trecho acima
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
    // Restart both layers on the same tick so pose and position stay paired.
    for (const element of [track, frames]) {
      element.style.animationName = 'none'
      void element.offsetWidth
      element.style.animationName = ''
    }
  }
  lastWidth = width
  lastMobile = mobile
  setReady(true)
})
if (stage.current) resize.observe(stage.current)
```

`new DOMMatrixReadOnly('none')` devolve a identidade (x = 0), então o caso "sem transform" é seguro.

## Repo conventions to follow

- Parâmetros vêm de `src/kito-motion.ts`, arquivo gerado por `scripts/prepare-walk-assets.mjs`: **não editar à mão**.
- Nenhum estado React por frame (regra do prompt); a correção só mexe em propriedades CSS e reinicia animações CSS.
- Comentários do arquivo estão em inglês; manter.

## Steps

1. Em `src/components/HeroScene.tsx`, substituir o bloco das linhas 39-57 (do `const resize = new ResizeObserver(() => {` até `if (stage.current) resize.observe(stage.current)`) pelo bloco "alvo" acima, sem alterar o resto do `useEffect` (preferência de movimento, `IntersectionObserver`, limpeza).
2. Não alterar `src/styles.css:72-90` (keyframes e camadas).

## Boundaries

- Não mudar FPS, ciclo, distâncias, atlas, tamanhos do sprite (192/128 px), posição do chão nem a lógica de pausa.
- Não trocar CSS por canvas, rAF ou biblioteca de animação.
- Não regerar, recortar nem redimensionar o atlas.
- Se o trecho atual não for o citado, PARE e reporte.

## Verification

- **Mechanical**: `npm run lint`, `npm run typecheck`; `npx playwright test tests/e2e/public.spec.ts` (após `npm run build`). Rodar também `HERO_URL=<url da fatia> npm run verify:hero` (script manual `scripts/verify-hero.mjs`; sem `HERO_URL` ele usa `http://127.0.0.1:4174/`) e anexar a saída: `footGroundDelta ≤ 0.1 px`, `sceneClearance ≥ 20 px`.
- **Feel check — regras da hero (todas devem continuar verdadeiras)**:
  - Em 1280 px, assistir a um loop completo (~22 s): o Kito sai inteiro pela direita antes de reaparecer pela esquerda; nenhum salto dentro da tela.
  - Passagem 12 → 01 no player: a pose 01 não aparece duplicada (DevTools → Animations a 10 %).
  - Pés sempre no chão (linha de contato estável) a 192 px e a 128 px.
  - Redimensionar a janela de 1280 para 900 e de volta com o Kito no meio da tela: ele continua aproximadamente no mesmo ponto (tolerância de um passo, ~7 px) e segue andando sem trocar de pose fora de ordem.
  - No DevTools do celular (375 px), rolar para esconder a barra de endereço: o Kito não se move por causa disso.
  - "Pausar animação" para caminhada e deslocamento juntos; "Retomar animação" continua do mesmo ponto.
  - Com `prefers-reduced-motion: reduce`: começa parado, centralizado, pose 01, botão "Retomar animação".
- **Done when**: os itens acima conferidos em 1440×900, 1280×720, 390×844 e 320 px, com a saída de `verify:hero` anexada ao relatório da fatia.
