---
name: KeyToTwo
description: Jogos para casais imprimirem e jogarem juntos. Direção visual "Folha de recorte" (aprovada em 2026-10-10; mais sóbria desde 2026-10-24).
colors:
  paper: "#FFFFFF"
  ink: "#123A3D"
  ink-soft: "#345B5D"
  deep-teal: "#006970"
  deep-teal-hover: "#00565D"
  deep-teal-active: "#00454B"
  line: "#1BB8C4"
  highlight: "#FFB866"
  sky: "#ECFAF7"
  error: "#993518"
  ink-wash: "rgb(18 58 61 / 0.06)"
  ink-rule: "rgb(18 58 61 / 0.18)"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "clamp(2.625rem, 1.5rem + 4.9vw, 5.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  display-mobile:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "2.625rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  display-xs:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "clamp(2.125rem, 1.5rem + 2.6vw, 3.25rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline-sm:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title-lg:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title-sm:
    fontFamily: "Bricolage Grotesque, Arial, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  caption:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: "DM Sans, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  section: "clamp(48px, 7vw, 88px)"
components:
  button-primary:
    backgroundColor: "{colors.deep-teal}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.deep-teal-hover}"
  button-primary-active:
    backgroundColor: "{colors.deep-teal-active}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "12px 22px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.ink-wash}"
  seal:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card-face:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "14px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
    height: "48px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "10px 12px"
    height: "44px"
---

# Design System: KeyToTwo

## Overview

**Creative North Star: "Folha de recorte"**

O que o casal compra é papel. A hero mostra um casal à mesa com as folhas (desde 2026-10-24, responsável: o site estava lúdico demais para a persona): a foto na hero inteira, com uma vinheta preta, o texto em Papel por cima e o Kito, menor, andando no pé da hero. Dali em diante a página é a própria folha impressa do jogo: Papel branco dominante, cards de fio fino de Tinta, réguas contínuas e um traço de marca-texto Damasco atrás de uma palavra. Nada brilha, nada flutua: a página parece ter saído da impressora e estar pronta para a tesoura.

A hero vende a marca e uma forma de pensar (sair do automático, fazer algo juntos), não um produto específico. A folha abaixo vende o catálogo: hoje a Coleção KeyToTwo: Fundadores, amanhã outros pacotes e um freebie. Por isso o sistema é feito de cartas, fichas e folhas que aceitam qualquer quantidade de itens. O tom é adulto, divertido e direto; o acabamento é o de um objeto gráfico bem impresso, não o de um app.

Anti-referências: landing de template (kickers em caixa alta sobre títulos de seção, três colunas centralizadas, pílulas com seta), sombra dura de arcade, cápsula em todo controle, Kito como ícone repetido, capa fictícia para jogo sem prévia.

**Key Characteristics:**

- Papel dominante abaixo da hero; a foto com vinheta existe só na primeira dobra.
- Uma assinatura: linha de recorte tracejada com tesoura antes do rodapé (depois da hero até 2026-10-24).
- A Turquesa J001 é só a linha de recorte; o texto é sempre Tinta ou Turquesa profundo.
- Tipografia à esquerda, com um marca-texto por página, no máximo.
- Controles planos, retos (6 px), sem sombra; só painéis que saem da folha (menu, gaveta) ganham sombra.
- Kito age: brinca na hero, acolhe em vazios, celebra a compra. Nunca decora.
- Pronto para mais produtos: cartas, fichas e oferta vêm de dados, não de "5" ou "P001" desenhados.

## Colors

Uma folha branca com tinta verde-azulada escura, linhas de corte turquesa e um único marca-texto.

### Primary

- **Turquesa profundo** (`{colors.deep-teal}`): toda ação. Fundo do botão primário, cor de links e botões de texto, traço da tesoura. Hover `{colors.deep-teal-hover}`, pressionado `{colors.deep-teal-active}`. Sobre Papel dá 6,45:1; Papel sobre ele, 6,45:1.
- **Tinta** (`{colors.ink}`): texto corrido, títulos, borda do botão secundário, contorno de foco. 12,37:1 sobre Papel, 11,53:1 sobre Céu.

### Secondary

- **Turquesa J001** (`{colors.line}`): **só linhas decorativas**: a linha de recorte com a tesoura antes do rodapé (The One Cut Rule; desde 2026-10-24, a única; cards, selos e réguas passaram ao fio de Tinta, e os e-mails são a exceção, em E-mails). Dá 2,41:1 sobre Papel, por isso nunca é texto, nem borda única de um controle (input, botão), nem ícone que precise ser lido.
- **Marca-texto** (`{colors.highlight}`): um traço atrás de uma palavra em Tinta (7,24:1), como caneta marca-texto. Aparece uma vez por página, na hero ("encontro."). Nunca é fundo de bloco, de seção ou de botão. Exceções: o selo "Preço de lançamento", o código do cupom na barrinha (texto em Marca-texto sobre Tinta) e o arco atrás das páginas dos gratuitos em "A próxima rodada sai da impressora", com topo em meia-volta e pé reto (responsável, 2026-10-21: o arco usa o amarelo da marca, não uma cor própria). As folhas passam dos lados e do pé dele.

### Neutral

- **Papel** (`{colors.paper}`): fundo de toda a página abaixo da hero, de cards, inputs e do botão secundário.
- **Céu** (`{colors.sky}`): hover do botão claro da hero e selos claros do admin. Desde 2026-10-24 não é mais o fundo da hero nem do cabeçalho.
- **Tinta suave** (`{colors.ink-soft}`): texto secundário (legendas, ajuda de campo, meta de pedidos). 7,50:1 sobre Papel.
- **Aguada de tinta** (`{colors.ink-wash}`): superfície de hover e de desabilitado, Tinta a 6 %. Substitui qualquer cinza ou tom de céu em hover.
- **Régua de tinta** (`{colors.ink-rule}`): divisórias sólidas de 1 px em listas, tabelas e rodapé, e o fio dos cards (Tinta a 18 %). Entre seções vale só a linha de recorte, no lugar da The One Cut Rule.
- **Erro** (`{colors.error}`): mensagens de erro e borda de campo inválido. 7,30:1 sobre Papel.

O chão do rodapé tem a própria paleta de cena (terra `#684839`, grama `#77A85B` / `#ACD475` / `#3F7957`, sulco `#A16C4E`), confinada ao bloco `.footer-ground`. Esses valores não saem dali. Desde 2026-10-24 a hero não tem mais paisagem (nuvens, mato e grama).

**Preto na hero (2026-10-24, pedido do responsável).** A vinheta da foto da hero, a sombra do Kito sobre ela e a sombra do texto usam preto em transparência (`rgb(0 0 0 / …)`), fora da paleta. Só ali.

### Cor do jogo

Cada jogo tem uma cor tirada da paleta do próprio PDF (`accent` em `src/content/games.ts`): Rabisque e Adivinhe rosa `#E06D86`, Tabuleiro da Sorte ouro `#F2B33C`, O Sumiço de Rapadura laranja-terra `#D9772E`, A Rota da Fornalha laranja `#D4600F`, Retrospectiva a Dois terracota `#B5562B`, Hora dos Artistas vermelho-tinta `#C94050`, Pote de Planos âmbar `#E39A2D`. Ela chega ao CSS como `--game-accent`, posta pelo `GameCover`. O pacote não tem cor própria.

Onde aparece: só no fundo da capa tipográfica (jogo ainda sem arte), misturado a 14 % no Papel, e nas faixas dos passos de "Como funciona". **Desde 2026-10-23 a capa oficial não ganha faixa colorida** nos cards, na vitrine, na biblioteca, na galeria do produto nem na lista do pacote: as capas novas (fotos das folhas impressas) já carregam a identidade de cada jogo, e a faixa deixava os cards infantis (responsável).

**The Accent-Is-Paper Rule.** A cor do jogo é superfície e linha, como a tinta da capa impressa. Nunca é texto, ícone, borda única de controle nem fundo de botão.

### Named Rules

**The Line-Not-Text Rule.** A Turquesa J001 nunca carrega significado sozinha: é a linha de corte. Tudo o que precisa ser lido ou acionado é Tinta ou Turquesa profundo.

**The One Highlight Rule.** Há um marca-texto por página, atrás de uma palavra ou duas. Um segundo traço vira decoração.

**The Photo Stays Up Rule.** A foto com vinheta termina no pé da hero. Abaixo dela a página é Papel; hover e estados usam aguada de Tinta.

## Typography

**Display Font:** Bricolage Grotesque 700 (com Arial, sans-serif)
**Body Font:** DM Sans 400/600 (com Arial, sans-serif)

**Character:** títulos largos, pesados e apertados como o nome de um jogo impresso na carta; corpo neutro e legível como as instruções da folha. Só os dois pesos de DM Sans e o 700 de Bricolage são carregados (subset latin, `@fontsource`, importados em `src/app.css`; o `root.tsx` só pré-carrega dois arquivos). A fonte pixel do PDF do J001 não entra enquanto não houver licença web confirmada.

