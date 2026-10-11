# Revisão da fatia 4 — seções da home (Prumo, 2026-10-10)

**Veredito: APROVADA COM AJUSTES.** A home virou a folha da direção B:
- **Seções:** Papel dominante, títulos à esquerda e nenhum rótulo acima deles.
- **Jogos:** folha de cartas com capas tipográficas e nenhum Kito como capa.
- **Kito:** uma única participação fora da hero, só no stage `test`.
- **Planos 001 e 002:** resolvidos.
- **Oferta no celular:** preço e botão no alto.

Ficam quatro ajustes obrigatórios:
- a frase da seção de relatos;
- o excesso de tesouras;
- a regra de catálogo no código;
- uma regressão que a nova capa causou em Meus jogos.

| | |
| --- | --- |
| Commits revisados | `55d7b9d` (fatia 4) e `7242281` (capturas da fatia 3 refeitas) |
| Depois | http://127.0.0.1:5180, stage `test`. O checkout já tem trabalho da fatia 5 (blog, conta, entrar, legais, checkout), mas nenhuma alteração local toca as seções da home, `game-cover`, `.portal-game` ou o reveal; conferi o diff. As medidas da home e de Meus jogos valem para `55d7b9d` |
| Ajustes da fatia 3 | **3 de 3 RESOLVIDOS**: capturas refeitas a partir do commit (logo do rodapé com cerca de 178 px); linha de recorte sob o chão da hero; filtro `caret-color` removido do `verify:hero` |
| Critérios F4 | **RESOLVIDO 12 · PARCIAL 4 · ABERTO 1** |
| Achados da auditoria | P0-1, P0-2, P1-3, P1-4, P1-9, P1-10, P2-1, A001 e A002 (P2-4) **RESOLVIDOS**; P2-2 **PARCIAL** |

## Ajustes obrigatórios

1. **(a) A frase da seção de relatos se contradiz.** "Este espaço está reservado para as histórias de quem jogou junto." aparece acima de três relatos com o selo "Relato de exemplo". No `test`, ela desmente o que vem logo abaixo; no `live`, a seção só aparece quando há relatos reais, e aí a frase também fica falsa. Concordo com o orquestrador.
   - **Correção:** remover `experience.social.description` e deixar o título "Cada dupla, uma história." sozinho. Os selos já explicam os exemplos no `test`.
   - Não precisa de copy nova; se o responsável quiser uma frase de apoio, ela vai como proposta ao Portão 2.
2. **(b) Tesoura em todas as divisões: é excesso, não ritmo.** A home tem **8 linhas de recorte**: 7 seções começam com tesoura, mais a do rodapé. Isso dá uma a cada ~770 px; a 1280×800 sempre há uma na tela, muitas vezes duas, e entre seções curtas ("Como funciona" tem 519 px) as tesouras quase se encostam.
   - **Por que é excesso:** some a isso o tracejado das calhas da folha de cartas, a borda tracejada do freebie e das capas "Em breve", e o pontilhado da ficha e da lista do pacote, e o motivo vira divisória genérica.
   - **O que a direção B dizia:** era exatamente o risco anotado nela ("muitas linhas tracejadas cansam; usar a tesoura só nas divisões de seção e o tracejado só onde há cartas"). A assinatura funciona quando marca uma passagem de verdade. Ver [`fatia-4/home-1280-ritmo-dos-cortes.webp`](fatia-4/home-1280-ritmo-dos-cortes.webp) e [`fatia-4/home-1280-pagina-depois.webp`](fatia-4/home-1280-pagina-depois.webp).
   - **Correção recomendada: 3 cortes.**
     1. Hero → folha de cartas (a ponte da direção B).
     2. Antes da oferta (o momento de "levar para casa").
     3. O rodapé.

     As outras passagens se separam só pelo espaço (`--space-section`), sem linha.
   - **Alternativa aceitável: até 5 cortes.** Agrupar por assunto em 4 folhas — jogos + prévia; como funciona + relatos; oferta + dúvidas; blog + fechamento — mais o rodapé.
   - **Em qualquer caso:** registrar a regra no DESIGN.md (seção "Linha de recorte"), que hoje permite a tesoura entre todas as folhas.
