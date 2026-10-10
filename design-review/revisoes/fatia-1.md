# Revisão da fatia 1 — tokens e tipografia (Prumo, 2026-10-10)

**Veredito: APROVADA COM AJUSTES.** A fatia entrega o que prometia: tokens únicos, fim da cascata em quatro gerações, botões sem cápsula, sem sombra e sem seta, nenhuma caixa alta, e o plano 005 aplicado. Ela quebrou uma coisa visível (o logo do rodapé) e as capturas "depois" de cinco telas não valem como comparação. Os três ajustes obrigatórios abaixo podem entrar no próximo commit do Nanquim.

| | |
| --- | --- |
| Commits revisados | `86b82cf` (DESIGN.md + `.impeccable/design.json`) e `286e90b` (tokens e tipografia) |
| Antes / depois | http://127.0.0.1:5178 / http://127.0.0.1:5180 |
| Critérios | [checklist](../2026-10-checklist-fatias.md) (seções G e F1), [auditoria](../2026-10-auditoria.md), [Portão 1](../2026-10-portao-1.md), `DESIGN.md` |
| Contagem (achados tocados) | **RESOLVIDO 5 · PARCIAL 5 · ABERTO 2** · 1 regressão · 1 falha de verificação |
| Evidências | [`fatia-1/`](fatia-1/), em WebP; [`fatia-1/home-375-antes-depois.webp`](fatia-1/home-375-antes-depois.webp) dá a visão geral do celular |

## Ajustes obrigatórios

1. **Logo do rodapé com a largura natural da imagem (regressão).** A consolidação apagou a regra genérica `.brand img { width: 178px }` e as variações de 150 e 132 px (`6079b0f:src/styles.css:32,116,136`); só sobrou `.site-header .brand img`. O logo do rodapé passou de 178×41 para **420×97 px** a 1280, de 178 para 328 px a 768 e de 150×35 para **335×77 px** a 375. Aparece em todas as páginas.
   - **Correção:** `.footer-brand img { width: 178px; height: auto; }`, com 150 px abaixo de 768 px.
   - **Evidência:** [`fatia-1/rodape-1280-logo-antes-depois.webp`](fatia-1/rodape-1280-logo-antes-depois.webp), [`fatia-1/rodape-375-logo-antes-depois.webp`](fatia-1/rodape-375-logo-antes-depois.webp).
2. **Capturas "depois" de carrinho, Meus jogos, Pedidos, Conta e da oferta da home mostram erro.** A API local (`127.0.0.1:54321/functions/v1/api/*`) responde **403** para a origem 5180: `catalog`, `account`, `cart`, `library` e `free-game`. Por isso as capturas commitadas em `286e90b` comparam sucesso (antes) com erro (depois).
   - O que aparece nelas: "Tentar novamente" em vez da biblioteca; "Não conseguimos carregar o preço." e "Adicionar ao carrinho" desabilitado na home.
   - O `verificacao.json` registra `"errors": []`, porque não olha o status das respostas da API.
   - **Correção:** refazer essas capturas com dados reais e incluir no `verificacao.json` os status ≥ 400 da API (critério G8). No momento desta revisão havia capturas dessa pasta modificadas e não commitadas, o que sugere que o Nanquim já está refazendo.
3. **Escala tipográfica incompleta.** O objetivo da fatia era "tokens únicos", mas há **35 declarações de `font-size` com 16 valores literais** fora dos tokens: `1.5rem` ×7, `.9375rem` ×6, `1.25rem` ×4, `1.75rem` ×3, `1.625rem` ×3, `.6875rem` ×3, `1.875rem`, `2.125rem`, `2.25rem`, `2.625rem`, `3.25rem` e quatro `clamp()`. Em execução, o site usa 17 tamanhos (antes, 28); oito ficam fora da escala do DESIGN.md: 11, 15, 24, 26, 28, 32, 34 e 38,4 px.
   - **Correção:** mapear para os tokens ou acrescentar ao DESIGN.md (frontmatter e `:root`) os degraus que faltam. O `--text-small` (15 px) já existe no CSS e é citado no texto do DESIGN.md ("Body 15–16 px"), mas não está no frontmatter.