### Hierarchy

- **Display** (700, `{typography.display}`, entrelinha 1, tracking −0,04em): só o H1 da hero. No celular usa `{typography.display-mobile}` (42 px) e, em 320 px, `{typography.display-xs}` (36 px). Nunca em outra seção.
- **Headline** (700, `{typography.headline}`, 1,05, −0,03em): H2 de cada folha e H1 das páginas internas, alinhado à esquerda, largura máxima de 18ch, `text-wrap: balance`. Regra de nível: H2 de **seção** (uma folha do Início, como Grátis ou Dúvidas) é Headline; H2 de **bloco** dentro de uma página que já tem H1 (Loja, produto) é Headline small.
- **Headline small** (700, `{typography.headline-sm}`, 1,12): preço real na oferta, título do menu móvel e dos vazios, H2 da lista do blog, links do menu móvel.
- **Title large** (700, `{typography.title-lg}`, 1,2): H2 de cards e painéis (conta, carrinho, pagamento, gaveta), saudação da área privada, subtotal.
- **Title** (700, `{typography.title}` e `{typography.title-sm}`, 1,15–1,2, −0,02em): nome do jogo na carta (22 px), H3 de legendas, de blocos e de itens de lista (19 px).
- **Lead** (400, `{typography.lead}`, 1,55): apoio da hero, primeira frase de uma folha, total a pagar; largura máxima 560 px.
- **Body** (400, `{typography.body}`, 1,6): texto corrido; medida de 60–70ch.
- **Small** (400, `{typography.small}`, 1,5): links de navegação, abas, texto de cards e fichas.
- **Label** (600, `{typography.label}`, caixa normal, sem tracking): botões, selos, nomes de campo, meta em negrito. Caixa alta só existe num lugar: o jeito de jogar dos cards (`.shop-game-kind`, `.pack-game-kind`: Caption 600, maiúsculas, tracking .06em, Tinta suave), que classifica o jogo, não anuncia a seção.
- **Caption** (400, `{typography.caption}`, 1,5, Tinta suave): legendas de figura, ajuda de campo, meta de pedido, rodapé legal.
- **Micro** (600, `{typography.micro}`): selo "No pacote", contagem do carrinho e etapas da compra no celular. Único tamanho abaixo de 13 px; nunca em texto corrido.

Toda `font-size` do CSS referencia um destes tokens (`--text-*`); não há valores literais fora da escala.

Números (preço, contagem, data) usam `font-variant-numeric: tabular-nums`. O preço é Headline em Bricolage apenas quando é um preço real; qualquer texto no lugar do preço ("Preço em breve", erro) é Body em Tinta suave.

### Named Rules

**The Heading Carries Itself Rule.** Não há rótulo, kicker ou eyebrow acima de um título de seção ou de página. O jeito de jogar sobre o nome do jogo, nos cards, é a única exceção: classifica o item, não anuncia a seção. A hero também não tem etiqueta: "KeyToTwo · jogos para casais" saiu em 2026-10-22, a pedido do responsável (poluía o topo).

**The Print Tracking Rule.** O tracking negativo para em −0,04em no Display e em −0,02em nos títulos pequenos; o corpo não leva tracking.

## Layout

A página é uma pilha de folhas. Cada seção é uma folha de Papel com `padding-block: {spacing.section}`. A **linha de recorte** (2 px tracejada Turquesa J001, largura total, com a tesoura encostada na margem esquerda do contêiner) corta a página **num lugar só**: antes do rodapé (desde 2026-10-24, responsável; antes cortava também depois da hero). Seções do mesmo assunto (prévia, como funciona, relatos; dúvidas, blog, fechamento) separam-se só por espaço. A tesoura nunca aparece dentro de uma seção.

Contêiner de conteúdo: `min(1140px, 100% − 80px)` no desktop, `100% − 48px` até 1050 px, `100% − 40px` até 767 px. O cabeçalho usa `min(1280px, 100% − 64px)`. A hero ocupa a largura total: o texto fica no contêiner e a foto vai até a borda direita da janela.

Grade: 12 colunas com divisões assimétricas. Título e apoio à esquerda em 7/12 (ou 1,2fr/0,8fr), card ou objeto à direita. A grade de cards de jogo tem até 3 colunas (mínimo 300 px); a vitrine do Início põe os jogos numa linha a partir de 1024 px e vira carrossel com snap abaixo disso.

Ritmo vertical em múltiplos de 8: `{spacing.sm}` entre rótulo e campo, `{spacing.md}` entre parágrafos, `{spacing.lg}` entre grupos, `{spacing.xl}` entre título e conteúdo, `{spacing.2xl}` entre blocos de uma folha, `{spacing.section}` entre folhas. Mais espaço acima de um título do que abaixo.

No celular tudo empilha: título, apoio, ação. Na página do produto e no card do pacote, **a capa vem antes do preço**: a pessoa vê o que compra antes de decidir.

Pontos de quebra principais: 360, 600, 768, 960, 1024 e 1050 px (e 1120, 70rem, no cabeçalho); há alguns locais (380, 640, 700, 720, 760, 900, 1000, 1200) para ajustes de um componente só. Sem rolagem horizontal de 320 a 1440 px com texto a 200 %.

### Named Rules

**The One Cut Rule.** A tesoura corta a página num lugar só: antes do rodapé, em todas as páginas menos o pagamento (modo foco). Desde 2026-10-24 a hero passa para a folha de Papel sem corte. Seções do mesmo assunto separam-se só por espaço; nunca há tesoura dentro de uma seção.

## Elevation & Depth

Quase sem sombras na folha. Desde 2026-10-24 (responsável, para um visual menos lúdico) cards e cartas são planos, com o fio de 1 px em Tinta a 18 % (`--line-card`, igual a `--line-card-quiet`) e `{rounded.md}`; as réguas são contínuas (`--line-rule`); o tracejado ficou só na linha de recorte com a tesoura. A exceção são as cartas soltas de "Como funciona", que trocam a borda por uma sombra curta (`--shadow-card`). Inputs têm borda de 1,5 px; nada ganha sombra no hover.

Só o que **sai da folha** flutua: a gaveta do carrinho, o menu móvel e o menu da conta são painéis sobre a página e carregam uma sombra suave com deslocamento. O cabeçalho fixo ganha a sombra de cabeçalho apenas quando já rolou e está sobre conteúdo.

### Shadow Vocabulary

- **Painel** (`box-shadow: -12px 0 48px rgb(18 58 61 / 0.12)`): gaveta do carrinho e menu móvel (Sheet).
- **Menu** (`box-shadow: 0 12px 40px rgb(18 58 61 / 0.16)`): popover da conta no cabeçalho.
- **Cabeçalho** (`box-shadow: 0 8px 24px rgb(18 58 61 / 0.08)`): cabeçalho fixo em estado rolado.

### Named Rules

**The Flat Sheet Rule.** O que está impresso na folha não tem sombra. Só painéis que cobrem a folha têm.

**The One Edge Rule.** Um elemento declara sua borda uma vez: fio, sombra ou nenhuma. Borda mais sombra é proibido; barra lateral colorida também.

## Shapes

Cantos discretos, como papel cortado com cuidado: `{rounded.sm}` (6 px) em botões, inputs e selos; `{rounded.md}` (10 px) em todo card (jogo, pacote, conta, sacola, pagamento), miniaturas, avisos e popovers. `{rounded.lg}` (14 px) sobrou só em pontos do admin e no link da vitrine. Não existem cápsulas (999 px) em botões, links ou abas; círculos só no avatar com inicial, no número de etapa, na foto dos relatos (48 px) e no botão flutuante de compartilhar (52 px).

A linguagem de forma é a da folha impressa: retângulos de fio fino, a linha de recorte com a tesoura de dois círculos e duas lâminas (antes do rodapé), e o traço de marca-texto que ocupa de 58 % a 92 % da altura da linha atrás da palavra.

A cena do Kito é a exceção pixel: bordas em degrau, `image-rendering: pixelated`, nenhum raio.

## Icons

Todos os ícones de interface vêm da Tabler (`@tabler/icons-react`, versão exata no `package.json`), sempre em importação nomeada; o carrinho é uma sacola (`IconShoppingBag`).

- **Família:** outline. Sem variantes `Filled`.
- **Traço:** 1,75 (`stroke`); cor sempre `currentColor` — Tinta ou Turquesa profundo conforme o controle. A Turquesa J001 nunca aparece em ícone que precise ser lido (regra existente).
- **Tamanhos:** 20 px em controles e navegação (menu, chevrons do carrossel, gatilho da conta usa 16 px); 24 px na sacola, no fechar do painel, na tesoura e na lista "O que vocês precisam"; 16 px em selos inline ("Compra segura", "Pagamento seguro") e na etapa concluída da compra; 32 px só para ilustrar as cartas de "Como funciona", nunca em controle.
- **Acessibilidade:** todo ícone é decorativo (`aria-hidden`) e o rótulo fica no controle — `aria-label` no botão/link ou texto visível ao lado.
- **No código:** `<Icon component={IconShoppingBag} size={24} />` a partir de `src/components/ui/Icon.tsx`, que fixa os padrões (traço 1,75, `aria-hidden`, `currentColor`). Sem SVG inline para ícone, sem `import *` e sem o pacote `@tabler/icons` (SVG cru) — há regra de lint para as duas últimas.

