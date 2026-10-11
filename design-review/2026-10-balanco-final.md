# Balanço final da refação de design — KeyToTwo (2026-10-10)

Autor: Prumo (auditor). Base: [auditoria 2026-10](2026-10-auditoria.md), [Portão 1](2026-10-portao-1.md), [`DESIGN.md`](../DESIGN.md), [checklist das fatias](2026-10-checklist-fatias.md) e as revisões [1](revisoes/fatia-1.md), [2](revisoes/fatia-2.md), [3](revisoes/fatia-3.md), [4](revisoes/fatia-4.md), [5](revisoes/fatia-5.md) e [6](revisoes/fatia-6.md).
Estado conferido: `1e157d8` (fatia 6 + ajustes da fatia 5), no http://127.0.0.1:5180.

## Veredito

**A refação está PRONTA PARA O QA.**
- **Fatias:** as seis estão aprovadas, e todos os ajustes obrigatórios das fatias 1 a 5 foram conferidos como resolvidos.
- **Achados:** nenhum P0 ou P1 ficou aberto.
- **Ajuste restante:** os erros de rota (`PendingPage`, post inexistente do blog, erro da newsletter). É pequeno, não tem copy nova e pode correr em paralelo ao QA; a Lupa confere.
- **Fica com o responsável:** a lista do Portão 2, abaixo.

Legenda:
- **RESOLVIDO:** conferido com medida.
- **PARCIAL:** resolvido em parte; o que falta está anotado.
- **ABERTO:** nada mudou.
- **ACEITO:** o responsável decidiu manter ou seguir outro caminho.

## Contagem

| Grupo | Total | RESOLVIDO | PARCIAL | ABERTO | ACEITO |
| --- | --- | --- | --- | --- | --- |
| P0 | 2 | 2 | 0 | 0 | 0 |
| P1 | 10 | 9 | 0 | 0 | 1 |
| P2 | 11 | 6 | 4 | 1 | 0 |
| Planos de animação | 5 | 5 | 0 | 0 | 0 |
| **Total** | **28** | **22** | **4** | **1** | **1** |

Nenhum PARCIAL ou ABERTO é P0 ou P1. O ABERTO (P2-8) e parte dos PARCIAIS (P2-5, P2-10) dependem de decisão do responsável no Portão 2.

## P0 — bloqueia o lançamento público

| # | Achado | Status | Onde se resolveu e evidência |
| --- | --- | --- | --- |
| P0-1 | Depoimentos-fantasma na página de venda | **RESOLVIDO** (na forma do Portão 1) | Fatia 4: 3 relatos com `placeholder: true` e selo "Relato de exemplo", só no stage `test`. No `live`, só relatos reais; sem nenhum, a seção não renderiza. Sem estrelas, nota ou contagem. A frase contraditória saiu na `0e24c32` |
| P0-2 | Kito como capa de jogos não documentados | **RESOLVIDO** | Fatia 4: J001 com a página real; os outros com capa tipográfica e selo "No pacote" ou "Em breve" tracejado, na home e em Meus jogos. A capa vem de `games.ts` |

## P1 — corrigir antes do lançamento