## Achados tocados pela fatia

| Achado | Status | Evidência medida | O que falta (critério) |
| --- | --- | --- | --- |
| **P1-6** `.button-secondary` sem estilo | RESOLVIDO | Gaveta com falha simulada do carrinho, botão "Tentar novamente". **Antes:** fundo e borda transparentes, raio 999 px, 54 px de altura. **Depois:** Papel, borda Tinta, raio 6 px, 50 px de altura. | — Nota: a borda de 1,5 px é desenhada com 1 px em tela 1× (valor computado) |
| **P1-7** Cascata | RESOLVIDO | **Passos da home depois de `/carrinho`:** antes 38 → **28 px**; depois 38 → **38 px**, borda Tinta. **Título da newsletter do rodapé:** antes 14 px em DM Sans; depois **38,4 px em Bricolage** (o parágrafo tem 16 px). [`fatia-1/home-1280-rodape-newsletter-depois.webp`](fatia-1/home-1280-rodape-newsletter-depois.webp) | — |
| **P2-3** Cápsula, sombra dura e "→" | RESOLVIDO | Em 18 vistas de página (11 rotas, a 1280 e 375 px): cápsulas 76 → **0**; sombra `0 3px 0` 32 → **0**; setas 24 → **0**. Nenhum "→" ou "←" sobra nos TSX; as setas do carrossel viraram SVG com `aria-hidden`. | O botão do Google continua em cápsula (999 px), que o DS proíbe: usar a forma retangular da diretriz do Google ou registrar a exceção (F5.4) |
| **P2-7** Barra lateral em avisos | RESOLVIDO | `/termos`: o aviso ganhou borda completa de 1,5 px em Tinta suave, raio de 10 px e nenhuma barra lateral. [`fatia-1/termos-375-antes-depois.webp`](fatia-1/termos-375-antes-depois.webp) | — |
| **A005** Entradas de UI e tokens | RESOLVIDO | `/meus-jogos` (logado, dados reais): de 0,4 s com escalonamento de 60 ms para **0,24 s com 40 ms**; o último card termina em 0,40 s. `purchase.css` e `portal.css` não têm mais 400 ms. Os tokens ficaram no `:root` de `styles.css`, não em `navigation.css` como o plano previa; aceito, porque os tokens agora estão centralizados | — |
| **P1-3** Página vira template | PARCIAL | **Feito:** caixa alta na home 14 → **0** elementos (0 no site inteiro); os H2 da home estão todos à esquerda (antes, dois centralizados); tamanhos de H2 unificados (antes 41–58 px, agora 52 px). **Continua:** 11 rótulos acima dos títulos, agora em 14 px, peso 600, Tinta suave; três seções seguidas de três colunas; pilares | F4.1 (decisão pendente sobre apagar os rótulos), F4.12 |
| **P1-5** Preço indisponível tipografado como preço | PARCIAL | **Feito:** o texto no lugar do preço foi de 34 px em Bricolage para **16 px em DM Sans, Tinta suave** (`data-state="pending"`). **Continua:** duas mensagens ("Não conseguimos carregar o preço." e "Não foi possível carregar ou salvar os dados. Tente novamente."), e "Consultar novamente" é link de texto, não botão secundário. [`antes`](fatia-1/home-375-preco-indisponivel-antes.webp) · [`depois`](fatia-1/home-375-preco-indisponivel-depois.webp) | F6.1, F6.2 |
| **P2-6** Header: "Ajuda" e área privada | PARCIAL | "Ajuda" agora tem 15 px, em Tinta, como os outros links (captura `entrar-1280` do próprio commit). O cabeçalho simplificado da Minha área veio na fatia 2 e fica para a revisão dela | F2.2, F2.3 |
| **P2-9** CSS em gerações, hex soltos, código morto | PARCIAL | **Feito:** quatro gerações viraram uma (`styles.css` passou de 623 para 554 linhas, com ordem documentada); hex soltos de 45 únicos para **11** (10 da cena e do botão do Google, mais `#d1e9e5` ×2); `--color-bright-teal` e as variáveis antigas saíram; nenhum `var()` aponta para token inexistente; `GamesSection.tsx` foi removido; em execução, a única cor fora da paleta B é `#d1e9e5`. **Continua:** 3 tokens sem uso (`--space-xs`, `--space-xl` e `--duration-reveal`, que o A001 vai usar); os 35 tamanhos literais (ajuste 3); `GameCover.tsx` ainda emite `game-cover-sky`, `-apricot` e `-teal`, que já não têm CSS | F1.1, F1.3, F4.3 |
| **P2-11 / A003** Menu lento e seta no toque | PARCIAL | **(b) Resolvido por remoção:** não há mais seta nem hover de seta. **(a) Aberto:** os links do menu ainda entram em 0,4 s, com atraso de 60 ms + 50 ms por item e 16 px de deslocamento. No 5180, já com a fatia 2, continua igual | F2.4 |
| **P0-2** Kito como capa de jogo | ABERTO | A capa perdeu os fundos tonais (agora Papel com borda tracejada embaixo), mas os 4 jogos sem prévia continuam com o Kito como capa na home e em Meus jogos. [`fatia-1/meus-jogos-1280-antes-depois.webp`](fatia-1/meus-jogos-1280-antes-depois.webp) | F4.3 |
| **P2-4 / A002** Carta não clicável que sobe no hover | ABERTO | A carta ganhou borda Turquesa J001, mas o hover continua `translateY(-4px) rotate(-.5deg)`, com a mesma matriz medida antes e depois | F4.5 |