## Components

### Buttons

- **Shape:** retângulo de cantos discretos (`{rounded.sm}`), altura mínima 48 px (44 px no cabeçalho), padding `12px 22px`, Label 600, sem ícone de seta, sem sombra.
- **Primary:** Papel sobre Turquesa profundo; hover `{colors.deep-teal-hover}`; pressionado `{colors.deep-teal-active}` com `transform: scale(.98)` em 160 ms; desabilitado em aguada de Tinta com texto Tinta suave e `cursor: not-allowed`.
- **Secondary:** Papel com borda de 1,5 px Tinta e texto Tinta; hover em aguada de Tinta; mesma altura e raio. É o botão de "Tentar novamente", "Atualizar status", "Sair da conta", cupom e voltar.
- **Link de recorte** (`.inline-link` e os links das páginas legais): Turquesa profundo 600 com sublinhado **pontilhado** de 1 px (`text-underline-offset: 5px`; até 2026-10-24, tracejado de 1,5 px, que o responsável achou lúdico). Todo link de texto usa este desenho, inclusive "Ver detalhes" nos cards. No hover e no foco o pontilhado fica e um traço de marca-texto passa por trás do corpo das letras (23–81 % de cada linha, abaixo do pontilhado), da esquerda para a direita em 240 ms; com movimento reduzido, aparece sem transição. O traço é um SVG na cor Marca-texto, com pontas em bisel e mais carregado nas pontas (82 % no meio), e o texto escurece para Turquesa ativo (`{colors.deep-teal-active}`, 5,5:1 sobre o traço; o Turquesa profundo ficaria em 3,8:1). O link tem só a largura do texto: "Ver detalhes" ganha o alvo de 44 px pelo padding, nunca por flex com altura mínima, para o traço acompanhar a palavra e a linha (responsável, 2026-10-19). Usado para "Ver detalhes", "Remover", "Precisa de ajuda?" e "Guia de impressão" (responsável, 2026-10-18).
- **Focus:** `outline: 3px solid {colors.ink}; outline-offset: 3px` em todo controle, em qualquer fundo (na hero, sobre a foto com vinheta, o contorno é Papel).
- **Rótulos:** um nome por ação em todo o site: "Ver os jogos" leva à Loja; "Adicionar à sacola" compra; "Ver detalhes" abre a página do produto; "Finalizar compra" paga.

### Tags (etiqueta e selo)

- **Etiqueta**: não existe mais acima de títulos. "Grátis" (Início e Loja), "Gratuitos" e "Comunidade" saíram em 2026-10-24 (responsável): repetiam o título (The Heading Carries Itself Rule).
- **Selo** (`.tag-solid`): fio de 1 px em Tinta a 18 %, texto em Tinta, Micro 600 (Caption no rodapé do card), padding `2px 8px`, `{rounded.sm}`. Só para um estado dentro da carta ("No pacote", no rodapé do card de jogo; o selo da capa tipográfica). "Preço de lançamento" é o outro selo, em Marca-texto (Banner do pacote).
- **Lista do que vem** (`.shop-includes`, "O que está incluído" no card de compra e no banner do pacote): cada linha com um check de 18 px em Turquesa profundo, alinhada à esquerda (2026-10-24).
- **Jeito de entrar** (`.auth-methods`, em Entrar): "Código por e-mail" e "E-mail e senha" lado a lado, metade da largura cada, num trilho de fio fino; o escolhido em lavado de Tinta e 700 (2026-10-24; no celular, antes, um ficava embaixo do outro).

### Cards / Containers

- **Capa de jogo** (`.game-cover`): face 16:9 de Papel, fio de 1 px em Tinta a 18 % (`--line-card-quiet`), `{rounded.md}`. Duas faces: **arte oficial** (a capa aprovada do jogo, `cover` em `src/content/games.ts`, gerada por `scripts/prepare-game-covers.mjs`, em `object-fit: cover`) e **tipográfica** (nome do jogo em Title 22 px, sem imagem), padrão de qualquer jogo sem capa. Desde 2026-10-23 as capas oficiais são fotos das folhas impressas em leque, sobre verde-água; como mostram páginas dos jogos pagos, vão ao site **no máximo a 800 px** (a folha do meio fica com uns 240 px: dá para ver, não dá para usar o jogo). Fora isso, nenhuma página do PDF vai para o site (decisão do responsável, 2026-10-16): quem abrisse a imagem em outra aba baixaria o jogo sem comprar.
- **Card de produto** (`.shop-game`, Loja e página do pacote; mais sóbrio desde 2026-10-23, a pedido do responsável, que achava os cards lúdicos e infantis): o quadro é o card (fio de 1 px em Tinta a 18 %, `{rounded.md}`, que escurece para Tinta a 42 % no hover e com foco dentro), com a capa no topo sem borda própria (a imagem aproximada a 118 % dentro dela desde 2026-10-24, para a folha ganhar presença sem mais pixels), separada do corpo por uma régua de Tinta; abaixo, na cabeça (`.shop-game-head`), o jeito de jogar da ficha em Caption 600 maiúsculo com espaçamento (`.shop-game-kind`, só na Loja; na página do pacote a ficha inteira vem embaixo), H3 Title, resumo em Tinta suave e, no rodapé alinhado entre os cards da linha, preço + botão primário "Adicionar à sacola" + "Ver detalhes", ou um dos estados abaixo. Sem faixa de cor sob a capa. A grade tem até 3 colunas (mínimo 300 px). Na Loja, o último card é o pacote (`PackCard`: capa do pacote, "Pacote de jogos", nome, chamada, preço de lançamento e compra), que fecha a linha que os 5 jogos deixavam aberta (2026-10-24). **No celular (abaixo de 600 px)** o card fica horizontal: a capa (42 %, com fio e `{rounded.sm}`) ao lado da cabeça, e o resumo e a compra na largura toda embaixo. Vaga de jogo indefinido do pacote não vira card.
  - **Estados do rodapé:** _à venda_ (preço, "Adicionar à sacola", "Ver detalhes"); _no pacote_ (selo "No pacote" e o link "Ver o pacote", quando o jogo não tem avulso mas está num pacote à venda); _grátis_ (seção Grátis); _em breve_ (selo de fio fino, só para o que não se compra de jeito nenhum); _indisponível no momento_ (o mesmo selo, para o produto lançado que saiu do catálogo, pausado no admin; 2026-10-24). Um jogo do pacote nunca aparece como "Em breve".
  - **Variante incluído** (`GameGrid variant="included"`, página do pacote): capa, nome, resumo e a ficha do jogo (`facts`), com "Ver detalhes" só se houver página do avulso. Sem preço e sem compra avulsa dentro da oferta do pacote.
- **Grátis** (`.shop-freebies`, Loja e Início): atalho para a página Gratuitos. Os jogos `freebie` de `src/content/games.ts` (Hora dos Artistas e Pote de Planos), fora do pacote. Título, texto de `experience.freebie` e o botão "Ver os gratuitos" à esquerda, os cards à direita (empilha abaixo de 960 px). No rodapé do card, o selo "Grátis" e o link "Como baixar" para a página Gratuitos, como o estado "No pacote" (2026-10-24; antes, "Grátis" em letra de preço); baixar é só lá. Na página Gratuitos, antes de liberar, o card mostra só o selo. Aparece em todos os stages. Na biblioteca (Portal) a mesma capa vai dentro do card do jogo, também 16:9.
- **Página Gratuitos** (`/gratuitos`, responsável 2026-10-20): título e a troca lado a lado (empilham abaixo de 960 px), os cards e o convite da comunidade.
  - **Como baixar** (`.free-access`, card de fio fino): três passos numerados e um quarto na voz do Kito (2026-10-24, responsável: o convite das redes estava escondido no pé da página), com o Kito parado de 48 px à esquerda e os links do Instagram e do TikTok embaixo ("Ah, e o último passo… Não esqueçam de me seguir nas redes e de me marcar nas próximas aventuras de vocês."); fica à vista antes e depois de liberar. Depois, o aviso em destaque de que os gratuitos são liberados para quem aceita os e-mails (LGPD, art. 9º, § 3º), com o link para Privacidade. A ação muda com a conta: "Criar conta ou entrar" (volta para `/gratuitos`), "Aceitar e liberar os jogos" (`source: free_games`) ou "Os jogos estão liberados na sua conta". Voz de nível 1 ("você").
  - **Cards:** "Grátis" enquanto a conta não desbloqueou; depois, PDF com o tamanho e "Baixar PDF". Desbloqueou uma vez, baixa para sempre, mesmo saindo da lista.
  - **Meus jogos:** liberados, os gratuitos entram na mesma grade, depois dos comprados, com "Gratuito" no lugar dos pacotes e "Liberado na sua conta." no pé (o mesmo lugar da data de entrada, para os botões alinharem). Sem liberação, uma linha leva a `/gratuitos`.
  - **Comunidade** (`.free-community`, card com o Kito pixel de frente): só o que é verdade hoje, ideias ouvidas e temas em votação. A comunidade é o Instagram, o TikTok e os e-mails. O botão primário "Seguir @keytotwo no Instagram" e o secundário "Seguir @keytotwo no TikTok" abrem o perfil (no celular, no app); seguir é um toque a mais, porque nenhum dos dois oferece seguir com um clique a partir de outro site.
