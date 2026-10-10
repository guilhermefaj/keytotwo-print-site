# 001 — Revelar o conteúdo da seção, nunca a seção inteira

- **Status**: TODO
- **Commit**: dacf7cd
- **Severity**: HIGH
- **Category**: Purpose & frequency · Easing & duration
- **Estimated scope**: 2 arquivos (`src/routes/home.tsx`, `src/navigation.css`), ~6 linhas; 1 teste a conferir

## Problem

A home aplica a animação de entrada (`opacity 0 → 1` + `translateY(16px) → 0`, 400 ms) às **oito seções inteiras** (`.page-section`), incluindo o fundo colorido de cada uma (faixa escura `#123a3d`, céu, damasco do fechamento). Ao rolar rápido, ao clicar em uma âncora (`/#comprar`, `/#como-funciona`) ou ao voltar para cima, faixas de página aparecem vazias ou semitransparentes. Evidência: `design-review/capturas/home-1280-reveal-meio-da-rolagem.webp` (120 ms após rolar: seções com opacidade 0,72–0,90; outras ainda `pending` com opacidade 0).

```ts
// src/routes/home.tsx:25 — atual
useScrollReveal(main)
```

```ts
// src/lib/use-scroll-reveal.ts:4 — atual (seletor padrão)
export function useScrollReveal(scope: RefObject<HTMLElement | null>, selector = '.page-section') {
```

```css
/* src/navigation.css:93-95 — atual (dentro de @media (prefers-reduced-motion: no-preference)) */
[data-reveal] { transition: opacity 400ms var(--ease-out) var(--reveal-delay, 0ms), transform 400ms var(--ease-out) var(--reveal-delay, 0ms); }
[data-reveal="pending"] { opacity: 0; transform: translateY(16px); transition: none; }
[data-reveal="visible"] { opacity: 1; transform: none; }
```

O fundo é o que dá ritmo à página; escondê-lo não comunica nada e cria "buracos". O movimento deve ficar só no conteúdo, curto e discreto.

## Target

1. O alvo do reveal passa a ser o contêiner interno de cada seção: `.page-section > .content-width`. O fundo da seção fica sempre pintado.
2. Distância 8 px, duração 320 ms, mesma curva do projeto (`--ease-out`).

```ts
// src/routes/home.tsx — alvo
useScrollReveal(main, '.page-section > .content-width')
```

```css
/* src/navigation.css — alvo, mesmas 3 linhas, ainda dentro de @media (prefers-reduced-motion: no-preference) */
[data-reveal] { transition: opacity 320ms var(--ease-out) var(--reveal-delay, 0ms), transform 320ms var(--ease-out) var(--reveal-delay, 0ms); }
[data-reveal="pending"] { opacity: 0; transform: translateY(8px); transition: none; }
[data-reveal="visible"] { opacity: 1; transform: none; }
```

A regra de movimento reduzido (`src/navigation.css:135-138`) continua igual: `[data-reveal] { opacity: 1; transform: none; }`.

## Repo conventions to follow

- A curva já existe como token: `--ease-out: cubic-bezier(.16, 1, .3, 1);` em `src/navigation.css:7`. Não criar outra.
- O hook já aceita um seletor como segundo parâmetro (`src/lib/use-scroll-reveal.ts:4`); não alterar o hook.
- Todas as seções da home têm um filho direto `.content-width` (conferido em `ExperienceSections.tsx:13,22,26`, `PackageGames.tsx:7`, `HowItWorks.tsx:4`, `OfferSection.tsx:10`, `FaqSection.tsx:4`, `FromBlog.tsx:6`, `ClosingCta.tsx:2`).

## Steps

1. Em `src/routes/home.tsx:25`, trocar `useScrollReveal(main)` por `useScrollReveal(main, '.page-section > .content-width')`.
2. Em `src/navigation.css:93`, trocar as duas ocorrências de `400ms` por `320ms`.
3. Em `src/navigation.css:94`, trocar `translateY(16px)` por `translateY(8px)`.
4. Abrir `tests/e2e/d1-navigation.spec.ts:199-206`. O teste procura `[data-reveal="pending"]` (continua existindo, agora nos contêineres) e confere `opacity`/`transform` em `.offer-section`. A seção não recebe mais `data-reveal`, então a asserção continua verdadeira; se quiser que ela teste o novo alvo, troque o locator para `.offer-section > .content-width`. Não mude o resto do teste.

## Boundaries

- Não tocar em `src/lib/use-scroll-reveal.ts`, nas cores, no markup das seções nem em outras animações.
- Não adicionar dependências.
- Se algum trecho citado não bater com o código encontrado (o arquivo mudou depois de `dacf7cd`), PARE e reporte.

## Verification

- **Mechanical**: `npm run lint` e `npm run typecheck` sem erros; `npx playwright test tests/e2e/d1-navigation.spec.ts -g "reveal"` passando (exige `npm run build` antes, conforme `playwright.config.ts`).
- **Feel check** (1280 e 375):
  - Clicar em "Quero o pacote" no header (âncora `/#comprar`): a faixa céu da oferta aparece já pintada; só o texto e o card sobem 8 px.
  - Rolar rápido do topo ao rodapé e voltar: nenhuma faixa branca entre seções; fundos escuro e damasco sempre visíveis.
  - DevTools → Animations a 10 %: o conteúdo entra de baixo para cima, sem o fundo piscar.
  - DevTools → Rendering → `prefers-reduced-motion: reduce`: nenhum deslocamento; tudo visível de imediato.
- **Done when**: nenhum elemento com classe `page-section` possui atributo `data-reveal` (`document.querySelectorAll('.page-section[data-reveal]').length === 0`) e a captura equivalente a `home-1280-reveal-meio-da-rolagem.webp` mostra os fundos opacos.
