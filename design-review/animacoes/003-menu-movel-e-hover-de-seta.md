# 003 — Encurtar o escalonamento do menu móvel e limitar o hover da seta a ponteiro fino

- **Status**: TODO
- **Commit**: dacf7cd
- **Severity**: LOW
- **Category**: Easing & duration · Accessibility (hover em toque)
- **Estimated scope**: 1 arquivo (`src/navigation.css`), 3 linhas

## Problem

**a) Menu móvel lento.** Cada link do menu entra em 400 ms, com atraso de `60ms + ordem × 50ms`. Com quatro itens (O pacote, Como funciona, Blog e, logado, Meus jogos) o último termina em ~610 ms — tempo de painel de marketing num controle de navegação aberto várias vezes por visita. Durante a entrada os links estão com `opacity: .01`, mas já são clicáveis. Evidência do estado aberto: `design-review/capturas/menu-375-aberto.webp`.

```css
/* src/navigation.css:100 — atual */
.mobile-menu-sheet[data-state="open"] .sheet-nav .nav-link { animation: d1-link 400ms var(--ease-out) both; animation-delay: calc(60ms + var(--link-order, 3) * 50ms); }
/* src/navigation.css:105 — atual */
@keyframes d1-link { from { opacity: .01; transform: translateX(16px); } to { opacity: 1; transform: none; } }
```

**b) Seta que desliza no toque.** O deslocamento da seta "→" no hover dos botões não está restrito a dispositivos com hover real. Em celular, o toque dispara um hover "grudado": a seta fica deslocada depois do toque.

```css
/* src/navigation.css:91-92 — atual (dentro de @media (prefers-reduced-motion: no-preference)) */
.button > [aria-hidden="true"] { transition: transform 180ms var(--ease-out); }
.button:hover > [aria-hidden="true"] { transform: translateX(4px); }
```

## Target

```css
/* a) navigation.css:100 — alvo: 240 ms por link, escalonamento de 40 ms */
.mobile-menu-sheet[data-state="open"] .sheet-nav .nav-link { animation: d1-link 240ms var(--ease-out) both; animation-delay: calc(40ms + var(--link-order, 3) * 40ms); }
/* a) navigation.css:105 — alvo: deslocamento de 8 px */
@keyframes d1-link { from { opacity: .01; transform: translateX(8px); } to { opacity: 1; transform: none; } }
```

Último link termina em ~400 ms (40 + 3 × 40 + 240), dentro do orçamento de painel (200–500 ms) e com escalonamento na faixa de 30–80 ms.

```css
/* b) alvo: a linha 92 sai do bloco atual e passa a um bloco próprio, logo abaixo dele */
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .button:hover > [aria-hidden="true"] { transform: translateX(4px); }
}
```

A linha 91 (a `transition`) permanece onde está.

## Repo conventions to follow

- Curva única do projeto: `--ease-out: cubic-bezier(.16, 1, .3, 1)` (`src/navigation.css:7`).
- Hover com movimento já usa `(hover: hover)` em `src/carousels.css:36`; aqui acrescentamos `(pointer: fine)`.

## Steps

1. `src/navigation.css:100`: `400ms` → `240ms`; `calc(60ms + var(--link-order, 3) * 50ms)` → `calc(40ms + var(--link-order, 3) * 40ms)`.
2. `src/navigation.css:105`: `translateX(16px)` → `translateX(8px)`.
3. `src/navigation.css:92`: recortar a linha e colá-la num novo bloco `@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) { … }` imediatamente após o fechamento do bloco que termina na linha 102.

## Boundaries

- Não mexer na animação do painel (`d1-sheet`, linhas 98-99) nem no overlay (96-97): a saída usa `ease-in reverse`, o que pela especificação inverte também a curva e resulta numa saída que começa rápida — está correto.
- Não remover a seta dos rótulos (isso é decisão de design tratada no relatório, achado P2-3).
- Se as linhas não baterem, PARE e reporte.

## Verification

- **Mechanical**: `npm run lint`; `npx playwright test tests/e2e/d1-navigation.spec.ts` (após `npm run build`).
- **Feel check**:
  - 375 px: abrir e fechar o menu cinco vezes seguidas; os links chegam juntos com o painel, sem "fila" visível.
  - DevTools → Animations a 10 %: o último link termina antes de ~0,4 s.
  - Emular toque (DevTools → device toolbar, iPhone): tocar em "Quero o pacote" no menu e voltar; a seta não fica deslocada.
  - 1280 px com mouse: a seta continua deslizando 4 px no hover.
- **Done when**: os três valores acima estão no CSS e o hover da seta só ocorre com `pointer: fine`.