- **Card de conta, sacola e pagamento** (`.account-card`, `.payment-card`, `.cart-summary`): Papel, fio de 1 px em Tinta a 18 % (`--line-card`), `{rounded.md}`, padding 32 px (24 px no celular), sem sombra. Dentro dele: nome, conteúdo, preço, ação.
- **Item de compra** (carrinho, gaveta, pagamento): miniatura 16:9 de 96–128 px de largura com a capa do produto (`thumbnail` em `src/content/products.ts`) ou, sem imagem, a capa tipográfica com o título; ao lado, nome, chamada (`tagline`) e preço, e, no pagamento, as linhas de entrega (`delivery`). A pessoa vê o que compra em cada passo. Nunca o Kito como enfeite.
  - **Preço riscado (2026-10-22, responsável; referência: Steam):** ninguém paga duas vezes pelo mesmo jogo. O avulso que já vem num pacote da sacola e o produto que a pessoa já tem mostram o preço de tabela riscado em Tinta suave e "não é cobrado", com uma linha que explica por quê ("Já vem no pacote … da sua sacola." ou "Você já tem este jogo no Portal.", com "Ver no Portal"). O pacote com jogos que a pessoa já tem mostra o preço de tabela riscado e o valor que falta ("completar a coleção"). O riscado é sempre real; nunca um "de/por" de vitrine. No pagamento só aparece o que entra no pedido.
  - **Sacola sem login:** a sacola funciona antes de entrar (guardada no navegador); "Finalizar compra" leva ao Entrar, que diz "Sua sacola fica guardada. Entre ou crie sua conta para pagar." Na página do produto, quem já tem o jogo vê "Já está no seu Portal" (botão secundário para Meus jogos) no lugar de "Adicionar à sacola".
- **Aviso** (`.notice`, no admin): Papel, borda 1,5 px Tinta suave, `{rounded.md}`, padding 16–20 px, sem barra lateral.

### Linha de recorte (`.cut-line`)

Elemento decorativo (`aria-hidden`) de 40 px de altura entre duas folhas: linha tracejada 2 px Turquesa J001 de borda a borda da janela e a tesoura (ícone Tabler `IconScissors`, 24 px, traço 1,75 Turquesa profundo) sobre um retângulo de Papel na margem esquerda do contêiner. Usa-se em dois cortes: hero → folha dos jogos e antes do rodapé (todo rodapé menos o do pagamento). Não dentro de uma folha, não entre seções do mesmo assunto.

### Banner do pacote (`.shop-bundle`, Loja e Início)

Card com o mesmo fio de Tinta dos cards de jogo (`{rounded.md}`). À esquerda, a capa grande do pacote e, sob ela, os jogos: o nome em Body 600 e, à direita, o jeito de jogar em Caption 600 maiúsculo Tinta suave (`.pack-game-name`, `.pack-game-kind`), separados por régua de Tinta. Sem miniatura desde 2026-10-24: a de 88 px não se lia. À direita, "Pacote de jogos", o nome do pacote, o que vem, o preço e a compra. No celular, a capa abre; depois nome, preço e compra; por fim os jogos.

**Preço de lançamento** (`offer.listPrice`, 2026-10-23): o P001 passou a 5 jogos com preço de tabela de R$ 39,90 e fica por R$ 29,90 no lançamento. Sobre o preço, o rótulo "Preço de lançamento" em Caption 700 Tinta sobre Marca-texto (`.shop-price-tag`); no preço, o de tabela riscado a 62 % do tamanho, em Tinta suave, antes do cobrado (`.shop-price-list`); o leitor de tela ouve "De R$ 39,90 por R$ 29,90". Só aparece em real e se o de tabela for maior que o cobrado pela Stripe. Acabou a promoção: o preço vai a R$ 39,90 na Stripe e o `listPrice` sai.

### Barrinha de cupom (`.promo-bar`)

Faixa acima do cabeçalho (2026-10-23), em Tinta com texto em Papel, Label centralizado: "Primeira compra? Usem o cupom **PRIMEIRA10** no pagamento e ganhem 10% de desconto.", com o código em Marca-texto 700 (7,6:1 sobre a Tinta). Rola com a página; o cabeçalho continua grudado no topo. Fica fora do Portal (Meus jogos, Pedidos e Conta), que não tem estímulo comercial. Desde 2026-10-24 o texto sai do admin (Cupons e parceiros): é a faixa do cupom ativo que começou por último, com `{cupom}` no lugar do código; o build a traz no retrato do catálogo (`promoBanner`) e o `/catalog` confirma na hora; sem cupom com faixa, ela some. Quem chegou pelo link de um parceiro vê, no mesmo lugar e no mesmo estilo, "Indicação de {nome}: {N}% de desconto no pagamento, com o cupom **{CÓDIGO}**", e o código entra sozinho no pagamento ("Cupom {CÓDIGO} aplicado (indicação de {nome})."). É a única promoção do site: o teste de conteúdo continua recusando "desconto" e "promoção" no resto das páginas.

### Vitrine do Início (`.cover-carousel`)

Depois do banner do pacote, uma fileira de capas clicáveis (`.cover-tile`), uma por jogo do pacote (os 5 desde 2026-10-24; antes, os três primeiros): capa, nome em Title Small, resumo em Tinta suave e o preço do avulso em Label 600 Turquesa profundo (ou "No pacote" quando o /catalog não lista o avulso; vazio enquanto carrega). O card inteiro é um link para a página do jogo; no hover a capa sobe 2 px (só com ponteiro fino e sem movimento reduzido) e o nome sublinha. Sem botão de compra: a compra mora no banner, na Loja e no produto. Todos numa linha a partir de 1024 px; carrossel com snap abaixo disso (três capas e um pedaço da próxima no tablet; 78 % no celular).

### Do blog no Início (`.home-posts`)

Até 3 posts em colunas: imagem 3:2, data, título sublinhado e resumo. Com um post só (2026-10-24), imagem e texto lado a lado, com o título em Headline Small, para a seção não ficar com dois terços vazios; no celular, empilham.

### Página de produto (`/loja/:slug`)

Ordem fixa, com dados de `src/content/games.ts` e `products.ts`:

1. **Voltar** ("Loja"), H1 com o nome e a chamada.
2. **Ficha no topo** (`.product-facts`, só no avulso): os fatos genéricos do jogo (pessoas, jeito de jogar, o que está em jogo, formato), sem contar páginas, cartas ou peças, lado a lado, cada um com o rótulo em Caption Tinta suave e o valor em 600, separados por régua de Tinta e com régua em cima e embaixo (até 2026-10-23, tracejadas); duas colunas no celular.
3. **Galeria e compra**: à esquerda a galeria (`ProductGallery`), à direita o card "O que está incluído" com preço e compra, e nada embaixo do botão (a entrega e o reembolso ficam no fim, item 7). A galeria abre na capa (16:9, no fio de Tinta dos cards, sem faixa de cor) e troca pelas miniaturas (botões que dividem a largura da galeria, todos numa linha, `aria-pressed`, a escolhida com borda de 2 px Turquesa profundo). Só capas oficiais: no avulso, a capa do jogo sozinha (sem miniaturas); no pacote, a capa dele e as de cada jogo.
4. **Como é jogar** (só no avulso): a descrição do jogo e três momentos da experiência do casal (`moments`: título e uma frase), em cartas separadas por régua de Tinta, sem números. Fala do que a dupla vive (conversa, risada, desafio, mistério), nunca das regras, das soluções ou do conteúdo das páginas.
5. **Jogos do pacote** (só no pacote): a grade na variante "incluído", com a ficha de cada jogo em duas colunas, o campo em Caption Tinta suave em cima e o valor em Small 600 embaixo (`.shop-game-facts`; até 2026-10-24, com pontilhado entre os dois, que quebrava mal).
6. **O que vocês precisam** (`needs`): ícone Tabler de 24 px em Turquesa profundo e o rótulo de `needLabels`, com régua de Tinta. No pacote, a lista junta o que todos os jogos pedem.
7. **Entrega e reembolso** (`delivery` e `refundNotice`): como o PDF chega, que dá para baixar de novo e o aviso de reembolso com o link da política, em parágrafos de Tinta suave. Fica no fim da descrição desde 2026-10-24: o responsável não quer regra de negócio colada no botão de compra. Na sacola, o mesmo aviso fica no pé da página (`.cart-legal`), fora do resumo; o aceite que vale continua no pagamento.
8. **Também está no pacote** (só no avulso que faz parte de um pacote à venda): card no fio de Tinta com o argumento real, "todos num só pedido", a lista dos jogos com o jeito de jogar (como no banner do pacote) e "Ver o pacote". Nunca compara preços nem anuncia economia.

