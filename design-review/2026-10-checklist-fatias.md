# Checklist de aceite das fatias — direção B "Folha de recorte" (2026-10)

Autor: Prumo (auditor). Executor das fatias: Nanquim. Uso: cada fatia só fecha com todos os critérios dela em **RESOLVIDO**, ou com o desvio aceito por escrito pelo orquestrador.

**Hierarquia das fontes**, da mais forte para a mais fraca:
1. Decisões do responsável no [Portão 1](2026-10-portao-1.md), que prevalecem sobre o relatório e sobre o prompt da hero.
2. [`DESIGN.md`](../DESIGN.md) (commit 86b82cf).
3. Achados da [auditoria](2026-10-auditoria.md) (P0/P1/P2).
4. [Planos de animação](animacoes/README.md).

Duas decisões do Portão 1 mudaram a cobrança em relação à auditoria:
- **P1-1:** a hero vende a marca, não o produto. O `site.heroDescription` com "5 jogos" **não** entra; vale só a parte visual (sem ✓, sem caixa alta, CTA unificado).
- **P0-1:** os relatos de placeholder foram pedidos pelo responsável e só aparecem no stage `test`. Na fatia 4, a cobrança deixa de ser "não renderizar" e passa a ser "proteger o `live`".

Legenda da origem: **P0/P1/P2** = achado da auditoria; **A001…A005** = plano de animação; **PT1** = Portão 1; **DS** = DESIGN.md; **WIG** = Web Interface Guidelines; **R1** = aprendido na revisão da fatia 1.

## G — Vale para todas as fatias

| ID | Critério | Origem | Como verifico |
| --- | --- | --- | --- |
| G1 | Escopo da fatia respeitado. Copy só a aprovada no Portão 1; qualquer outra copy (inclusive a do freebie) vai como proposta para o Portão 2 | PT1 "Não aprovado ou não decidido" | diff de `src/content/**` e de textos em JSX |
| G2 | `lint` e `typecheck` com exit 0; e2e das rotas tocadas verde contra o build; testes acoplados a classe ou texto atualizados na mesma fatia | regra das fatias | saída dos comandos no relatório da fatia |
| G3 | Sem rolagem horizontal de 320 a 1440 px, inclusive com texto a 200 % | DS Layout | `scrollWidth − innerWidth = 0` |
| G4 | axe sem violações (wcag2a/2aa/21aa/22aa) a 1280 px nas rotas tocadas; contraste AA medido em todo par de cor novo, incluindo hover e desabilitado | DS Do; Anexo B | axe + cálculo de contraste |
| G5 | Foco de 3 px Tinta com offset em tudo que a fatia tocou; o cabeçalho fixo não cobre o elemento focado | DS Buttons; WIG Focus | Tab nas rotas, estilo computado |
| G6 | `prefers-reduced-motion: reduce`: nenhuma entrada ou deslocamento; o Kito começa parado, com "Retomar animação" | DS Estados; A004 | emulação de movimento reduzido |
| G7 | Nenhuma cor computada fora da paleta B, exceto `.hero-scene` e o botão do Google; o Céu só aparece na hero | PT1 paleta; DS Colors | varredura das cores computadas por página |
| G8 | Capturas "depois" com **dados reais**. A API local responde 403 para a origem 5180, então carrinho, Minha área e a oferta da home precisam de outro meio (liberar 5180 na API local ou proxy de leitura aprovado pelo orquestrador). Captura de estado de erro não vale como "depois" | R1 | conteúdo das capturas em `design-review/fatias/<n>/depois` |
| G9 | O servidor "depois" serve exatamente o commit em revisão, sem trabalho de outra fatia em andamento; o relatório da fatia informa o hash servido | R1 | `git status` limpo em `src/` durante a revisão |
| G10 | Kito sem asset novo; atlas, FPS, ciclo e chão intactos (parâmetros só de `src/kito-motion.ts`, gerado) | PT1 Kito; DS Kito | diff de `public/media/**` e `src/kito-motion.ts` |

## Fatia 1 — Tokens e tipografia

Status desta revisão: ver [revisoes/fatia-1.md](revisoes/fatia-1.md).