Não tocados nesta fatia e ainda abertos, cada um com seu critério no checklist:
- **P1-4 / A001**, reveal (F4.6): medido igual ao antes. Depois de saltar para `#comprar`, cinco seções ficam com opacidade 0,00.
- **P1-2** (F2.1)
- **P1-8** (F5.1)
- **P1-9** (F4.10)
- **P1-10** (F4.8)
- **P2-1** (F4.4)
- **P2-2** (F4.2, F4.17)
- **P2-5** (F6.3, F6.4)
- **P2-8** (F3.10)
- **P2-10** (F4.9)
- **P0-1**, conforme reformulado pelo Portão 1 (F4.11)

## O que a fatia quebrou

- **Logo do rodapé** (ajuste 1). É a única regressão visível que encontrei.
- **Conferido sem quebra:**
  - axe sem violações a 1280 px em 11 rotas, antes e depois; as 4 privadas foram medidas com dados reais.
  - Sem rolagem horizontal a 375 e 1280 px; o Nanquim mediu de 320 a 1440.
  - Foco de 3 px Tinta em todo controle (o offset passou de 5 para 3 px, como no DS).
  - Display só no H1 da hero: 86,7 px a 1280 e 42 px a 375 (antes, 73 e 38 px). Os outros H1 ficaram todos em 52 px; antes variavam de 44 a 64 px.
  - Sem classe usada no TSX que tenha perdido o CSS, exceto os tons de capa citados em P2-9, que viraram Papel de propósito.
- **Não conclusivo:** o H1 da hero cresceu cerca de 14 px a 1280, dentro do token Display. Rodei `verify:hero` nas duas portas e ele falhou nas duas antes de terminar, em asserções antigas fora da hero: `#reembolso` no 5178 e `.mobile-sign-in` no 5180. A geometria colhida no 5180 está dentro dos limites (`footGroundDelta` 0,014 px; `sceneClearance` de 44 a 114 px). Mesmo assim, não atribuo esses números à fatia 1, porque nessa hora o 5180 já servia alterações não commitadas da fatia 3 (`HeroScene.tsx`, `home.tsx`, `styles.css`). Cobrar na fatia 3 (F3.5, que inclui consertar o script).

## Desvios da direção B

Nenhum bloqueia esta fatia; cada um tem critério nas próximas.