### Ajuda (`/ajuda`)

Central de ajuda em página de leitura. Logo abaixo do H1, quatro cards de tema (`.help-topics`, fio fino de Tinta, ícone Tabler de 24 px em Turquesa profundo, título em Title small e uma linha em Tinta suave) que levam às seções: Antes de comprar, Conta e acesso aos jogos, Impressão e preparação e Atendimento. O texto vem de `src/content/help.ts` e só traz fatos conferidos.

- **Guia de impressão** (`.print-guide`): dicas gerais (papel A4, tamanho real, uma face, recorte, guardar) em lista com ícone, num card de fio fino com réguas entre as dicas. Depois, "O que cada jogo pede": o nome do jogo e os itens de `needs`, com régua entre os jogos (sem miniatura desde 2026-10-24). Nenhuma página do PDF ilustra o guia, e nenhuma dica promete um resultado de impressão que não foi testado.
- **Atendimento** (`.support-card`): o e-mail `contato@keytotwo.com.br` em Title Turquesa profundo, selecionável, com link `mailto:` e o botão secundário "Copiar e-mail" (o `mailto:` pode não abrir em todo aparelho). A confirmação da cópia sai em `role="status"`.

### E-mails (Auth e transacionais)

O mesmo visual em `supabase/templates/*.html` (código de acesso, confirmação e senha) e em `supabase/functions/_shared/email.ts` (entrega, presente, lembrete de sacola, pós-compra): Papel, um card de 520 px com borda 2 px Turquesa J001 (os e-mails ficam com o visual de antes de 2026-10-24: são outra mídia, com estilo inline em tabela), faixa de Céu no topo com "KeyToTwo" e "jogos para casais", a linha de recorte tracejada logo abaixo, título em 24 px, botão em Turquesa profundo e um rodapé com a assinatura e o e-mail de atendimento. A assinatura é a frase do Kito ("Um pinguim numa tela pedindo para vocês saírem dela.", a mesma do rodapé do site) no lembrete de sacola e no pós-compra; nos e-mails de serviço é "KeyToTwo: jogos para casais imprimirem em casa.". O código de acesso aparece num recorte tracejado. Tudo em estilo inline e tabela, com Arial: fonte web e imagem de logo não são confiáveis em e-mail.

### Como funciona (`.print-sheet`)

Cartas soltas sobre o Papel da seção (responsável, 2026-10-18; mais sóbrias desde 2026-10-24): os três passos são cartas sem borda, com sombra curta (`--shadow-card`), `{rounded.md}`, uma faixa de 4 px no topo na cor de um jogo do pacote e uma inclinação de até 1°, como peça recortada. Sem calhas tracejadas nem tesoura entre elas. Cada carta tem o número da etapa ("01", "02", "03", em Bricolage 700 Label Tinta suave; decorativo, a ordem vem do `<ol>`) e o ícone Tabler de 32 px em Turquesa profundo na mesma linha (sacola, impressora, carta de baralho), o título em Title e o texto em Small Tinta suave. No pé, só o link "Guia de impressão" para a Ajuda. Sem marcas de corte nos cantos. Movimento: quando a folha aparece, as três cartas estão empilhadas no lugar da do meio, cada uma num ângulo, como um baralho ("Escolham." por cima); depois de um instante são distribuídas, a primeira para a esquerda e a terceira para a direita (720 ms, com um leve passo além do lugar), Com movimento reduzido, já distribuídas (responsável, 2026-10-18).

### Relatos (`.social-marquee`)

A partir de 4 relatos, uma faixa de borda a borda desliza devagar e sem parar (9 s por relato, `linear`), com as pontas esmaecidas por máscara. A lista vai duas vezes para fechar o laço em -50%; a cópia é `aria-hidden` e `inert`. Cursor, foco (a faixa recebe foco) e toque param o movimento. Com `prefers-reduced-motion`, vira uma fileira parada que rola à mão, com encaixe e sem a cópia. Com menos de 4, o carrossel com encaixe de sempre (`.social-carousel`). Cada card tem as cinco estrelas da nota do casal (marca-texto com contorno de Tinta, nota em texto para leitores de tela), o relato e, no rodapé, a foto do casal em círculo de 48 px. Sem foto autorizada entra a silhueta de dupla sobre um de quatro fundos claros da paleta. Nunca rosto de banco de imagem.

(Pedido do responsável em 2026-10-18; substitui a regra antiga de relatos sem estrelas.)

### Marca-texto (`mark`)

`background: linear-gradient(transparent 58%, {colors.highlight} 58% 92%, transparent 92%)`, `color: inherit`, `padding: 0 .04em`. Uma vez por página.

### Inputs / Fields

- **Style:** Papel, borda 1,5 px Tinta suave (`{colors.ink-soft}`, 7,5:1), `{rounded.sm}`, altura 48 px, padding `12px 14px`, Body; rótulo acima em Label 600 com `{spacing.sm}` de distância; ajuda em Caption.
- **Focus:** mesmo contorno de 3 px Tinta com offset 2 px; a borda não muda de cor.
- **Error:** borda `{colors.error}` e mensagem em Caption 600 na mesma cor, com `role="alert"`; a mensagem nomeia o problema e a saída.
- **Disabled:** aguada de Tinta de fundo, texto Tinta suave.
- **Checkbox:** 22 px, `accent-color: {colors.deep-teal}`, rótulo clicável com alvo ≥ 44 px.

### Navigation