| ID | Critério | Origem | Como verifico | Status |
| --- | --- | --- | --- | --- |
| F1.1 | Tokens únicos em `@theme` e `:root`, iguais ao DESIGN.md (cores, tipo, espaço, raios, linhas, sombras, movimento); nenhum token declarado e sem uso | P2-9; DS | grep de `var(--…)` × declarações | PARCIAL |
| F1.2 | Hex solto só na cena da hero e no botão do Google | P2-9 | grep de `#[0-9a-f]` fora de `@theme` | RESOLVIDO em `55d7b9d` (o `#d1e9e5` saiu com a seção escura) |
| F1.3 | Tamanhos de fonte só da escala do DESIGN.md: Display só no H1 da hero; H2 em Headline; Title e Title-sm; Lead; Body; Label; Caption. Nenhum `font-size` literal fora da escala | P1-3; P2-9; DS Typography | grep de `font-size` sem `var(--text-…)`; tamanhos computados por página | RESOLVIDO em `3979931` |
| F1.4 | Nenhum texto em caixa alta ou com tracking positivo | P1-3; PT1 hero | `text-transform` computado | RESOLVIDO |
| F1.5 | Botões retos de 6 px, sem sombra, sem glifo de seta; `.button-secondary` definido | P2-3; P1-6 | estilo computado de `.button` e `.icon-button` | RESOLVIDO |
| F1.6 | `.step-number` escopado (38 px na home mesmo depois de `/carrinho`); título da newsletter do rodapé com estilo próprio | P1-7 | navegação SPA `/carrinho` → `/`; `font-size` do h2 | RESOLVIDO |
| F1.7 | Texto no lugar do preço ("Consultando preço…", "Preço em breve", erro) em Body Tinta suave, nunca em Display | P1-5; DS Typography | catálogo falho simulado | RESOLVIDO |
| F1.8 | Tokens de movimento criados e plano 005 aplicado (240 ms, 40 ms, 8 px em Meus jogos e no pagamento) | A005 | `animation-*` computado em `/meus-jogos` | RESOLVIDO |
| F1.9 | Código morto removido sem perder estilo em uso (`GamesSection.tsx`, classes órfãs) | P2-9; Anexo D | classes no TSX × CSS | PARCIAL |
| F1.10 | Avisos sem barra lateral (`side-tab`) | P2-7 | `/termos` | RESOLVIDO |
| F1.11 | A consolidação não retirou regra genérica que ainda estiliza algo, como o tamanho do logo | R1 | antes × depois por componente | RESOLVIDO em `3979931` |

## Fatia 2 — Cabeçalho e rodapé

Status depois de `67c66c5` e do commit de ajustes `3979931` ([revisoes/fatia-2.md](revisoes/fatia-2.md), [revisoes/fatia-3.md](revisoes/fatia-3.md)):
- RESOLVIDO: todos (F2.1–F2.10). Os ajustes F2.1, F2.4, F2.7 e F2.8 foram conferidos no build.

| ID | Critério | Origem | Como verifico |
| --- | --- | --- | --- |
| F2.1 | Um nome por ação: "Quero o pacote" → `/#comprar` no header, no menu, no rodapé e no vazio da gaveta; o item "O pacote" → `/#comprar`; somem "Escolher nosso encontro", "Conhecer o pacote" e "Conhecer o pacote de jogos" nessas superfícies | P1-2; PT1 "Um nome por ação" | grep dos rótulos; `href` |
| F2.2 | "Ajuda" com o mesmo tamanho, peso e cor dos outros links | P2-6 | estilo computado |
| F2.3 | Minha área (`/meus-jogos`, `/pedidos`, `/conta`): logo, Meus jogos, Minha conta, Ajuda e menu da conta, sem CTA comercial nem carrinho; o menu móvel segue a mesma lista | P2-6; PT1 "Minha área" | captura a 1280 e 375, logado |
| F2.4 | Menu móvel: links em 240 ms, atraso de 40 ms + ordem × 40 ms, deslocamento de 8 px; último link termina em ≤ ~400 ms | A003a; P2-11; DS Navigation | `animation-duration` e `animation-delay` computados |
| F2.5 | Deslocamento no hover só sob `(hover: hover) and (pointer: fine)` (vale para qualquer seta ou ícone que volte) | A003b | CSS |
| F2.6 | Cabeçalho em Céu sobre a hero e em Papel nas demais páginas; Papel a 94 % com desfoque e sombra de cabeçalho só depois de rolar | DS Navigation | estilo computado em `/` rolado e não rolado |
| F2.7 | Logo do rodapé no tamanho de marca (≈ 178 px no desktop e ≈ 150 px no celular, como antes), não na largura natural da imagem | R1 | `getBoundingClientRect` do `.footer-brand img` |
| F2.8 | Linha de recorte só entre folhas públicas: **não** em páginas privadas (Minha área, carrinho, pagamento), onde o rodapé usa a régua de Tinta | DS "Linha de recorte" e "Régua de tinta" | captura das rotas privadas |
| F2.9 | `/pagamento` em modo foco: logo, "Compra segura" com cadeado e "Voltar ao carrinho" | DS Navigation; PT1 "Compra simples" | captura a 1280 e 375 |
| F2.10 | Escape fecha menu e gaveta e devolve o foco ao gatilho; `overscroll-behavior: contain` nos painéis | DS Navigation; WIG | teclado |

