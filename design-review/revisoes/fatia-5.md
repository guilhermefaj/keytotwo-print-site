# Revisão da fatia 5 — páginas secundárias, e dos ajustes da fatia 4 (Prumo, 2026-10-10)

**Veredito: fatia 5 APROVADA COM AJUSTES.** O Portão 1 está cumprido em todas as páginas internas:
- **Newsletter:** no post, vem depois do artigo.
- **Minha conta:** o mesmo nome no cabeçalho, na aba e no h1.
- **Quero o pacote:** em todos os vazios; nenhum rótulo antigo de ação sobrou no código.
- **Visual:** nenhum rótulo acima do título; régua no lugar do tracejado comum; Google sem cápsula.
- **Meus jogos:** voltou ao tamanho de antes.

Os quatro ajustes da fatia 4 estão resolvidos. Ficam dois ajustes obrigatórios, ambos na compra: mostrar **o que** se compra em cada passo, e tirar dos componentes a miniatura fixa do J001.

| | |
| --- | --- |
| Commits revisados | `0e24c32` (ajustes da fatia 4) e `f174f15` (fatia 5) |
| Depois | http://127.0.0.1:5180. O checkout tem a fatia 6 em andamento (`OfferSection`, `ProductPurchaseAction`, `not-found`, `pedido.confirmacao`); essas alterações só mexem em estados de erro e na confirmação. Medi no navegador só o que as fatias 4 e 5 tocaram; a confirmação fica para a revisão da fatia 6 |
| Compra | Carrinho com item **simulado no navegador** (o produto real do catálogo na resposta de `GET /api/cart`). Escritas na API bloqueadas, termos não aceitos, **nada pago**. Navegador único, fechado ao fim de cada etapa |
| (a) Ajustes da fatia 4 | **4 de 4 RESOLVIDOS** |
| (b) Critérios F5 | **RESOLVIDO 9 · PARCIAL 1 · ABERTO 0** |
| Achados da auditoria | P1-8 RESOLVIDO; P1-2 RESOLVIDO no site inteiro; P2-6 e P2-7 confirmados resolvidos |

## Ajustes obrigatórios

1. **Compra: "o que estou comprando" visível em cada passo (F5.5, Portão 1: "a pessoa sabe exatamente o que está fazendo e o que está comprando em cada passo").** Preço e "depois" estão bem resolvidos, mas o conteúdo do pacote some ou fica escondido:

   | Passo | Nome | Conteúdo | Preço | O que acontece depois |
   | --- | --- | --- | --- | --- |
   | Carrinho | "Pacote KeyToTwo" | **Escondido** atrás de "O que está incluído" (fechado) | R$ 19,90 e subtotal | "Depois da confirmação, os jogos ficam na sua conta." |
   | Pagamento | "Pacote KeyToTwo" | **Ausente** | R$ 19,90 e subtotal | **Ausente.** Só "Ao aceitar os termos, o formulário de pagamento aparece aqui." |

   **Correção:** sem copy nova, usar os dados que a fatia 4 levou para `products.ts`:
   - `product.tagline` ("5 jogos. Muitas próximas rodadas.") sob o nome, no carrinho e no resumo do pagamento;
   - a linha de entrega (`product.delivery`) também no resumo do pagamento.

   Evidência: [`fatia-5/carrinho-e-pagamento-1280.webp`](fatia-5/carrinho-e-pagamento-1280.webp), [`fatia-5/carrinho-e-pagamento-375.webp`](fatia-5/carrinho-e-pagamento-375.webp).
2. **Miniatura do produto fixa no componente (regra de catálogo).** A fatia trocou o Kito pela página real do J001, o que está certo para o pacote de hoje. Só que a imagem ficou fixa em `PurchaseThumbnail` (`PurchaseUi.tsx:6`) e na gaveta (`CartDrawer.tsx:36`), para **qualquer** produto. Um segundo pacote ou o freebie apareceriam com a página de um jogo que não contêm, o mesmo tipo de problema do P0-2.
   - **Correção:** campo `thumbnail` em `products.ts`, com a face tipográfica (nome do produto) quando não houver imagem aprovada.

## (a) Ajustes da fatia 4

| Ajuste | Status | Evidência |
| --- | --- | --- |
| Frase "Este espaço está reservado…" | RESOLVIDO | A seção de relatos tem só o título (`.section-heading p` ausente), em 1280 e 375 |
| Tesouras | RESOLVIDO | 3 linhas de recorte na home: depois da hero (`package-games`), antes da oferta (`offer-section`) e no rodapé. "The Three Cuts Rule" registrada no DESIGN.md e no sidecar, incluindo "nunca em páginas privadas" |
| Regra de catálogo | RESOLVIDO | **Oferta:** chamada, conteúdo e entrega vêm de `products.ts` (`tagline`, `contents`, `delivery`). **Cartas:** código, resumo, prévia aprovada e fatos de cada uma vêm de `games.ts`; `GameCover` acha a prévia pelo código do jogo; não sobrou `J00{index}` nem `index === 0`. Observação: a folha de cartas usa `products[0]`, o que basta enquanto houver um pacote; com um segundo, cada produto precisa da própria folha |
| Regressão de Meus jogos | RESOLVIDO | Capa 16:10 sem borda própria, separada por régua (355×222 a 1280). Cards de **535 px** a 1280 (eram 787; antes da fatia 4, 536) e de 521 px a 375. Último "Baixar PDF" em **y = 2921** no celular (era 4093; antes, 2918). [`fatia-5/meus-jogos-1280-antes-depois.webp`](fatia-5/meus-jogos-1280-antes-depois.webp) |

