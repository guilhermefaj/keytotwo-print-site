# KeyToTwo — protótipo da hero

React + Vite + TypeScript + Tailwind CSS. Este incremento entrega somente a hero, com os quatro quadros oficiais de caminhada do Kito (revisão 2), pausa acessível, menu mobile e painéis de demonstração. A copy e os tokens são propostas para revisão. Não há checkout, autenticação ou downloads.

## Rodar

Requer Node.js compatível com Vite 8 (verificado com Node 24.13.0) e npm.

```powershell
npm ci
npm run dev
```

Abrir **http://127.0.0.1:5173/preview/hero**. A raiz também exibe o protótipo para o portal do Maestri. Host `127.0.0.1`, porta `5173`, `strictPort: true`. O terminal **Servidor** é mantido pelo orquestrador; use o processo existente, sem encerrá-lo.

```powershell
npm run build
npm run preview
```

O preview de produção usa **http://127.0.0.1:4173/preview/hero**, também com porta estrita.

## Assets

```powershell
npm run assets:prepare
```

Originais utilizados em `art-source/hero/`; derivados servidos em `public/media/hero/`. O script não precisa acessar o vault. [Inventário e transformações](docs/hero-assets.md), [manifesto com hashes](docs/hero-assets.json) e [decisão sobre caminhada](docs/kito-walk-review.md).

O Kito da hero é pixel art em 256 px (`art-source/kito-pixel/`, o Kito.zip de 2026-10-18). `node scripts/prepare-kito-pixel.mjs` gera o atlas, a pose de frente e `src/kito-sprites.ts`; os quadros de "carregado" saem do pulo, girados com RotSprite.

Fontes auto-hospedadas: Bricolage Grotesque 700 e DM Sans 400/600, subset Latin, via `@fontsource`.

## Verificar

```powershell
npm run verificar
```

Roda lint, testes unitários, os dois builds (como o do CI e com o `.env.local`) e a suíte E2E, numa porta própria. A cena da hero (Kito perseguindo o cursor, carregado, toque no celular, movimento reduzido) fica em `tests/e2e/hero-kito.spec.ts`.

Limites: axe e Chromium automatizados não substituem revisão independente, leitor de tela ou testes em Safari/Firefox. [Notas e pendências](docs/implementation-notes.md).