- **Cabeçalho:** Papel em todas as páginas; no topo da Início, sem sombra, separado da foto da hero; rolado, Papel a 94 % com desfoque de 12 px e a sombra de cabeçalho. Logotipo à esquerda: o nome "KeyToTwo" em Bricolage Grotesque 700, a fonte dos títulos (`.wordmark`, em px como um logo, sem crescer com o texto: 26 px; 24 px no celular, 21 px na tela estreita; 32 px no rodapé, 28 px no celular), desde 2026-10-24 no lugar do desenho (responsável: muito infantil); `public/media/brand/keytotwo-wordmark.png` é a mesma marca para o JSON-LD, links ao centro, ações à direita. Links em Body 15 px Tinta, padding `10px 12px`, alvo de 44 px. **Toques de pixel (2026-10-16), só CSS:** no hover o texto vai a Turquesa profundo e, sob ele, uma barra de blocos de pixel (4 px de altura, blocos de 2 pixels com 1 de vão, só blocos inteiros) se desenha em 4 passos, em Turquesa J001 (linha decorativa); o link ativo fica com a barra cheia em Turquesa profundo e Label 600. O logo dá um pulinho de 3 px em passos e acende uma estrela de 4 pontas em grade 7×7, como as das capas. A sacola pula do mesmo jeito; a contagem é um selo com cantos em degrau. O CTA ganha cantos em degrau no hover (o fundo fica num `::before`, para o contorno de foco não ser recortado). Com movimento reduzido nada anima; só cor e barra mudam. Nada disso vale para o menu da conta nem para o menu móvel. "Portal" tem o mesmo peso dos outros links. O CTA compacto é o botão primário de 44 px.
- **Portal** (`/meus-jogos`, `/pedidos`, `/conta`; antes "Minha área", renomeado em 2026-10-21): no desktop o cabeçalho fica com logo, Portal e a conta, porque as abas já levam a Meus jogos, Pedidos e Minha conta; o menu móvel mantém os três links. Sem CTA comercial nem carrinho. A saudação traz o Kito acenando ao lado do nome.
- **Navegação pública:** Início, Loja, Gratuitos e Blog (somente quando há posts no stage do build). Loja fica ativa em `/loja` e seus detalhes, sem scroll-spy. À direita ficam Portal e a conta para quem entrou, ou só Entrar para quem não entrou, e a sacola, com rótulo acessível "Sacola, N itens". A Ajuda saiu do cabeçalho do desktop (responsável, 2026-10-21) e fica no rodapé e no menu móvel. Não há botão "Ver os jogos" no cabeçalho nem no menu móvel (decisão do responsável, 2026-10-20): a Loja já está na navegação. O menu móvel mantém a mesma ordem. No rodapé, Explorar oferece Início, Loja, Como funciona (`/#como-funciona`) e Gratuitos, além de Blog quando houver posts; não há link para a antiga oferta. Sob a frase da marca ficam os links do Instagram e do TikTok (@keytotwo, ícone + nome da rede, abrem em nova aba).
- **Modo foco** (`/pagamento`): logo, "Compra segura" com cadeado e "Voltar à sacola" (rota `/carrinho`). O rodapé encolhe para a linha legal (©, Termos, Privacidade, Ajuda).
- **Newsletter:** não há formulário no site (o que ficava escondido desde 2026-10-16 saiu em 2026-10-24; volta pelo histórico do git quando existir o envio). A preferência de e-mail em Minha conta continua.
- **Voltar** (`BackLink`, `.back-link`): chevron Tabler à esquerda (20 px) e o destino em Label 600 Turquesa profundo; sublinha no hover. Um desenho só no produto ("Loja"), na Ajuda e nas páginas legais ("Voltar ao início") e no post ("Voltar ao blog").
- **Abre e fecha** (`Summary`, `<details>`): o marcador do navegador some; o chevron Tabler (`IconChevronDown`, 20 px, Turquesa profundo) gira 180° em 240 ms quando abre. No FAQ o chevron vai à direita da linha; nos detalhes curtos (sacola, pedidos) ele vem logo depois do texto.
- **Menu móvel (Sheet):** painel de Papel de até 480 px com a sombra de painel; links em Headline reduzida (Bricolage 700, 28 px) separados por régua de Tinta; entrada de 240 ms com 40 ms de escalonamento e 8 px de deslocamento; Escape fecha e devolve o foco.
- **Admin** (admin.keytotwo.com.br, `admin/`, 2026-10-23; antes era o `/painel` da loja, que agora redireciona): só para admin (`app_metadata.admin`), pelo link "Painel" no menu da conta e no menu móvel da loja. App à parte, com os mesmos tokens (`src/tokens.css`) e sem cor nova.
  - **Portão:** folha de Papel com Borda de card sobre Céu, o logotipo em texto e selo "Admin". Entrar com Google (botão secundário com o G) ou código por e-mail (não cria conta). Depois, o segundo fator: na primeira vez, o QR code do app autenticador (com a chave para digitar); nas sessões seguintes, só o código de 6 números. Quem não é admin vê a recusa com o link para a loja.
  - **Estrutura:** barra lateral sóbria de 240 px em Papel com uma divisória (nome "KeyToTwo" em texto com "Admin" ao lado, seções, e-mail, "Ver a loja" e Sair); no celular vira faixa no topo, com as seções numa linha que rola de lado. Itens em Tinta suave; o ativo num lavado de Tinta, em 600, com o ícone em Turquesa profundo. Sem logo ilustrado, selo tracejado ou contorno na barra. Ordem (revisão de usabilidade, 2026-10-24): Métricas e Atenção (o número de alertas abertos num selo de Erro sobre Papel à direita do item), as operações da loja (Pedidos e reembolsos, Catálogo, Usuários) e o Blog por último; o grupo "Em breve" saiu na Fase 3. No celular, a seção aberta rola para dentro da faixa. Avisos, formulários de ação e confirmações têm uma borda só, o fio (o de perigo, em Erro), sem barra lateral colorida; as ações de uma seção ficam numa linha. Favicon próprio: um K branco num quadrado de Tinta (`admin/public/favicon.svg`), para a aba não se confundir com a da loja (o Kito).
  - **Seletor de opções** (`.periods`: períodos, filtros, abas Escrever/Prévia): borda de régua sobre Papel; o ativo num lavado de Tinta, sem contorno Turquesa.
  - **Métricas:** 7 ou 30 dias (botões com `aria-pressed`): cartões de Borda de card com o número em Bricolage, receita por dia em barras Turquesa J001 (dia a dia numa tabela em `<details>`), funil em barras Turquesa profundo sobre aguada de Tinta. No fim, "Uso da infraestrutura" (2026-10-25): três medidores com a forma do funil (chamadas às funções, tamanho do banco e contas que entraram no mês, cada um com "x% do limite" do plano grátis; de 80% em diante, "perto de acabar"), as chamadas por dia nas mesmas barras da receita, a tabela por tipo e a hora mais movimentada das últimas 24 horas. As tabelas da página usam a `.data-table`.
  - **Blog** (2026-10-23; o `/admin` da loja, antigo Sveltia CMS, leva para cá): lista em linhas com régua (título, endereço, selo Rascunho em lavado de Tinta ou Publicado em Céu com Turquesa profundo, data, autor, última edição, o link para o post no site e a lixeira, que abre a confirmação na própria linha, com borda de Erro), filtros Todos/Publicados/Rascunhos e uma linha de estado do site (ponto Turquesa profundo: em dia; ponto Marca-texto: atualizando). O editor tem o título grande, os dados do post numa folha de régua em 3 colunas (endereço com o prefixo `/blog/`, autor, data, resumo com contador, temas separados por vírgula e a capa com miniatura e descrição) e o texto em Markdown (fonte monoespaçada do sistema, barra de atalhos e os botões Galeria e Imagem; arrastar uma imagem deixa o campo tracejado em Turquesa profundo sobre Céu; colar uma imagem também envia) com a prévia ao lado, desenhada com as classes do blog da loja (`src/blog.css`). Abaixo de 1200 px, texto e prévia viram abas. Os botões ficam numa barra presa ao pé da tela (no celular, no fim do formulário): Salvar rascunho e Publicar, ou, num publicado, Voltar para rascunho e Salvar e atualizar o site. Erros num resumo no topo, com links para os campos, e abaixo de cada campo, em Erro. Excluir fica no fim, com confirmação na própria página; sair com mudanças pergunta antes. Depois de salvar algo que muda o site, a linha de estado do site aparece abaixo do aviso e acompanha até o post estar no ar. A galeria (Galeria no texto, Escolher da galeria na capa) é um diálogo modal em Papel sobre um véu de Tinta: título, busca pelo nome, contagem e uma grade de miniaturas 4:3 com o nome do arquivo e a data; no celular, duas colunas. Embaixo de cada miniatura, onde ela é usada ("Neste post", "Em uso em “…”", em Tinta suave) ou, se nenhum post usa, Apagar em Erro, que abre a confirmação no próprio cartão (lavado de Tinta com borda de Erro, Apagar e Cancelar dividindo a largura).
  - **Editor do texto** (2026-10-23): editor visual (TipTap, guarda Markdown) com a cara do blog do site (`blog-prose`). Na barra, subtítulo, subtítulo menor, negrito, itálico, link, listas, citação, divisória, desfazer e refazer: o botão ligado fica em lavado de Tinta com um traço Turquesa profundo embaixo; Galeria, Imagem e Markdown (o texto cru) à direita. Link e descrição da imagem selecionada abrem numa barra fina logo abaixo (Papel, borda à esquerda Turquesa profundo). Editor e Prévia abrem e fecham pelos botões do título Texto (pelo menos um fica aberto); lado a lado no desktop, um embaixo do outro no celular, onde a prévia começa fechada. Google e compartilhamento: um bloco recolhível com o título e a descrição do Google (o título e o resumo como dica), contadores e a prévia do resultado da busca (endereço em Tinta suave, título em Turquesa profundo, descrição em Tinta suave).
  - **Usuários** (2026-10-23, Fase 4): lista em linhas com régua (e-mail, como entra e a data da conta; selos Admin em Céu, Bloqueada em Erro sobre Papel, Sem confirmação em lavado de Tinta; último acesso, compras, jogos e novidades), busca com a lupa e os filtros Todas/Com compra/Nas novidades/Bloqueadas (no celular, quebram em duas linhas) e as páginas Anterior/Próxima. A ficha tem o e-mail como título e seções separadas por régua: Conta (fatos em colunas e o link para o cliente na Stripe), Jogos (cada direito com a origem, "Pedido …" ou "Presente", e o selo Com acesso ou Retirado), Pedidos (estado, valor ou R$ 0 do presente e Reenviar o e-mail), Novidades, E-mails (tabela que rola de lado no celular) e Histórico do admin. As ações abrem no lugar do botão um formulário em Papel com borda à esquerda (Turquesa profundo; Erro quando tira ou apaga), um aviso do que acontece, o motivo (obrigatório, vai para o histórico) e Confirmar/Cancelar. Dados e acesso fica no fim: Exportar os dados, Bloquear ou Desbloquear o login e Excluir a conta (digitando o e-mail). Na própria conta e na de outro admin, as ações que trancam não aparecem e uma nota diz por quê.
  - **Catálogo** (2026-10-24): lista dos produtos em linhas com régua (nome, código, pacote ou avulso, pedidos pagos e quem tem; selo À venda em Céu, Pausado e Rascunho em lavado de Tinta, "Falta algo para vender" em Erro; o preço à direita, com o riscado menor antes), o aviso de "loja em dia" e a tabela dos jogos com a versão do PDF. A ficha segue a do pedido: Preço (na loja, riscado e o link do Price na Stripe, com "Trocar o preço" e o riscado como ações com motivo), Jogos do pacote (a ordem, "Tirar do pacote" e "Pôr um jogo no pacote" com o presente para quem já tem marcado), o PDF do avulso, o histórico e, na zona de perigo, Pausar a venda ou Voltar a vender.
  - **Atenção** (2026-10-24): Abertos e Resolvidos nos últimos 30 dias, em linhas com régua: o título ("Contestação no pedido <código>"), o que fazer, quando abriu (ou como fechou) e os links Ver o pedido, Ver a conta e Abrir na Stripe. Os que se resolvem à mão têm "Marcar como resolvido" (ação com motivo); os do sistema, o selo "Fecha sozinho". Sem nada aberto, o vazio de borda tracejada. Nas Métricas, um aviso com o link "<n> alertas precisam de atenção" quando há algum.
  - **Pedidos e reembolsos** (2026-10-24, Fase 3): lista em linhas com régua ("Pedido <código>", e-mail e data, itens e cupom; selo Pago em Céu, Reembolsado e Contestado em Erro sobre Papel, os demais em lavado de Tinta; valor à direita), busca pelo código ou pelo e-mail e os filtros no seletor de opções, 50 por página. A ficha segue a da conta (seções com régua, `Section`/`Fact` em `admin/src/Detail.tsx`): Valores (subtotal, desconto com o cupom, total, pago, reembolsado, termos aceitos, links do pagamento e do cliente na Stripe), Itens, Jogos liberados (com os downloads depois do pagamento), Linha do tempo, E-mails e Histórico do admin. Em Ações: reenviar o acesso, "Conferir com a Stripe" (pedido aberto aqui) e "Reembolsar <valor>", ação de perigo que diz o que acontece, pede o motivo e o código do pedido digitado; o botão só liga com o código certo.
  - **Usuários: abas, equipe e acompanhamento** (2026-10-23): abas Contas | Acompanhamento | Equipe sob o título, como as do Portal (sublinhado de 3 px Turquesa profundo na ativa; no celular rolam de lado). Acompanhamento: quatro cartões de resumo em Papel com o número em Bricolage (cada um leva à sua lista) e as listas Sacola esquecida, Comprou e não baixou, Entrega com problema e Conta sem confirmação, cada pessoa com o motivo, o que fazer em Tinta suave e, quando cabe, Reenviar o e-mail de acesso. Equipe: os admins em linhas com régua (selo Você na própria conta; Remover admin nas outras) e Adicionar à equipe pelo e-mail. O presente marca um ou mais jogos em caixas de marcar (Turquesa profundo).