3. **Regra de catálogo (F4.7, princípio do Portão 1: "o sistema precisa aceitar mais produtos").** Três pontos no código; nenhum muda texto, só tira o texto e os códigos fixos dos componentes e os põe nos dados:
   - **Card de oferta:** `ProductOffer` desenha "5 jogos. Muitas próximas rodadas." e a mesma `packageContents` para **qualquer** produto (`OfferSection.tsx:25-26`). Um segundo pacote ou o freebie herdariam "5 jogos". Passar o subtítulo e a lista para os dados de cada produto.
   - **Código das capas:** a folha de cartas deduz o código pela posição (`code={`J00${index + 1}`}`). Usar o código do próprio jogo.
   - **Texto e link do primeiro jogo:** o texto e o link "Ver a prévia" do J001 dependem de `index === 0` (`PackageGames.tsx:17-18`). Usar um campo do jogo, como `previewHref` e um resumo.
4. **Regressão em Meus jogos (área de tarefa: baixar o jogo).** A capa 3:4 com borda própria, pensada para a folha de cartas, entrou inteira no card da biblioteca. Três efeitos:
   - **Cards maiores:** passaram de **536 para 787 px** de altura a 1280 e de **521 para 755 px** a 375.
   - **Download mais longe:** o último "Baixar PDF" desceu de y = 2918 para **y = 4093 px** no celular.
   - **Borda dupla:** a capa (2 px) fica dentro do card (2 px), o que contraria a regra do DS "um elemento declara sua borda uma vez".
   - **Nome repetido:** o nome do jogo aparece na capa e de novo no H2 logo abaixo.
   - **Correção:** em `.portal-game`, capa sem borda própria e na proporção anterior (16:10) ou menor, mantendo a face tipográfica e a prévia do J001.
   - **Evidência:** [`fatia-4/meus-jogos-1280-antes-depois.webp`](fatia-4/meus-jogos-1280-antes-depois.webp).

## Critérios F4

Medidas na home em 1440, 1280, 900, 768 e 375 px (stage `test`) e em Meus jogos, logado, a 1280 e 375.

| Critério | Status | Evidência medida |
| --- | --- | --- |
| F4.1 Títulos à esquerda, sem kicker | RESOLVIDO | 0 `.eyebrow` na home (antes, 11); todos os H2 com `text-align: start`. **Para o Portão 2:** a remoção dos textos dos rótulos não estava na lista do Portão 1 (ver "Copy" abaixo) |
| F4.2 Folha de cartas | RESOLVIDO | **1440 e 1280:** 5 cartas de 221 px lado a lado, calhas tracejadas e marcas de corte nos cantos. **900 e 768:** 2 colunas, com a primeira carta na linha inteira. **375:** carrossel com snap, "1 de 5" e a segunda carta aparecendo na borda. É a primeira folha depois da hero, com a ficha do J001 em pontilhado ao lado do título. [`fatia-4/home-1280-folha-de-cartas.webp`](fatia-4/home-1280-folha-de-cartas.webp) |
| F4.3 Capas | RESOLVIDO | **Home:** J001 com a página real; "Hora dos Artistas" e "Boardgame" com face tipográfica e selo "No pacote"; os 2 jogos indefinidos em "Em breve" tracejado. Proporção 0,75 em todas. **Meus jogos:** nenhuma imagem do Kito nas 5 capas. O efeito no tamanho dos cards está no ajuste 4 |
| F4.4 Sem numeração | RESOLVIDO | 0 `.game-number`; o `aria-label` passou a ser o nome do jogo |
| F4.5 Carta não se move no hover (A002) | RESOLVIDO | `transform: none` com o mouse sobre a carta |
| F4.6 Reveal só no conteúdo (A001) | RESOLVIDO | 7 alvos `.page-section > .content-width`, todos com 0,32 s; nenhuma `section` com `data-reveal`. **Saltos** para `#comprar`, `#duvidas` e `#como-funciona`, a 1280 e 375: 450 ms depois, todo conteúdo visível está com opacidade **1,00**. Antes, as seções puladas ficavam em 0 |
| F4.7 Regra de catálogo | PARCIAL | Ajuste 3. A oferta já renderiza um card por produto de `products`, e a folha aceita N cartas (`repeat(5)` quebra em linhas novas) |
| F4.8 Oferta | RESOLVIDO | Preço real em Headline-sm, junto de "Adicionar ao carrinho"; card com marcas de corte; lista do pacote com linhas em pontilhado. **No celular:** preço a **167 px** do título da seção e botão a **429 px**. Antes, ~860 e ~1140 px |
| F4.9 Acesso informado uma vez | PARCIAL | A lista ganhou forma (linhas pontilhadas, sem recuo). Continua a repetição "Download após a confirmação da compra." / "Acesso após a confirmação". Muda texto, então vai como proposta ao Portão 2 (P2-10) |
| F4.10 Kito no máximo uma vez fora da hero | RESOLVIDO | Fora da hero, só `kito-hi-128` no freebie (stage `test`). No `live`, zero: o freebie não renderiza. A prévia e as capas ficaram sem Kito |
| F4.11 Relatos | PARCIAL | **Cumpre o Portão 1:** 3 relatos com `placeholder: true` e selo "Relato de exemplo"; fora do `test` são filtrados e, sem nenhum real, a seção não renderiza (`Testimonials`, condição `visible.length`); sem estrela, nota ou contagem; as linhas cinzas que imitavam texto saíram. **Falta:** a frase do ajuste 1 |
| F4.12 Sem três seções com o mesmo esqueleto | RESOLVIDO | Os pilares saíram. Cada folha tem um objeto dominante diferente: cartas, páginas reais, passos, citações, ficha de preço, lista de dúvidas. Só "Como funciona" e "Relatos" ficaram em três colunas seguidas, com título à esquerda |
| F4.13 Papel dominante | RESOLVIDO | Todas as seções em `#FFFFFF`; Céu só na hero. Nenhum fundo em Marca-texto (0 elementos) e 1 `mark` na página. **Nenhuma cor fora da paleta** em qualquer largura; o `#d1e9e5` saiu, o que fecha a F1.2 |
| F4.14 Lugar do freebie | RESOLVIDO | Só no `test` (`siteConfig.stage === 'test' && freebie.proposal`), com etiqueta tracejada "Em preparação · copy em proposta", Kito convidando e botão secundário "Criar conta" → `/entrar`. A copy vai ao Portão 2 |
| F4.15 Passos 1, 2, 3 | RESOLVIDO | Números reais, sem o zero à esquerda |
| F4.16 Linha de recorte | PARCIAL | Presente sob o chão da hero e entre as folhas, como pedido, mas em excesso (ajuste 2) |
| F4.17 Contador do carrossel | ABERTO | `SnapCarousel` não mudou: o `role="status"` com `aria-live` atualiza a cada mudança de posição durante a rolagem, e no celular não há setas. P2, sem bloquear; pode ir para a fatia 6 |