## Fatia 3 — Hero

Status da revisão de `7a5e926` ([revisoes/fatia-3.md](revisoes/fatia-3.md)):
- RESOLVIDO: F3.1–F3.7, F3.9, F3.11
- PARCIAL: F3.10 (falta registrar na base a exceção do atlas)
- F3.8 transferido para a F4.16 e resolvido em `55d7b9d` (linha sob o chão da hero)

| ID | Critério | Origem | Como verifico |
| --- | --- | --- | --- |
| F3.1 | Headline e apoio atuais mantidos ("A rotina pode esperar. Vocês têm um encontro." e "Jogos para imprimir, puxar uma cadeira…"); `site.heroDescription` fora da hero | PT1 princípio 1 | texto renderizado |
| F3.2 | Sai a lista de ✓. O rótulo vira etiqueta `.tag` "KeyToTwo · jogos para casais", em caixa normal e com borda tracejada | PT1 "Hero"; P1-1 (parte visual); DS Tags | DOM e estilo computado |
| F3.3 | Texto alinhado à esquerda, como folha de rosto; marca-texto Damasco só em "encontro.", uma única vez na página | PT1 "Direção visual"; DS One Highlight | contagem de `mark` por página |
| F3.4 | CTA principal "Quero o pacote" → `/#comprar`; link de texto secundário "Ver a prévia" → prévia | PT1 "Hero"; P1-2 | `href` e estilo |
| F3.5 | Coreografia intacta: `verify:hero` aponta `footGroundDelta ≤ 0,1 px` e `sceneClearance ≥ 20 px` em 1440×900, 1280×720, 390×844 e 320 px; volta só fora da tela; pausa fora de vista, com aba oculta e com menu aberto. O script precisa passar inteiro: hoje ele falha antes, em asserções antigas (`#reembolso`, `.mobile-sign-in`), e a fatia corrige ou isola essas asserções | A004; DS Kito; prompt da hero | saída do `verify:hero` anexada |
| F3.6 | Sem teleporte no resize: mudança só de altura não move o Kito; mudança de largura preserva a posição (± 1 passo, ~7 px) | A004 | roteiro "Feel check" do plano 004 |
| F3.7 | Texto legível no primeiro paint, sem reveal na hero | prompt da hero; P1-4 | captura sem rolagem |
| F3.8 | Linha de recorte com tesoura logo abaixo do chão, fazendo a ponte hero → papel | PT1 "Direção visual"; DS | captura a 1280 e 375 |
| F3.9 | Primeira dobra a 1280×720 e 375×812 mostra headline, apoio, CTA e o Kito sobre o chão | prompt da hero | captura |
| F3.10 | Peso da mídia da hero medido e informado; exceção do atlas registrada, ou atlas 1× para telas 1× | P2-8 | `media` do `verify:hero` |
| F3.11 | A paleta da cena não sai de `.hero-scene` | DS Colors | G7 |

## Fatia 4 — Seções da home

Status depois de `55d7b9d` e dos ajustes `0e24c32` ([revisoes/fatia-4.md](revisoes/fatia-4.md), [revisoes/fatia-5.md](revisoes/fatia-5.md)):
- RESOLVIDO: F4.1–F4.8, F4.10–F4.16
- PARCIAL: F4.9 (repetição de texto; vai como proposta ao Portão 2)
- ABERTO: F4.17 (P2; pode ir para a fatia 6)