- **Compartilhar no blog** (2026-10-24, pedido do responsável): atalho em ícones (`.icon-button` de 44 px: WhatsApp, Copiar o link e, no aparelho que tem, Mais opções), precedido de "Compartilhar" em Label Tinta suave, em cada post da lista e sob os temas no topo do post; o aviso de copiado fica ao lado, em Tinta suave. Na leitura, um **botão flutuante** redondo de 52 px (Papel, borda 1,5 px Tinta, `--shadow-menu`) no canto de baixo à direita: aparece quando o atalho do topo sai por cima da tela e some quando o texto do post sai dela (no começo o atalho do topo basta). No aparelho com o compartilhar do sistema, abre direto o do sistema; nos outros, abre um painel acima dele com WhatsApp e Copiar o link (botões secundários), que fecha com Esc ou clique fora. Fica abaixo do aviso de cookies.
- **Fim do post no blog** (2026-10-23): Leia também (até 3 posts com tema em comum, em cartões com a capa 3:2, o título sublinhado e o resumo), separado por régua, antes do convite para a Loja.
- **Abas do Portal:** sublinhado de 3 px Turquesa profundo na aba ativa, texto Tinta suave nas demais, barra fixa sob o cabeçalho.
- **Aviso de cookies** (`CookieNotice`, responsável, 2026-10-22): um card de fio fino com a sombra de painel, fixo no canto inferior esquerdo (no celular, a largura toda, a 12 px das bordas), com o Kito comendo o cookie dele (`kito-cookie-187.webp`, de `scripts/prepare-kito-cookie.mjs`, mostrado na metade do tamanho e pixelado). Ele mastiga em 2 passos e solta migalhas de Marca-texto; com movimento reduzido, fica parado. O título fica no tom do Kito ("O Kito já pegou o cookie dele."), e o texto diz o que mede (Google Analytics), que não há anúncio e que só entra com o aceite, com o link para a Política de privacidade. "Aceitar" e "Recusar" têm o mesmo tamanho; "Cookies", na linha legal do rodapé, reabre o aviso. Aparece só no domínio real (build live) e no stage test, para revisão; no teste, aceitar não carrega nada.
- **Etapas da compra** (`.checkout-steps`): quatro passos (Sacola, Entrar, Pagamento, Pronto) para quem ainda não entrou; três, renumerados, para quem já entrou, sem uma etapa "Entrar" concluída fora de ordem. Somem na sacola vazia e nos erros da confirmação. Em Caption, número em círculo de 28 px com borda de régua; a etapa atual em Tinta 600 com o círculo em Turquesa profundo; concluída com o ícone de conferir (`IconCheck`, 16 px) em aguada de Tinta. Os números aqui são uma sequência real.

### Kito (uso do personagem)

- **Hero com foto (2026-10-24, responsável, a partir de uma referência dele):** a hero tem a altura da tela, entre 620 e 900 px (`clamp(620px, 100svh − 37px, 900px)`; 37 px é a barrinha do cupom). A foto (`foto-mesma-folha`, 640 e 1008 px em WebP, `object-fit: cover`) ocupa a hero inteira, abaixo do cabeçalho branco. Por cima, uma vinheta preta: uma elipse que escurece as bordas até 70 % e o lado do texto, de 70 % na borda esquerda a 56 % no fim da coluna (até 620 px, no contêiner), sumindo 360 px depois dela. O texto fica no meio da altura que sobra acima do Kito, em Papel com uma sombra preta leve; "encontro." fica em Marca-texto (cor do texto, sem o traço; 7+:1 sobre a vinheta). O botão "Ver os jogos" é Papel com texto em Tinta (hover em Céu) e "Como funciona" é Papel sublinhado (hover em Marca-texto). Até 1023 px o texto fica no meio da foto, e a vinheta escurece mais de cima para baixo (34 % a 56 %). A foto tem prioridade alta (é o maior elemento) e as folhas nela não dão para ler: nenhuma página do PDF vai para o site. O título da hero vai até 56 px no desktop (`clamp(2.625rem, 1rem + 2.6vw, 3.5rem)`), em duas linhas. Foram comparadas com o responsável capas claras, escuras, outras fotos e vinhetas em Tinta e em preto, fracas e fortes; ficou a preta média.
- **Hero (2026-10-18):** o único lugar onde o Kito se move, e ele interage com quem chega. Desde 2026-10-24 anda no pé da hero, por cima da foto, sem chão desenhado: a sombra em degraus, preta a 50 %, o ancora. Pixel art real em 256 px (`art-source/kito-pixel/`), servida num atlas WebP sem perda gerado por `scripts/prepare-kito-pixel.mjs` (posições em `src/kito-sprites.ts`, gerado; não editar à mão). Só os quadros virados para a direita entram; a esquerda é espelho no CSS. Tamanho: 128 px no desktop (×0,5, 1:1 em tela 2×) e 96 px no celular (desde 2026-10-24; antes 192 e 128); vizinho mais próximo quando a tela tem pixels de sobra, redução filtrada abaixo disso.
  - **Mouse:** o Kito persegue o cursor pelo chão. Caminha perto, corre a meia distância e dispara de longe; a cadência dos pés acompanha a velocidade. Vira de frente para trocar de lado, às vezes tropeça ao virar em sprint. Ao alcançar, pula ou acena; com o cursor em cima, acena enquanto o cursor estiver ali; clicado, saltita segurando o coração; com o cursor parado, cochila em pé, respirando, e acorda num susto quando o cursor se mexe. Cursor além da borda: empurra a borda.
  - **Botão "Ver os jogos":** com o cursor ou o foco do teclado no botão, o Kito corre até embaixo dele e aponta, com brilhos, enquanto o cursor estiver lá. No piloto automático ele também vai até o botão e aponta por um instante.
  - **Plataformas:** o botão e a palavra destacada ("encontro.") são plataformas. Solto em cima deles (ou com os pés um pouco abaixo da borda, sem arremesso), o Kito fica ali até alguém carregá-lo de volta: anda só em cima da plataforma e, no piloto automático, só faz ações paradas. Não há animação de descida (decisão do responsável em 2026-10-18).
  - **Piloto automático** (celular sempre; desktop com o cursor fora da hero): começa correndo e acenando e depois alterna um deslocamento (andar, correr, disparar e às vezes tropeçar, empurrar a borda, ir até o botão e apontar) com uma ação parada (pular, acenar, ser erguido por uma mão invisível, que é a dica de que dá para pegá-lo, saltitar com o coração, sentar), sem repetir seguido e com pausas curtas.
  - **Sem dado:** o dado que ficava no chão saiu em 2026-10-20 (decisão do responsável, por dar trabalho). Volta só se fizer sentido; a arte está no Drive (Dice.zip) e o motor antigo, no histórico do git.
  - **Tonto:** chacoalhar o Kito no colo (três trocas rápidas de sentido) ou arremessá-lo forte o deixa com estrelinhas girando, cambaleando, por quase dois segundos.
  - **Toque:** um toque na hero (fora de links e botões) leva o Kito até lá; tocar nele faz ele saltitar segurando o coração. Só o corpo dele segura a rolagem (`touch-action: none`); o resto da cena rola a página.
  - **Carregar:** pressionar e arrastar o Kito o leva para qualquer ponto da hero, por cima do texto, pendurado pelos pés soltos e balançando com a mão (quadros girados com RotSprite a partir do "erguido no ar"). Ao soltar ele cai com o impulso da mão: queda curta amortece, queda alta ou arremesso rola no chão. Uma sombra em degraus fica no chão e encolhe com a altura.
  - **Nuvens:** atravessam o céu em 150 a 300 s, cada uma num ritmo.
  - **Pausa:** fora de vista, aba oculta ou menu aberto congelam tudo, inclusive a interação. Não há botão de pausa (decisão do responsável em 2026-10-18); `prefers-reduced-motion` deixa o Kito parado, de frente, sem baixar o motor nem o atlas. O motor (`src/lib/kito-playground.ts`) só desce quando a cena roda pela primeira vez; o servidor entrega a pose de frente (3 KB).
