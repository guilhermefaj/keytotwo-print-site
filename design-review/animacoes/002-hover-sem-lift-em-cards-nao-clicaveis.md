# 002 — Tirar o "lift" de hover dos cards de jogo que não são clicáveis

- **Status**: TODO
- **Commit**: dacf7cd
- **Severity**: MEDIUM
- **Category**: Purpose & frequency · Physicality
- **Estimated scope**: 1 arquivo (`src/carousels.css`), 4 linhas removidas

## Problem

Os cinco cards do carrossel "Cinco jogos para puxar uma cadeira." sobem e giram no hover, mas o card não é um link nem um botão: só o primeiro tem um link interno ("Ver a prévia"). O movimento promete uma ação que não existe — o visitante passa o mouse, o card reage, ele clica e nada acontece. Evidência visual da seção: `design-review/capturas/home-1280-jogos-capas-kito.webp`.

```css
/* src/carousels.css:36-39 — atual */
@media (prefers-reduced-motion: no-preference) and (hover: hover) {
  .package-game { transition: transform 200ms var(--ease-out); transform-origin: bottom center; }
  .package-game:hover { transform: translateY(-4px) rotate(-.5deg); }
}
```

Markup de referência (o `article` não é interativo):

```tsx
// src/components/sections/PackageGames.tsx:9-11 — atual
<article className="package-game" key={game.id} aria-label={`Jogo ${index + 1} de 5`}>
  <GameCover code={`J00${index + 1}`} /><div className="package-game-copy">…{index === 0 && <a className="inline-link" href="/#experiencia">Ver a prévia</a>}</div>
</article>
```

## Target

Sem movimento no card. O feedback de hover fica só onde há ação (o link "Ver a prévia", que já sublinha via `.inline-link:hover` em `src/styles.css:157`).

```css
/* src/carousels.css — alvo: as linhas 36-39 deixam de existir */
```

Se, numa fatia futura, o card inteiro virar link (padrão "stretched link"), reintroduza o hover **somente** nesse caso, com `transform: translateY(-2px)` e `transition: transform 200ms var(--ease-out)`, sem rotação.

## Repo conventions to follow

- Hovers com movimento ficam sob `@media (prefers-reduced-motion: no-preference) and (hover: hover)`, como no bloco atual.
- Token de curva: `--ease-out` em `src/navigation.css:7`.

## Steps

1. Em `src/carousels.css`, apagar as linhas 36 a 39 (o bloco `@media (prefers-reduced-motion: no-preference) and (hover: hover) { … }` inteiro).
2. Rodar `grep -rn "package-game" tests` e conferir que nenhum teste depende de `transform` no hover (em `dacf7cd`, `tests/e2e/d3-design.spec.ts:88-90,178-183` e `tests/e2e/public.spec.ts:115` só contam cards e tiram capturas).

## Boundaries

- Não alterar `PackageGames.tsx`, `GameCover.tsx` nem o restante de `carousels.css`.
- Não adicionar hover em outro elemento.
- Se as linhas não forem as citadas, PARE e reporte.

## Verification

- **Mechanical**: `npm run lint`; `npx playwright test tests/e2e/d3-design.spec.ts` (após `npm run build`).
- **Feel check**: em 1280 px, passar o mouse pelos cinco cards: nenhum se move; no primeiro, o link "Ver a prévia" continua sublinhando no hover.
- **Done when**: `getComputedStyle(document.querySelector('.package-game')).transitionProperty` não inclui `transform` e o card não muda de posição no hover.