| ID | Critério | Origem | Como verifico |
| --- | --- | --- | --- |
| F4.1 | Títulos à esquerda, sem kicker acima. **Decisão pendente:** apagar o texto dos rótulos é mudança de copy, não listada no Portão 1. Ou o orquestrador confirma com o responsável, ou os rótulos ficam como estão hoje (caixa normal, Tinta suave) até o Portão 2 | P1-3; DS Heading Carries Itself; PT1 | DOM |
| F4.2 | A primeira folha depois da hero apresenta o catálogo: folha de cartas com 5 colunas a partir de 1050 px, 2 colunas de 768 a 1050 px (a primeira carta ocupa a linha inteira) e carrossel com snap só abaixo de 768 px; calhas tracejadas e marcas de corte | Direção B; P2-2; DS Layout | captura a 1440, 1280, 900, 768 e 375 |
| F4.3 | Capas: J001 com a página real; os demais jogos com capa tipográfica (selo "No pacote" + nome), sem Kito, em toda superfície (home e Minha área) | P0-2; PT1 "Capas tipográficas" | captura; grep de `kito-` em `GameCover` |
| F4.4 | Sem numeração 01–05 nas cartas | P2-1 | DOM |
| F4.5 | Cartas não clicáveis não se movem no hover | A002; P2-4 | `transform` computado no hover |
| F4.6 | Reveal só no conteúdo (`.page-section > .content-width`), em 320 ms e 8 px, com o token `--duration-reveal`; 400 ms depois de um salto por âncora, nenhuma seção fica com opacidade < 1 | A001; P1-4 | opacidade medida após `location.hash` |
| F4.7 | Regra de catálogo: nenhum componente desenha "5" ou "P001"; a oferta renderiza um card por produto; a folha aceita de 1 a N cartas | PT1 princípio 2; DS Catalog Rule | grep de "5 jogos" e "P001" nos componentes; teste com 1 e 6 itens |
| F4.8 | Oferta como ficha com pontilhado (conteúdo, formato, acesso); preço real em Headline junto de "Adicionar ao carrinho"; no celular, preço e botão antes da prévia | P1-10; DS Ficha e Layout | posição y do preço a 375 px |
| F4.9 | A informação de acesso aparece uma vez só; a lista do pacote tem marcador ou fica alinhada à margem | P2-10 (texto → aprovação) | captura da oferta |
| F4.10 | Fora da hero, o Kito aparece no máximo uma vez na home, parado, como anfitrião; sai dos pilares, das capas e da prévia | P1-9; PT1 "Kito fora da hero" | contagem de imagens do Kito |
| F4.11 | Relatos: 3 relatos curtos com `placeholder: true` no conteúdo, na voz da marca, renderizados só no stage `test`. No `live`, só relatos reais; sem nenhum real, a seção não renderiza. Sem estrelas, nota ou número de avaliações; sem linhas cinzas imitando texto (`.placeholder-lines`) | P0-1 reformulado; PT1 "Prova social" | render com stage `test` e `live` |
| F4.12 | Nada de três seções seguidas com o mesmo esqueleto (título + três colunas centralizadas); "Estar ali. De verdade." fundida ou retirada (retirar texto é decisão do responsável) | P1-3 | captura da página inteira |
| F4.13 | Papel dominante: a seção da prévia sai do fundo Tinta e da bolha Marca-texto; o Marca-texto não é cor de texto nem fundo de bloco | PT1 paleta; DS Colors e One Highlight | G7 + captura |
| F4.14 | Lugar do freebie preparado (carta ou etiqueta "por recortar"), sem copy nova, promessa ou data | PT1 "Haverá um freebie"; DS Tags | componente renderizado com dado fictício só em `test` |
| F4.15 | "Como funciona" pode manter 01/02/03, porque é uma sequência real | P1-3 | — |
| F4.16 | Linha de recorte com tesoura entre folhas, e só aí, incluindo a que fica logo abaixo do chão da hero (F3.8, transferido) | DS Linha de recorte | contagem de `.cut-line` |
| F4.17 | O contador do carrossel não anuncia a cada rolagem, só depois das setas | P2-2; WIG `aria-live` | leitor de tela / `aria-live` |

## Fatia 5 — Páginas secundárias