- **Na home, fora da hero:** no máximo uma participação, parada, como anfitrião de um convite. Desde 2026-10-20 não há nenhuma: ao lado de "A próxima rodada sai da impressora" ficam três páginas dos jogos gratuitos (Hora dos Artistas e Pote de Planos) sobre o arco Marca-texto, uma sob a cúpula e duas na frente, passando só um pouco dele (o leque de 2026-10-21 escondia demais as páginas), sem legenda (responsável, 2026-10-21), numa imagem só gerada por `scripts/prepare-free-pages.mjs`, com 330 px por página na maior versão, pequena demais para imprimir. Dos jogos pagos, nenhuma página aparece no site. O aceno do rodapé é da moldura do site, não da home. Nunca como ícone de pilar. Na arte oficial das capas dos jogos ele é o protagonista (as capas são peças aprovadas, não enfeite).
- **Vazios** (carrinho, biblioteca, gaveta): Kito na caixa (`kito-caixa`, 240 px; 180 px no celular), com a entrada curta de 650 ms.
- **Celebração** (pagamento confirmado): Kito acenando (`kito-hi`) com o confete de 1,1 s. Único lugar de delícia longa.
- **Erro, falha de pagamento e 404:** o Kito tonto, com estrelinhas na cabeça (`.kito-dizzy`, responsável, 2026-10-22; substitui a pose neutra do atlas da hero). É uma tira de 9 quadros de `Kito.zip` (animação *wobbles*, de frente) gerada por `scripts/prepare-kito-tonto.mjs`, passada com `steps(9, jump-none)` em 1,1 s, 160 px de largura (128 px no celular), pixelada; com movimento reduzido, fica no primeiro quadro. Decorativo (`aria-hidden`).
- **Favicon:** o Kito em pixel art (`kito_favicon.png` do Drive), de frente e sorrindo, é o ícone do site: `favicon.ico` (16/32/48), `kito-192.png` e o ícone da tela inicial do iPhone sobre Céu. Gerados por `scripts/prepare-favicon.mjs`; não se edita à mão.
- **Área privada:** Kito acenando pequeno (56–64 px), ao lado do nome na saudação.
- **Rodapé:** o chão da hero volta como faixa de borda a borda (`.footer-ground`: grama, terra, um arbusto da cena) e o Kito sentado de frente na grama (`kito-pixel-sit`, 120 px de altura; 96 px no celular), que de vez em quando balança os pés uma ou duas vezes; com movimento reduzido, fica parado. Decorativo (`aria-hidden`). Desde 2026-10-24 entra em todas as páginas, com a linha de recorte em cima, fora o pagamento (modo foco).
- **Linha legal (todo rodapé, inclusive o do pagamento):** © KeyToTwo, uma marca da Chalk Labs · CNPJ, numa linha só e alinhada aos links legais; no celular o CNPJ desce para a linha de baixo. O e-mail de atendimento fica na Ajuda e nos textos jurídicos.

### Estados

- **Carregando:** esqueleto em aguada de Tinta com `role="status"` ("Carregando sua sacola"); preço em "Consultando o preço…" em Body Tinta suave, nunca em Display.
- **Vazio:** Kito na caixa + título Title + uma frase + o botão primário com o nome real da ação ("Ver os jogos").
- **Erro:** uma única mensagem em Body com `role="alert"`, em Tinta (não em cor de erro quando não há culpa da pessoa), seguida de **um** botão secundário "Tentar novamente". Sem título em Display, sem segunda mensagem genérica. Falha de pagamento e 404 usam o Kito tonto.
- **Desabilitado:** aguada de Tinta + Tinta suave; sempre com a razão em Caption ao lado quando não for óbvia.
- **Foco:** contorno de 3 px Tinta com offset em tudo que recebe foco, inclusive cartas com `tabindex`, abas e a trilha do carrossel.
- **Movimento reduzido:** nenhuma entrada, nenhum deslocamento, carrossel instantâneo e o Kito da hero parado de frente.

### Movimento (tokens)

- `--ease-out: cubic-bezier(.16, 1, .3, 1)` para toda entrada e hover; nada usa `ease-in` em UI.
- `--duration-press: 160ms` (pressão de botão, `scale(.98)`), `--duration-ui: 240ms` (entradas de UI: cards da biblioteca, bloco de pagamento, links do menu), `--duration-panel: 280ms` (abrir gaveta e menu; fechar em 180 ms), `--duration-reveal: 320ms` (reveal do conteúdo das folhas, 8 px), `--stagger: 40ms`.
- O reveal aplica-se ao **conteúdo** da folha (`.page-section > .content-width`), nunca ao fundo da seção.
- Hover com deslocamento só sob `(hover: hover) and (pointer: fine)` e sem movimento reduzido; cards não clicáveis não se movem.
- Momentos raros (celebração) podem passar de 300 ms; tudo o mais fica abaixo.

### Named Rules

**The Catalog Rule.** Nenhum componente desenha "5" ou "P001". Título, chamada, conteúdo e entrega da oferta vêm de `src/content/products.ts`; código, nome, resumo, capa, cor, fatos e momentos de cada carta vêm de `src/content/games.ts`. A grade de cards aceita de 1 a N jogos (colunas pela quantidade, quebrando em linhas novas), a capa tipográfica é o padrão de qualquer jogo sem capa oficial, e a oferta renderiza um card por produto do catálogo. Um freebie ou um segundo pacote entra sem CSS novo.

**The Kito Acts Rule.** Se o Kito não está caminhando, acolhendo, celebrando, convidando ou se despedindo, ele não está na tela.

## Do's and Don'ts

### Do:

- **Do** usar a linha de recorte e a tesoura só antes do rodapé.
- **Do** alinhar títulos e apoio à esquerda; usar o lado direito para ficha, preço ou objeto.
- **Do** usar a capa tipográfica (nome do jogo sobre a carta) para qualquer jogo sem capa oficial.
- **Do** manter botões retos (6 px), sem sombra, sem seta, com um nome por ação.
- **Do** escrever preço só com um preço real; qualquer substituto é Body em Tinta suave.
- **Do** dar a todo erro uma mensagem e um botão secundário de nova tentativa, e nada mais.
- **Do** rodar `tests/e2e/hero-kito.spec.ts` (perseguir, carregar, toque, movimento reduzido) após qualquer mudança na hero.
- **Do** medir contraste AA em cada estado novo antes de publicar.

### Don't:

- **Don't** usar rótulo, kicker ou caixa alta com tracking acima de um título de seção ou de página (o jeito de jogar nos cards é a única caixa alta).
- **Don't** usar Turquesa J001 em texto, ícone informativo ou borda única de controle.
- **Don't** usar Marca-texto fora da hero (exceções: o arco dos gratuitos, o selo "Preço de lançamento" e o código do cupom) nem preto fora da vinheta da hero, nem a paleta da paisagem fora do chão do rodapé (o marca-texto só atrás de uma palavra).
- **Don't** escrever texto na cor do jogo nem marcar um jogo do pacote como "Em breve".
- **Don't** usar cápsula (999 px), sombra dura (`0 3px 0`), borda lateral colorida ou card com borda mais sombra.
- **Don't** colocar o Kito como ícone ou em erro com expressão triste. A exceção é a arte oficial das capas.
- **Don't** publicar página do PDF como imagem, em lugar nenhum: nem capa, nem miniatura, nem galeria, nem seção da home. O arquivo também não fica em `public/`.
- **Don't** animar fundo de seção, mover card não clicável no hover ou passar de 300 ms em UI (exceto a celebração).
- **Don't** apresentar um jogo ainda indefinido com arte, capa ou descrição que ele não tem.