| # | Achado | Status | Onde se resolveu e evidência |
| --- | --- | --- | --- |
| P1-1 | A primeira dobra não diz "pacote" nem "5 jogos" | **ACEITO** (decisão do responsável) | Portão 1: "a hero vende a marca e uma nova forma de pensar, não o produto". A parte visual foi **resolvida** na fatia 3: sem ✓, sem caixa alta, etiqueta tracejada, CTA "Quero o pacote" + "Ver a prévia". O produto aparece logo na primeira folha (cartas dos jogos) |
| P1-2 | Cinco nomes para a mesma ação | **RESOLVIDO** | Fatias 2–5: "Quero o pacote" → `/#comprar` no cabeçalho, no menu, na hero, na prévia, no fechamento, no rodapé, no blog e em todos os vazios; "Adicionar ao carrinho" compra. `git grep` sem "Conhecer o pacote" nem "Escolher nosso encontro" |
| P1-3 | Abaixo da hero, a página vira template | **RESOLVIDO** | Fatias 1 e 4: sem caixa alta, sem rótulos, títulos à esquerda; pilares retirados; cada folha com um objeto dominante próprio. A remoção de texto vai ao Portão 2 |
| P1-4 | O reveal apaga seções inteiras | **RESOLVIDO** | Plano 001 na fatia 4: reveal só em `.page-section > .content-width`, 320 ms e 8 px. Depois de saltos por âncora, o conteúdo visível fica com opacidade 1,00 aos 450 ms |
| P1-5 | Preço indisponível tipografado como preço | **RESOLVIDO** | Fatias 1 e 6: o texto no lugar do preço usa corpo em Tinta suave e `aria-live`, com uma única mensagem e "Tentar novamente" secundário |
| P1-6 | `.button-secondary` sem estilo | **RESOLVIDO** | Fatia 1: Papel, borda Tinta e raio de 6 px, conferido nos erros de carrinho, gaveta, Minha área e oferta |
| P1-7 | Conflitos de cascata | **RESOLVIDO** | Fatia 1: `.step-number` com 38 px na home mesmo depois de `/carrinho`; título da newsletter do rodapé com estilo próprio |
| P1-8 | Newsletter antes do título no post | **RESOLVIDO** | Fatia 5: a newsletter vem depois da prosa e do bloco do pacote |
| P1-9 | Kito repetido como ícone | **RESOLVIDO** | Fatia 4: fora da hero, uma só participação na home (freebie, só no `test`; zero no `live`). Os pilares saíram; prévia e capas ficaram sem Kito; a miniatura de compra é a página real (fatia 5) |
| P1-10 | No celular, preço a ~860 px do título da oferta | **RESOLVIDO** | Fatia 4: preço a 167 px e botão a 429 px do título, a 375 px |

## P2 — próximo passe

| # | Achado | Status | Onde se resolveu e evidência |
| --- | --- | --- | --- |
| P2-1 | Numeração 01–05 nos jogos | **RESOLVIDO** | Fatia 4: sem `.game-number`; o rótulo acessível é o nome do jogo |
| P2-2 | Carrossel esconde jogos no desktop; contador fala a cada rolagem | **PARCIAL** | Os 5 jogos lado a lado a partir de 1050 px e carrossel só abaixo de 768 px (fatia 4). **Falta:** o contador `aria-live` ainda anuncia a cada mudança de posição (F4.17) |
| P2-3 | Cápsula, sombra dura e "→" | **RESOLVIDO** | Fatias 1 e 5: 0 cápsulas, 0 sombras duras, 0 setas; botão do Google com 6 px |
| P2-4 | Cards sobem no hover sem serem clicáveis | **RESOLVIDO** | Plano 002 na fatia 4: `transform: none` no hover |
| P2-5 | Kito chorando em vazio e erro | **PARCIAL** | Erro, falha de pagamento e 404 com a pose neutra, quadro 01 do atlas (fatia 6). **Falta decidir:** os vazios mantêm a caixa com lágrima, porque é o único asset e o Portão 1 proíbe imagem nova. Vai ao Portão 2 |
| P2-6 | Header: "Ajuda" menor; área privada com header comercial | **RESOLVIDO** | Fatias 1, 2 e 5: "Ajuda" com o mesmo peso; Minha área com logo, Meus jogos, Minha conta e Ajuda; "Minha conta" também na aba e no h1 |
| P2-7 | Barra lateral em avisos | **RESOLVIDO** | Fatia 1: avisos com borda completa |
| P2-8 | Mídia da hero acima da meta de 500 KB | **ABERTO** (decisão do responsável) | O `verify:hero` informa 976 KB na carga da home (atlas de 482 KB; só a hero, cerca de 780 KB). A exceção do atlas vai ao Portão 2 |
| P2-9 | CSS em quatro gerações, hex soltos, código morto | **PARCIAL** | Fatias 1 e 4: tokens únicos, nenhum hex solto fora da cena e do Google, nenhum `font-size` literal no CSS, código morto removido. **Falta:** 2 tokens sem uso (`--space-xs`, `--space-xl`) e o `PendingPage` com tamanho literal (no ajuste de erros de rota) |
| P2-10 | Lista do pacote sem forma; "após a confirmação" repetido | **PARCIAL** | A lista ganhou linhas pontilhadas (fatia 4). **Falta:** a repetição, que é texto e vai ao Portão 2 |
| P2-11 | Menu móvel lento; seta deslocada no toque | **RESOLVIDO** | Plano 003: 240 ms, 40 + 40 ms × ordem, 8 px; setas removidas |