Status da revisão de `f174f15` ([revisoes/fatia-5.md](revisoes/fatia-5.md)):
- RESOLVIDO: F5.1–F5.4, F5.6–F5.10
- PARCIAL: F5.5 (conteúdo do pacote escondido no carrinho e ausente no pagamento)
- Novo ajuste de catálogo: a miniatura do produto deve vir de `products.ts`

| ID | Critério | Origem | Como verifico |
| --- | --- | --- | --- |
| F5.1 | No post do blog, a newsletter vem depois do artigo | P1-8; PT1 "Blog" | ordem no DOM |
| F5.2 | Blog (lista e post) com medida de 60–70ch e títulos na escala | DS Typography | estilo computado |
| F5.3 | Ajuda, termos e privacidade: aviso com borda completa; "Voltar ao início" como link de texto | P2-7; DS Aviso | captura |
| F5.4 | Entrar: cartão de acesso na linguagem da folha. O botão do Google segue a forma retangular da diretriz do Google, ou a exceção da cápsula fica registrada no DESIGN.md | DS Shapes ("Não existem cápsulas") | estilo computado |
| F5.5 | Carrinho e pagamento: etapas Carrinho → Entrar → Pagamento → Pronto com a atual destacada; em cada passo, o que está sendo comprado (nome, conteúdo, preço) fica visível | PT1 "Compra simples, divertida e clean"; DS Etapas | captura logado, sem pagar |
| F5.6 | Minha área: capas iguais às da home; Kito acenando pequeno só na saudação; abas com sublinhado de 3 px | P0-2; DS Kito e Navigation | captura logado (G8) |
| F5.7 | Pedidos e conta: régua de Tinta nas listas; selos de status legíveis (AA) | DS Elevation | G4 |
| F5.8 | Confirmação de compra: celebração com `kito-hi` e confete, o único momento longo | PT1 "Kito"; DS Kito | estado simulado (sem pagar) |
| F5.9 | Tracejado só onde "se corta" (cartas, entre folhas, etiqueta); listas, painéis e divisórias de gaveta e menu usam a régua de Tinta | DS Elevation; risco anotado na direção B | grep de `--line-cut` |
| F5.10 | Nenhum texto abaixo de 13 px (Caption) fora dos três usos do `micro` (11 px) que o DESIGN.md registrou em `3979931`: selo "No pacote", contagem do carrinho e etapas da compra no celular. Recomendação: reavaliar as etapas no celular, que são rótulos lidos | DS Typography; WIG | tamanhos computados |

## Fatia 6 — Estados

| ID | Critério | Origem | Como verifico |
| --- | --- | --- | --- |
| F6.1 | Erro: uma única mensagem em Body com `role="alert"` e um botão secundário "Tentar novamente"; sem segunda mensagem genérica. Vale para o preço indisponível, que hoje mostra duas mensagens e um link de texto | P1-5; DS Estados | falha simulada do catálogo e do carrinho |
| F6.2 | Botão de compra desabilitado com a razão em Caption ao lado | DS Estados | catálogo falho |
| F6.3 | Vazio (carrinho, gaveta, biblioteca, pedidos): Kito na caixa sem lágrima, usando pose existente (nunca imagem nova), título, uma frase e "Quero o pacote" | P2-5; PT1 "Kito"; DS Estados | captura dos vazios |
| F6.4 | Erro, falha de pagamento e 404: pose neutra = quadro 01 do atlas (`.kito-still`), sem lágrima | P2-5; PT1; DS Kito | captura |
| F6.5 | Carregando: esqueleto em aguada de Tinta, `role="status"` e texto visível terminado em "…" | DS Estados; WIG | rede lenta simulada |
| F6.6 | Desabilitado uniforme: aguada de Tinta + Tinta suave (hoje `.icon-button` usa opacidade .4 e as setas do carrossel .35) | DS Estados | estilo computado |
| F6.7 | Mensagens assíncronas (newsletter, conta, cupom) em `aria-live="polite"` | WIG | DOM |
| F6.8 | Celebração da compra mantida (800 ms e 1,1 s) e sem animação com movimento reduzido | A005 (fora de escopo de propósito); DS | estado simulado |
| F6.9 | Barra fixa de compra no celular: recolhe sobre hero, oferta e rodapé; mostra preço real ou nada | P1-10; DS Layout | rolagem a 375 px |
| F6.10 | Freebie "em preparação" com etiqueta tracejada, sem data nem promessa | PT1 freebie; DS Tags | stage `test` |