1. **A seção da prévia segue em fundo Tinta, com bolha de Marca-texto.** As regras são `.experience-section` e `.paper-composition::before { background: var(--color-highlight) }`, e o rótulo dela usa o Marca-texto como cor de texto. Isso contraria "Papel dominante abaixo da hero" (PT1) e "Marca-texto: nunca é fundo de bloco" (DS Colors). O comentário do CSS adia para a fatia 4. → F4.13
2. **Tracejado de recorte usado como divisória comum em 11 lugares:** rodapé, barra móvel, bloco da conta no menu, resumo da gaveta, vazio e "Sair" da Minha área, conectores das etapas do checkout, entradas e vazio do blog, citação do blog e base da capa. O DS reserva o tracejado para "aqui se corta" e a régua de Tinta para listas, painéis e rodapé. A direção B já anotava o risco "muitas linhas tracejadas cansam". → F5.9
3. **Linha de recorte também nas páginas privadas.** Na fatia 1 foi a borda tracejada do rodapé em todas as rotas; na fatia 2 ela virou `CutLine` com tesoura, inclusive em `/conta`, `/meus-jogos` e `/carrinho` (visível em [`fatia-1/conta-1280-antes-depois.webp`](fatia-1/conta-1280-antes-depois.webp)). O DS diz "não em páginas privadas". → F2.8
4. **Botão do Google em cápsula.** → F5.4
5. **Desabilitado por opacidade** em `.icon-button` (0,4) e nas setas do carrossel (0,35), em vez de aguada de Tinta com Tinta suave. → F6.6
6. **Texto de 11 px:** o `.tag-solid` (o DS pede Caption, 13 px, peso 600) e as etapas do checkout no celular (já era assim antes). → F5.10
7. **Pontos de quebra divergentes:** o DS lista 360, 480, 600, 767, 1050 e 1120 px; o CSS ainda usa 359, 640, 700, 760, 960 e 1000 px. Alinhar no DS ou no código (P2, sem critério bloqueante).

## DESIGN.md (`86b82cf`) contra o Portão 1

**Conforme o Portão 1:**
- Paleta e papéis de cada cor, com o Turquesa J001 só em linhas e o Céu só na hero.
- Bricolage 700 + DM Sans 400/600, sem a fonte pixel enquanto não houver licença.
- Hero à esquerda, com marca-texto em "encontro.".
- Tesoura entre seções, marcas de corte, folha de cartas e ficha com pontilhado.
- Capas tipográficas.
- Kito: no máximo uma vez na home, nos vazios e na celebração; pose neutra do próprio atlas, sem imagem nova.
- Minha área simplificada e "um nome por ação".
- Relatos `placeholder: true` só em `test`.
- Regra de catálogo, que atende "o sistema precisa aceitar mais produtos".

**Lacunas a completar, sem bloquear:**
- (a) O lugar do freebie só aparece como "etiqueta por recortar" e "Kito anfitrião"; falta definir onde fica e que componente é (F4.14).
- (b) A newsletter do post depois do artigo está no Portão 1, mas não no DS (F5.1).
- (c) A escala do frontmatter não cobre os tamanhos usados, e falta `small` (ajuste 3).
- (d) Os pontos de quebra divergem do código (desvio 7).

## Ambiente e método

- **Mudanças durante a revisão:** chegou o commit `67c66c5` (fatia 2), e depois o 5180 passou a servir trabalho não commitado da fatia 3. Medi a execução entre 19:15 e 19:18, quando o HEAD passou de `286e90b` para `67c66c5`. O que depende de código conferi no próprio commit (`git show 286e90b:…`). A fatia 2 só mexeu em cabeçalho, rodapé e `CutLine`, e nenhuma medida usada acima depende disso, exceto onde está indicado (menu e rodapé).
- **Ferramentas:** Playwright com axe (`@axe-core/playwright` do projeto). Medi estilos computados, varredura de cores e tamanhos, Tab, hover, salto por âncora e falhas simuladas de catálogo e carrinho com `page.route`. Para ver dados reais no 5180, reapresentei só as leituras GET com origem 5178, no navegador de teste: as escritas ficaram bloqueadas, nada foi pago e nada foi gravado no banco.
- Os scripts e as capturas brutas ficaram no scratchpad do Prumo; aqui estão só as evidências em WebP.
- **web-design-guidelines** aplicada aos arquivos da fatia. Nada novo além do que já está acima: os itens de toque, foco, `aria-live` do carrossel, reticências e algarismos tabulares estão corretos ou já cobertos pelo checklist.