## Planos de animação

| # | Plano | Status | Evidência |
| --- | --- | --- | --- |
| 001 | Revelar o conteúdo, nunca a seção | **RESOLVIDO** | Fatia 4 (ver P1-4) |
| 002 | Sem lift nos cards não clicáveis | **RESOLVIDO** | Fatia 4 (ver P2-4) |
| 003 | Menu móvel mais curto e hover de seta só com ponteiro fino | **RESOLVIDO** | (a) conferido no build na `3979931`; (b) sem objeto, porque as setas saíram |
| 004 | Caminhada do Kito sem teleporte no resize | **RESOLVIDO** | Fatia 3: o salto ao mudar a largura caiu de −158/+161/−78 px para no máximo 5 px; pose pareada; `verify:hero` passa no build, sem afrouxar regras |
| 005 | Entradas de UI mais curtas, com tokens | **RESOLVIDO** | Fatia 1: Meus jogos e pagamento em 240 ms com escalonamento de 40 ms; tokens de duração no `:root` |

## Achados novos das revisões (fora do relatório original)

| Achado | Status |
| --- | --- |
| Logo do rodapé na largura natural (regressão da fatia 1) | RESOLVIDO (`3979931`) |
| Capturas "depois" com erro 403 da API na origem 5180 | RESOLVIDO (origem liberada; capturas refeitas) |
| Linha de recorte em páginas privadas | RESOLVIDO (`3979931`) |
| Filtro `caret-color` que afrouxava o `verify:hero` | RESOLVIDO (`55d7b9d`) |
| Excesso de tesouras (8) | RESOLVIDO: 3 cortes, com "The Three Cuts Rule" no DESIGN.md (`0e24c32`) |
| Regra de catálogo no código (oferta, cartas, miniatura) | RESOLVIDO (`0e24c32` e `1e157d8`) |
| Meus jogos com cards de 787 px (capa 3:4) | RESOLVIDO (`f174f15`) |
| Compra sem dizer o que se compra em cada passo | RESOLVIDO (`1e157d8`) |
| **Erros de rota com o visual antigo** (`PendingPage`, post inexistente, newsletter) | **ABERTO: único ajuste obrigatório restante** ([revisão 6](revisoes/fatia-6.md)) |
| Desabilitado por opacidade; contador do carrossel; `P001` em `carrinho.tsx`; folha de cartas presa a `products[0]`; cupom não verificado | ABERTOS, P2, sem bloquear |

## Para o Portão 2 (decisões do responsável)

1. **Mídia da hero (P2-8):** aprovar a exceção do atlas (976 KB na carga inicial da home, contra a meta de cerca de 500 KB) ou pedir um atlas 1× para telas 1×.
2. **Texto removido:**
   - os 9 rótulos de seção da home;
   - os 7 rótulos das páginas internas e o da newsletter;
   - a seção "Estar ali. De verdade.", com os 3 textos dos pilares.

   O auditor concorda com as remoções (DESIGN.md, esboço B), mas elas não estavam na lista do Portão 1.
3. **Freebie:** copy proposta (etiqueta, título, texto e "Criar conta"), visível só no `test`, até a aprovação e o backend do resgate.
4. **Relatos:** substituir os 3 de exemplo por relatos autorizados. Sem nenhum real, a seção some sozinha no `live`.
5. **Kito nos vazios (P2-5):** manter a caixa com lágrima, que tem tom bem-humorado, ou usar a pose neutra do atlas. Imagem nova está fora de questão.
6. **Oferta (P2-10):** decidir o texto que remove a repetição "Download após a confirmação da compra." / "Acesso após a confirmação".
7. **Para ciência**, regras de design novas registradas no DESIGN.md durante as fatias:
   - **três cortes de tesoura** (hero → cartas, antes da oferta, rodapé);
   - **`micro` de 11 px** só no selo "No pacote", na contagem do carrinho e nas etapas da compra no celular;
   - **item de compra** com miniatura, chamada e entrega vindas dos dados do produto.

## Fora do escopo de design (para o QA)

- e2e `i2b` e `i3-stripe-local` dependem de Mailpit e Stripe local.
- O post inexistente cai no ramo de erro errado: é bug funcional, já listado no ajuste de erros de rota.
- O pagamento real não foi exercitado nas revisões (nada foi pago; as escritas ficaram bloqueadas).
