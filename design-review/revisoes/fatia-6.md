# Revisão da fatia 6 — estados, e dos ajustes da fatia 5 (Prumo, 2026-10-10)

**Veredito: fatia 6 APROVADA COM AJUSTES.** Os estados da compra e da Minha área seguem o DESIGN.md:
- **Erro:** uma mensagem e um "Tentar novamente" secundário.
- **Carregando:** `role="status"` com texto visível.
- **Vazio:** com "Quero o pacote".
- **Kito:** pose neutra no 404 e na falha de pagamento; celebração no pago, sem animação com movimento reduzido.
- **Foco:** visível em todo controle.

Os 2 ajustes da fatia 5 estão resolvidos. Fica um ajuste obrigatório pequeno: os **erros de rota**, que ficaram fora da fatia e ainda usam o visual antigo.

| | |
| --- | --- |
| Commits revisados | `485292f` (fatia 6) e `1e157d8` (ajustes da fatia 5); árvore limpa, o 5180 serve o HEAD |
| Método | Estados simulados no navegador de teste com `page.route`: catálogo, carrinho, biblioteca e conta com falha (503), atraso (6 s) ou resposta vazia; status do pedido pago, falhou, expirou e em processamento. Escritas bloqueadas, nada pago, um navegador por vez. As capturas do Nanquim em `fatias/6-estados` cobrem só o 404 e a confirmação; os demais estados conferi eu |
| (a) Ajustes da fatia 5 | **2 de 2 RESOLVIDOS** |
| (b) Critérios F6 | **RESOLVIDO 7 · PARCIAL 2 · ABERTO 1** |
| Achados e planos | P1-5, P1-6 e P2-11 RESOLVIDOS; plano 003 RESOLVIDO; P2-5 PARCIAL (vazios: decisão do responsável); foco e movimento reduzido conferidos |

## Ajuste obrigatório

1. **Erros de rota com o visual antigo.** Três pontos fora do que a fatia tocou:
   - **`PendingPage` (`root.tsx:62-68`):** é o `ErrorBoundary` da raiz e o `HydrateFallback`. Tem rótulo "KeyToTwo", tamanho de fonte literal (`clamp(2rem, 6vw, 3rem)`), nenhum Kito e só "Voltar ao início". Foi essa tela, "Não foi possível abrir esta página", que apareceu quando a home quebrou durante a fatia 4, e é também o "Carregando" que o servidor manda nas rotas com loader no cliente.
   - **Post inexistente do blog (`/blog/nao-existe`):** responde HTTP 404, mas o navegador mostra o ramo de falha, "Não foi possível abrir este artigo", em vez de "Artigo não encontrado". Fica sem o Kito neutro e sem botão, só com um link de texto. Já era assim no 5178. Também é bug funcional; vale passar à Lupa.
   - **Erro da preferência de newsletter (`Newsletter.tsx:20`):** `<p>` sem `role="alert"` e "Tentar novamente" como link de texto, em vez de botão secundário.

   **Correção:** libero o ajuste do `PendingPage`, que o orquestrador ofereceu. Ficaria assim:
   - sem rótulo, com `--text-headline`;
   - no ramo de erro, o `.kito-still` e um secundário "Tentar novamente", além de "Voltar ao início";
   - no blog, o 404 cai no ramo "Artigo não encontrado", com o Kito neutro como no `/nao-existe`;
   - a newsletter segue o padrão dos outros erros.

   Nenhum texto novo. Não bloqueia o QA; pode correr em paralelo. Evidência: [`fatia-6/blog-artigo-inexistente-1280.webp`](fatia-6/blog-artigo-inexistente-1280.webp).

## (a) Ajustes da fatia 5

| Ajuste | Status | Evidência medida |
| --- | --- | --- |
| O que se compra em cada passo | RESOLVIDO | **Carrinho:** "Pacote KeyToTwo / 5 jogos. Muitas próximas rodadas. / R$ 19,90". **Gaveta:** "Pacote KeyToTwo / 5 jogos para imprimir / R$ 19,90". **Pagamento:** "Pacote KeyToTwo / 5 jogos. Muitas próximas rodadas. / R$ 19,90 / Download após a confirmação da compra. / Acesso sem prazo de expiração." Tudo vem de `products.ts`, sem copy nova; a regra "Item de compra" está no DESIGN.md |
| Miniatura nos dados | RESOLVIDO | `PurchaseThumbnail({ code })` lê `products.find(…).thumbnail` no carrinho, na gaveta e no pagamento (P001 → página real do J001). Sem imagem, cai na capa tipográfica com o título (`.purchase-thumbnail-type`) |

## (b) Critérios F6

