# Passagem da refação visual para a equipe fixa

2026-10-10 · De Nanquim (front-end de design, temporário) para Aquarela e Guache. Direção B "Folha de recorte", aprovada no [Portão 1](2026-10-portao-1.md); achados e balanço em [2026-10-auditoria.md](2026-10-auditoria.md) e [2026-10-balanco-final.md](2026-10-balanco-final.md). Commits `86b82cf` → `b785e19` na branch `design/refacao-2026-10`.

## 1. DESIGN.md é a fonte visual

- [`DESIGN.md`](../DESIGN.md) na raiz manda. O frontmatter YAML traz os tokens normativos; o corpo traz as regras de uso por seção (Colors, Typography, Layout, Elevation, Shapes, Components, Do's and Don'ts). O sidecar `.impeccable/design.json` repete tokens e regras para a skill impeccable.
- Antes de criar ou mudar uma tela: ler Overview, Components e Do's and Don'ts. Em conflito entre código antigo e DESIGN.md, vale o DESIGN.md; se a regra não cobre o caso, acrescente a regra ao DESIGN.md no mesmo commit.
- Verificação mecânica: `impeccable detect --json src` (skill na pasta do papel) aponta valor fora da escala. Restam só o botão do Google (especificação do Google) e arquivos fora da camada visual.

## 2. Mapa de tokens (`src/styles.css`)

