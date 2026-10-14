# 005 — Entradas de UI mais curtas, com tokens de duração

- **Status**: TODO
- **Commit**: dacf7cd
- **Severity**: LOW
- **Category**: Easing & duration · Cohesion & tokens
- **Estimated scope**: 3 arquivos (`src/navigation.css`, `src/portal.css`, `src/purchase.css`), ~8 linhas

## Problem

Elementos de interface usam 400 ms com 12–16 px de deslocamento, tempo e distância de página de marketing:

- **Meus jogos**: os cards "entram como cartas" toda vez que a pessoa abre a biblioteca (visita recorrente, para baixar de novo). Com cinco cards e 60 ms de escalonamento, o último termina em 640 ms. Evidência da tela: `design-review/capturas/meus-jogos-1280-capas.webp`.
- **Pagamento**: o bloco de pagamento e o formulário do Stripe surgem em 400 ms num momento em que a pessoa quer agir.
- As durações estão digitadas à mão em cada arquivo (160, 180, 200, 280, 400, 650, 800, 1100 ms); só a curva é token.

```css
/* src/portal.css:74 e :76 — atual */
.portal-game { animation: portal-deal 400ms var(--ease-out) backwards; animation-delay: calc(var(--game-order, 0) * 60ms); }
@keyframes portal-deal { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

/* src/purchase.css:29, :60, :61 e :65 — atual */
.stripe-payment #checkout-form { opacity: 0; transform: translateY(12px); }
  .payment-reveal { animation: purchase-appear 400ms var(--ease-out) both; }
  .stripe-payment #checkout-form { transition: opacity 400ms, transform 400ms var(--ease-out); }
@keyframes purchase-appear { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
```

## Target

Tokens novos junto da curva existente e entradas de 240 ms / 8 px / 40 ms de escalonamento (último card de Meus jogos termina em ~400 ms).

```css
/* src/navigation.css :root — acrescentar logo após --ease-out (linha 7) */
  --duration-ui: 240ms;
  --stagger: 40ms;

/* src/portal.css — alvo */
.portal-game { animation: portal-deal var(--duration-ui) var(--ease-out) backwards; animation-delay: calc(var(--game-order, 0) * var(--stagger)); }
@keyframes portal-deal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

/* src/purchase.css — alvo */
.stripe-payment #checkout-form { opacity: 0; transform: translateY(8px); }
  .payment-reveal { animation: purchase-appear var(--duration-ui) var(--ease-out) both; }
  .stripe-payment #checkout-form { transition: opacity var(--duration-ui) var(--ease-out), transform var(--duration-ui) var(--ease-out); }
@keyframes purchase-appear { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
```

Fora do escopo, de propósito: a celebração da compra (`kito-hello` 800 ms e confete 1 100 ms em `src/purchase.css:62-63`) é um momento raro e pode ter mais tempo; o escalonamento do menu é tratado no plano 003; o reveal da home, no plano 001.

## Repo conventions to follow

- Tokens de movimento ficam no `:root` de `src/navigation.css` (já tem `--ease-out`, `--shadow-*`, `--header-height`).
- Toda entrada continua dentro de `@media (prefers-reduced-motion: no-preference)`, como hoje (`portal.css:73`, `purchase.css:59`).

## Steps

1. `src/navigation.css`: inserir `--duration-ui: 240ms;` e `--stagger: 40ms;` no bloco `:root` (linhas 2-10), logo após `--ease-out`.
2. `src/portal.css:74`: `400ms` → `var(--duration-ui)`; `* 60ms` → `* var(--stagger)`.
3. `src/portal.css:76`: `translateY(16px)` → `translateY(8px)`.
4. `src/purchase.css:29`: `translateY(12px)` → `translateY(8px)`.
5. `src/purchase.css:60`: `400ms` → `var(--duration-ui)`.
6. `src/purchase.css:61`: substituir por `.stripe-payment #checkout-form { transition: opacity var(--duration-ui) var(--ease-out), transform var(--duration-ui) var(--ease-out); }`.
7. `src/purchase.css:65`: `translateY(16px)` → `translateY(8px)`.

## Boundaries

- Não mexer em `kito-hello`, `confetti-settle`, `d1-kito`, `d1-sheet`, `d1-fade`, nem na caminhada do Kito.
- Não mudar markup nem a ordem dos cards.
- Se alguma linha não bater, PARE e reporte.

## Verification

- **Mechanical**: `npm run lint`; testes afetados após `npm run build`: `npx playwright test tests/e2e/d2-portal.spec.ts tests/e2e/i3-checkout.spec.ts` (portal e compra).
- **Feel check**:
  - Logado, abrir `/meus-jogos` três vezes seguidas (aba Pedidos → Meus jogos): os cards chegam rápido, sem sensação de "esperar o baralho".
  - `/pagamento` com item no carrinho (ambiente de teste, sem pagar): o formulário aparece em menos de 0,25 s, subindo 8 px.
  - DevTools → Animations a 10 %: último card de Meus jogos termina perto de 0,4 s.
  - `prefers-reduced-motion: reduce`: nenhuma entrada animada.
- **Done when**: não há mais `400ms` em `src/portal.css` nem em `src/purchase.css`, e os dois tokens existem em `src/navigation.css`.