**Regras gerais:**
- axe sem violações na home a 1280 e 375; nenhum erro de console ou de página.
- O Nanquim mediu ausência de rolagem horizontal de 320 a 1440 px com texto a 200 %. Eu não repeti essa medida; nas minhas, a home ficou entre 6 184 px (1280) e 7 194 px (375) de altura.

## Copy alterada nesta fatia: o que vai ao Portão 2

- **Aprovado no Portão 1 e aplicado:** "Quero o pacote" na prévia e no fechamento; 3 relatos de exemplo.
- **Proposta, visível só no `test`:** etiqueta, título, texto e CTA do freebie.
- **Removido sem estar na lista do Portão 1** (o critério F4.1 deixava a decisão ao responsável):
  - os 9 rótulos de seção ("Dentro do pacote", "Pode puxar uma cadeira", "Da tela para a mesa", "O melhor da partida", "Histórias a dois", "Levem a ideia para casa", "Para imprimir · para vocês", "Antes de começar", "O próximo plano é de vocês");
  - a seção "Estar ali. De verdade." com os 3 textos dos pilares.

  Concordo com as remoções; elas seguem o DESIGN.md e o esboço B. Ainda assim, precisam do registro do responsável.

## Recomendações (P2)

- **Celular, ordem da oferta:** o nome "Pacote KeyToTwo" aparece **depois** do card de preço, então a pessoa vê o preço antes de ver o nome do que compra (Portão 1: "sabe exatamente o que está comprando"). Subir o título do produto para antes do card e deixar só a lista depois. [`fatia-4/home-375-cartas-e-oferta.webp`](fatia-4/home-375-cartas-e-oferta.webp)
- **Etiqueta do freebie:** tirar "copy em proposta" do texto visível quando o Portão 2 aprovar a copy.

## Ambiente e método

- **Ferramentas:** Playwright com axe no 5180, com escritas na API bloqueadas e nada pago.
- **O que medi na home:**
  - seções, cortes, fundos, cores e contagem de Kito e `mark`;
  - faces e colunas das cartas;
  - a oferta e o freebie;
  - os relatos;
  - o reveal antes e depois de saltos por âncora;
  - o hover das cartas.
- **Meus jogos:** comparei a altura dos cards e a posição do último download entre 5178 e 5180, logado.
- **Fora do repositório:** scripts e capturas brutas ficaram no meu scratchpad.