| Token | Valor | Onde usar |
| --- | --- | --- |
| `--color-paper` | `#FFFFFF` | fundo de tudo abaixo da hero, cards, inputs, botão secundário |
| `--color-ink` | `#123A3D` | texto, títulos, marcas de corte, borda do secundário, contorno de foco |
| `--color-ink-soft` | `#345B5D` | texto secundário, legendas, ajuda de campo, borda de input |
| `--color-deep-teal` (+`-hover #00565D`, `-active #00454B`) | `#006970` | botão primário, links, tesoura, aba ativa |
| `--color-line` | `#1BB8C4` | **só linhas**: recorte, calhas da folha, borda de carta e card, pontilhado da ficha; nunca texto nem borda única de controle (2,41:1) |
| `--color-highlight` | `#FFB866` | marca-texto atrás de uma palavra, uma vez por página; nunca fundo de bloco |
| `--color-sky` | `#ECFAF7` | só a hero (e o header sobre ela) |
| `--color-error` | `#993518` | mensagem e borda de erro |
| `--color-ink-wash` / `--color-ink-rule` | Tinta a 6 % / 18 % | hover e desabilitado / divisórias sólidas |
| `--text-display` (`-mobile` 2.625rem, `-xs` 2.25rem) | `clamp(2.625rem, 1.5rem + 4.9vw, 5.5rem)` | só o H1 da hero |
| `--text-headline` / `--text-headline-sm` | `clamp(2.125rem, 1.5rem + 2.6vw, 3.25rem)` / `1.75rem` | H2 de folha e H1 interno / preço real, título do menu móvel, vazios, newsletter |
| `--text-title-lg` / `--text-title` / `--text-title-sm` | `1.5rem` / `1.375rem` / `1.1875rem` | H2 de card / nome na carta / H3 de legenda e item |
| `--text-lead` / `--text-body` / `--text-small` | `1.125rem` / `1rem` / `.9375rem` | apoio da hero e total / corpo / nav, abas, fichas |
| `--text-label` / `--text-caption` / `--text-micro` | `.875rem` / `.8125rem` / `.6875rem` | botões e rótulos (caixa normal) / legendas e meta / selo e contagem |
| `--tracking-display/-headline/-title` | `-.04em` / `-.03em` / `-.02em` | nunca abaixo de −0,04em; corpo sem tracking |
| `--space-xs…3xl` | 4, 8, 16, 24, 32, 48, 64 px | ritmo em múltiplos de 8; mais espaço acima do título que abaixo |
| `--space-section` / `--container` / `--container-wide` | `clamp(48px, 7vw, 88px)` / 1140 / 1280 px | padding de folha / conteúdo / cabeçalho |
| `--radius-sm` / `-md` / `-lg` | 6 / 10 / 14 px | botões, inputs, etiquetas / miniaturas, avisos, popover / cartas e cards. Sem cápsula |
| `--line-cut` / `--line-card` / `--line-dot` / `--line-rule` | 2px dashed line / 2px solid line / 2px dotted line / 1px solid ink-rule | recorte e calhas / carta e card / ficha / divisória comum |
| `--shadow-panel` / `-menu` / `-header` | `-12px 0 48px` .12 / `0 12px 40px` .16 / `0 8px 24px` .08 | só gaveta e menu móvel / popover da conta / cabeçalho rolado |
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` | toda entrada e hover; nunca `ease-in` |
| `--duration-press` / `-ui` / `-panel` / `-reveal` / `--stagger` | 160 / 240 / 280 / 320 / 40 ms | pressão de botão / entradas de UI / abrir painel (fechar 180) / reveal do conteúdo (8 px) / escalonamento |

Tudo sob `@media (prefers-reduced-motion: no-preference)`; só a celebração da compra (800 ms + confete 1,1 s) passa de 300 ms.

## 3. Componentes criados e alterados

- **Linha de recorte** `src/components/ui/CutLine.tsx` (`.cut-line`): tracejado de borda a borda com a tesoura na margem. Também `.crop-marks` (cantos em L) e `.folha` em `src/styles.css`.
- **Capa de jogo** `src/components/account/GameCover.tsx` + `game-cover.css`: prévia real só se `games.ts` tiver `preview`; senão tipográfica (`.game-cover-type`, selo `.tag-solid`); `soon` = "em breve" tracejado. Dentro do card da biblioteca vira 16:10 sem borda (`portal.css`).
- **Folha de cartas** `src/components/sections/PackageGames.tsx` (`.games-carousel.folha`, `.package-game`, `src/carousels.css`): 5 colunas no desktop, 2 até 1050 px, carrossel por snap só ≤767 px (`SnapCarousel`, setas em SVG).
- **Ficha** `.ficha` (dl com pontilhado) em `PackageGames.tsx`; **etiqueta** `.tag` e **marca-texto** `mark` na hero (`src/routes/home.tsx`).
- **Botões** `.button-primary` / `.button-secondary` / `.text-button` / `.inline-link` / `.icon-button` (`src/styles.css`): retos, sem sombra, sem seta; "Tentar novamente" é sempre secundário.
- **Hero** `src/routes/home.tsx` + `src/components/HeroScene.tsx`: texto à esquerda; caminhada intacta e com o plano 004 (resize sem teleporte). Parâmetros em `src/kito-motion.ts` (gerado; não editar).
- **Cabeçalho e rodapé** `src/components/layout/SiteHeader.tsx` (modo privado em Minha área, sem CTA nem carrinho) e `SiteFooter.tsx` (tesoura só no rodapé público, régua nas demais rotas).
- **Oferta e compra** `OfferSection.tsx`, `ProductPurchaseAction.tsx`, `checkout/PurchaseUi.tsx` (`PurchaseThumbnail` usa `product.thumbnail` ou capa tipográfica), `routes/carrinho.tsx`, `routes/pagamento.tsx` (tagline e entrega visíveis em cada passo).
- **Estados** `account/AccountUi.tsx` (`DataStatus`: uma mensagem `role="alert"` + secundário), `ui/KitoEmpty.tsx` (só vazios), `.kito-still` (pose neutra = quadro 01 do atlas) em `pedido.confirmacao.tsx`, `not-found.tsx` e `PendingPage` em `src/root.tsx`; `.offer-price[data-state="pending"]` em estilo de corpo.
- **Relatos e freebie** `sections/ExperienceSections.tsx` (`Testimonials`), `OfferSection.tsx` (`FreebieInvite`), conteúdo em `src/content/experience.ts`.
- **Dados** `src/content/products.ts` (título, `tagline`, `contents`, `delivery`, `thumbnail`, `games`) e `src/content/games.ts` (`code`, `name`, `confirmed`, `summary`, `preview`, `facts`).
- Removidos: `GamesSection.tsx`, ícones de pilares, numeração 01–05, rótulos em caixa alta, setas "→", sombra dura, cápsulas, ~25 classes órfãs.

## 4. Regras que valem daqui em diante

1. **Três tesouras**: hero → jogos, antes da oferta, rodapé público. Nunca em páginas privadas nem dentro de seção. Seções do mesmo assunto separam-se por espaço.
2. **Tracejado só onde há cartas** (folha, calhas, etiqueta, "em breve", freebie); divisórias comuns usam `--line-rule`.
3. **Kito age**: caminha na hero, acolhe nos vazios, celebra a compra, convida uma vez na home. Erro, falha e 404 usam `.kito-still`. Nunca ícone, capa ou enfeite; nunca gerar, recortar ou espelhar imagens.
4. **Catálogo nos dados**: novo produto ou jogo entra por `products.ts` e `games.ts`, sem CSS novo. Nenhum componente desenha "5" ou "P001".
5. **Stage**: relatos com `placeholder: true` e o bloco do freebie (`proposal: true`) só renderizam no stage `test`; em `preview` e `live` só relatos reais, e sem nenhum a seção não existe.
6. **Copy só aprovada**: a do Portão 1 e a já existente em `src/content`. Mudança de copy, preço, promessa ou navegação passa pelo responsável. Sem eyebrow, kicker ou caixa alta acima de títulos; um nome por ação ("Quero o pacote", "Adicionar ao carrinho", "Ver a prévia", "Tentar novamente").
7. **Contraste AA medido** em todo estado novo (repouso, hover, foco, desabilitado, erro); pares atuais no DESIGN.md › Colors. Foco de 3 px Tinta em tudo.
8. **`prefers-reduced-motion`**: nenhuma entrada, carrossel instantâneo, Kito parado com "Retomar animação".
9. **Testes conscientes do stage**: `tests/e2e/fixtures/stage.ts` lê o build; o que depende de carrinho, relatos ou fixtures autenticadas só roda em `test` e, nos outros stages, verifica a ausência. Renomear classe ou texto afirmado (`.package-game`, `.game-cover*`, `.social-card[data-placeholder]`, `.offer-price`, `.kito-still`, "Quero o pacote", "Minha conta", banner "Ambiente de teste") exige atualizar o spec no mesmo commit.

## 5. Armadilhas conhecidas

- **Cascata**: `styles.css` e `navigation.css` carregam em `root.tsx`; `carousels`, `newsletter`, `purchase`, `portal`, `blog` e `game-cover` carregam por rota ou componente, na ordem de navegação. Token e regra global ficam só nos dois primeiros; classe compartilhada entre rotas precisa de escopo (caso `.step-number`).
- **`.env.local` em `test` × CI em `preview`** (`site.config.json`): o build local esconde diferenças de stage. Reproduza com `VITE_SITE_STAGE=preview npm run build` (a variável do shell vence o `.env.local`) e rode a suíte nos dois.
- **Playwright e a 4174**: deixe o `playwright.config.ts` subir o `sirv`; um `sirv` iniciado à mão cacheia a lista de arquivos e devolve 404 após um rebuild. O `verify:hero` precisa do build (`HERO_URL=http://127.0.0.1:4174/`); no dev o React acusa um aviso de hidratação dev-only pela captura.
- **Memória**: a máquina trava com vários Chromium; rode e2e com `--workers=1` em lotes e feche sessões ociosas antes da suíte completa.
- **Git Bash**: argumentos iniciados por `/` viram caminhos do Windows; use `MSYS_NO_PATHCONV=1` nos scripts de captura (`.maestri/roles/<id>/scripts/capture.mjs`).
- **Fora da camada visual**: `src/lib/**`, rotas, loaders, Stripe, Supabase e `scripts/` (exceto `verify-hero.mjs`); o botão do Google segue a especificação do Google; o erro do post inexistente no blog é bug de rota (Lupa).