## (b) Critérios F5

Medidos em `/blog`, `/blog/exemplo-como-publicar`, `/ajuda`, `/termos`, `/privacidade`, `/entrar`, `/jogo-gratuito`, `/email/preferencias`, `/meus-jogos`, `/pedidos`, `/conta`, `/carrinho` e `/pagamento` (1280 e/ou 375).

| Critério | Status | Evidência medida |
| --- | --- | --- |
| F5.1 Newsletter depois do artigo (P1-8) | RESOLVIDO | No DOM do post, a newsletter vem depois do H1, da prosa e do bloco do pacote ("Quero o pacote"). [`fatia-5/blog-post-1280-newsletter-depois-do-artigo.webp`](fatia-5/blog-post-1280-newsletter-depois-do-artigo.webp) |
| F5.2 Blog legível | RESOLVIDO | H1 em Headline (52 px); prosa com o limite de 70ch; entradas da lista separadas por régua |
| F5.3 Ajuda, termos e privacidade | RESOLVIDO | 0 rótulos; aviso com borda completa (da fatia 1); "Voltar ao início" como link de texto |
| F5.4 Entrar | RESOLVIDO | Botão do Google com raio de **6 px** (a forma retangular está prevista na diretriz do Google); cartão de acesso com borda de carta; 0 rótulos |
| F5.5 Carrinho e pagamento | PARCIAL | **Feito:** etapas Carrinho → Entrar (✓ quando logado) → Pagamento → Pronto, com a atual em destaque e conectores em régua; nome e preço em cada passo; "depois" no carrinho; voz da marca ("Sua escolha", "Seu próximo encontro", "Falta pouco para o encontro"); visual limpo, com dois cards no desktop e empilhado no celular. **Falta:** o ajuste 1 |
| F5.6 Minha área | RESOLVIDO | Capas tipográficas sem Kito, 16:10 e sem borda dupla; Kito acenando só na saudação (`kito-hi-128`); abas "Meus jogos · Pedidos · **Minha conta**" e h1 "Minha conta" |
| F5.7 Pedidos e conta | RESOLVIDO | "Sair neste dispositivo" com régua (era tracejado); vazio de Meus jogos com borda sólida; axe sem violações |
| F5.8 Confirmação com celebração | RESOLVIDO (já existia) | Estado pago, simulado: Kito acenando, "Pagamento confirmado…", "Também enviamos para o seu e-mail.", "Baixar agora". A página está em edição na fatia 6, então a revisão formal fica para ela |
| F5.9 Tracejado só onde se corta | RESOLVIDO | 0 elementos tracejados fora de cartas, etiqueta, freebie e linha de recorte em todas as páginas medidas (blog, entradas, citação, gaveta, menu, etapas, Minha área) |
| F5.10 Texto abaixo de 13 px | RESOLVIDO | Abaixo de 13 px só os usos do `micro` registrados no DS: contagem do carrinho e etapas da compra no celular (11 px). A recomendação de reavaliar as etapas continua de pé |

**Regras gerais:**
- axe sem violações em `/blog`, `/ajuda`, `/termos`, `/entrar`, `/conta` e `/meus-jogos` (1280).
- Nenhuma cor fora da paleta, nenhuma rolagem horizontal e nenhum erro de console em todas as páginas medidas.
- Copy desta fatia: os rótulos removidos (os 7 das páginas internas e o da newsletter) seguem a mesma lógica da fatia 4 e entram na lista do Portão 2. "Quero o pacote" e "Minha conta" foram aprovados.

## Recomendações (P2)

- **Cupom:** o carrinho diz "Tem cupom? Aplique no pagamento.", mas no pagamento o campo só aparece com o formulário, depois dos termos. Não verifiquei, porque carregar o formulário exige criar a sessão de pagamento, e eu bloqueio escritas. Conferir que o campo de cupom existe nesse formulário.
- **Folha de cartas com mais de um produto:** ver a observação em (a).

## Ambiente e método

- **Ferramentas:** Playwright com axe no 5180, com um navegador por vez, fechado ao terminar.
- **Simulações no navegador:** carrinho com o produto real do catálogo e status do pedido (pago, falhou, em processamento) via `page.route`. Nenhuma escrita na API; os termos não foram aceitos e nada foi pago.
- **Medi:** rótulos, rótulos de ação antigos, imagens do Kito, bordas tracejadas, cores fora da paleta, tamanhos abaixo de 13 px, ordem da newsletter no DOM, raio do botão do Google, abas e h1 da conta, altura dos cards de Meus jogos e posição do último download.
- **No código:** `git grep` dos rótulos antigos e das imagens fixas em `HEAD`.