| Critério | Status | Evidência medida (5180) |
| --- | --- | --- |
| F6.1 Erro: uma mensagem + "Tentar novamente" secundário | PARCIAL | **Oferta (P1-5):** uma única mensagem no lugar do preço, "Não conseguimos carregar o preço." (DM Sans 16 px, Tinta suave, `aria-live="polite"`), e **"Tentar novamente" secundário**; a segunda mensagem genérica saiu. **Carrinho, gaveta, Meus jogos e Pedidos:** `role="alert"` "Não foi possível carregar ou salvar os dados. Tente novamente." + secundário (Papel, borda Tinta). **Falta:** os erros de rota e a newsletter (ajuste) |
| F6.2 Compra desabilitada com a razão | RESOLVIDO | Com o catálogo falho, "Adicionar ao carrinho" fica desabilitado em aguada de Tinta, e a razão aparece no mesmo card, no lugar do preço |
| F6.3 Vazio: Kito na caixa sem lágrima | PARCIAL | Carrinho e Meus jogos vazios: Kito na caixa, título, uma frase e **"Quero o pacote"**; Pedidos vazio sem Kito. A única caixa existente (`kito-caixa`) tem lágrima, e o Portão 1 proíbe gerar imagem nova. **Decisão do responsável:** manter a caixa com lágrima nos vazios ou usar a pose neutra (Portão 2) |
| F6.4 Erro, falha de pagamento e 404: Kito neutro | RESOLVIDO | `/nao-existe`: `.kito-still` com 128 px (375) e 160 px (1280), quadro 01 (`background-position: 0 0`), "Página não encontrada" e "Voltar ao início". Confirmação com falha ou expirada: `.kito-still`, "Vamos tentar de novo?" e "Voltar ao carrinho". [`fatia-6/404-1280.webp`](fatia-6/404-1280.webp), [`fatia-6/confirmacao-375-pago-e-falha.webp`](fatia-6/confirmacao-375-pago-e-falha.webp) |
| F6.5 Carregando | RESOLVIDO | Oferta: "Consultando preço…" em corpo e "Consultando disponibilidade…" com `role="status"`. Carrinho: esqueleto com `role="status"` e "Carregando seu carrinho…". Minha área: "Carregando seus dados…". Todos terminam em "…" |
| F6.6 Desabilitado uniforme | ABERTO | `.icon-button:disabled { opacity: .4 }` e setas do carrossel com `.35`, em vez de aguada com Tinta suave. P2, não bloqueia |
| F6.7 Avisos assíncronos anunciados | RESOLVIDO | `role="status"`/`role="alert"` em conta, download, consentimento, pagamento e cupom; preço com `aria-live`. A newsletter está no ajuste |
| F6.8 Celebração | RESOLVIDO | Pago: Kito acenando com `kito-hello` e 10 peças de confete com `confetti-settle`; com movimento reduzido, as duas animações ficam `none`. Também mostra "Pagamento confirmado…", "Também enviamos para o seu e-mail.", o produto e "Baixar agora", ou seja, o que acontece depois |
| F6.9 Barra fixa de compra | RESOLVIDO | A 375 px: escondida na hero, visível na prévia e em "Como funciona" com "Pacote KeyToTwo · R$ 19,90 · Adicionar ao carrinho", escondida na oferta, nas dúvidas e no rodapé |
| F6.10 Freebie em preparação | RESOLVIDO | Fatia 4: etiqueta tracejada, só no `test` |

**Regras gerais e planos:**
- **Foco (G5):** 39 paradas de Tab na home e no carrinho (com item), todas com contorno visível de pelo menos 2 px; nenhuma falha.
- **Movimento reduzido (G6):** na home, o Kito começa parado (`data-running="false"`) na pose 01 com "Retomar animação"; nenhum conteúdo pendente de reveal (opacidade 1); o menu móvel abre sem animação.
- **Plano 003:** a parte (a) foi conferida no build na revisão da fatia 3 (240 ms, 40 ms + 40 ms × ordem, 8 px). A parte (b) não tem mais objeto, porque as setas saíram.
- **P2-11:** RESOLVIDO.

## Itens que o Nanquim declarou fora do escopo

- **Google Sign-In:** aceito. O raio de 6 px é uma forma prevista na diretriz do Google; as cores e a fonte são as do Google.
- **`PendingPage`:** **liberar o ajuste** (ajuste obrigatório acima).
- **e2e i2b e i3-stripe-local:** dependem de Mailpit e Stripe local. Não é design; fica para o QA.

## Recomendações (P2)

- **Desabilitado uniforme (F6.6).**
- **Contador do carrossel (F4.17):** ainda anuncia a cada mudança de posição.
- **Tokens sem uso:** `--space-xs` e `--space-xl`.
- **`carrinho.tsx`:** ainda testa `item.code === 'P001'` para listar o conteúdo; usar `product.contents`.
- **Cupom:** conferir no formulário de pagamento que o campo existe (não verificável sem criar a sessão de pagamento).
