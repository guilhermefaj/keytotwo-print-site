# Planos de animação — KeyToTwo (auditoria 2026-10)

Gerados pela skill improve-animations (filosofia de Emil Kowalski), commit `dacf7cd`, branch `design/refacao-2026-10`. Cada plano é autocontido: arquivo, linha, código atual, valor-alvo exato, passos, limites e verificação. Executor previsto: Nanquim. Revisor: Prumo.

| # | Plano | Severidade | Status | Depende de |
| --- | --- | --- | --- | --- |
| 001 | [Revelar o conteúdo da seção, nunca a seção inteira](001-reveal-no-conteudo-nao-na-secao.md) | HIGH | TODO | — |
| 002 | [Tirar o lift de hover dos cards de jogo não clicáveis](002-hover-sem-lift-em-cards-nao-clicaveis.md) | MEDIUM | TODO | — |
| 003 | [Encurtar o menu móvel e limitar o hover da seta a ponteiro fino](003-menu-movel-e-hover-de-seta.md) | LOW | TODO | — |
| 004 | [Caminhada do Kito sem teleporte no resize + QA das regras](004-caminhada-do-kito-sem-teleporte-no-resize.md) | LOW | TODO | — |
| 005 | [Entradas de UI mais curtas, com tokens de duração](005-entradas-de-ui-mais-curtas-e-tokens.md) | LOW | TODO | 001 (mesmo arquivo `navigation.css`) |

## Ordem recomendada

1. **001** primeiro: é o que o responsável notou ("blocos quase transparentes durante a rolagem", "faixas grandes de fundo vazio").
2. **002** e **003** juntos, na fatia de cabeçalho/home.
3. **005** depois de 001 (os dois editam `src/navigation.css`; aplicar em sequência evita conflito).
4. **004** isolado, na fatia da hero, com o QA completo das regras da caminhada.

Se a direção visual escolhida (relatório, seção 5) remover ou reorganizar seções, refaça a verificação do 001 e do 002 na nova estrutura; o princípio continua: movimento só no conteúdo e só onde há ação.

## Achados vetados (não viram plano)

- **Saída do painel/menu com `ease-in reverse`** (`src/navigation.css:97,99`): a regra "ease-in em UI é sempre achado" não se aplica. Com `animation-direction: reverse`, a curva também é invertida pela especificação, e a saída começa rápida. Está correto; abertura 280 ms e saída 180 ms já são assimétricas.
- **Pressão dos botões** (`scale(.98)` em 160 ms, `src/navigation.css:89-90`): correta.
- **Header que some ao rolar** (200 ms `--ease-out`, `src/navigation.css:12,114`): correto e respeita movimento reduzido.
- **Celebração da compra** (`kito-hello` 800 ms, confete 1 100 ms, `src/purchase.css:62-63`): momento raro; pode ter delícia. Mantido.
- **Caminhada em passos de 100 ms** (`steps()` na posição e na pose): decisão registrada no prompt da hero ("Atualize posição e frame no mesmo passo de tempo"). Não é achado.
- **Carrossel**: `scrollBy` suave só sem movimento reduzido; Home/End instantâneos (`src/components/ui/SnapCarousel.tsx:28,34`). Correto.

## Oportunidades perdidas (aditivas, sem plano por enquanto)

- **Dúvidas (`<details>`)**: abrir e fechar é instantâneo. Melhoria progressiva possível: `interpolate-size: allow-keywords` + transição de `height` do `::details-content` em 200 ms `var(--ease-out)`, só sob `prefers-reduced-motion: no-preference`. Ganho pequeno; fazer só se sobrar tempo.
- **Troca "Consultando preço…" → preço** (`src/components/sections/OfferSection.tsx:22`): o valor aparece de uma vez, com mudança de altura do texto. Um cruzamento de opacidade de 150 ms evitaria o salto; depende de resolver antes o achado P1-5 (erro de preço tipografado como preço).
- Adicionar ao carrinho já abre o drawer (`src/components/account/ShopProvider.tsx:26`): o feedback espacial existe; nada a acrescentar.
