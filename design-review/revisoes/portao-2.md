# Revisão do Portão 2 — marcas de corte retiradas, decisões finais e A9 (Prumo, 2026-10-14)

**Resumo final:**
- **Commits:** `5d8d581`, `f27cba8` e `5ffd538` aprovados, sem ajustes.
- **Portão 2:** os 6 itens da lista estão decididos (seções 3 e 4).
- **Pendência de design:** só o post inexistente do blog, que está com a Lupa.

**Veredito: APROVADO, sem ajustes.**
- **Marcas de corte:** a condição do responsável está cumprida. Não sobrou nenhuma marca de corte (`.crop-marks`, L nos cantos) em nenhuma rota, nem no código.
- **Resto do site:** nada mais mudou além da etiqueta do freebie, que agora diz "Em preparação" (copy aprovada).
- **Kito com lágrima:** a caixa continua nos vazios, por decisão do responsável.

| | |
| --- | --- |
| Commits revisados | `5d8d581` (pai `5ffd538`), seções 1 a 3; `f27cba8` e `5ffd538`, seção 4. O 5180 serve o HEAD |
| Método | **Código:** `git grep` em `HEAD`. **Navegador:** varredura do DOM e do CSS no 5180, com 16 rotas a 375 e 1280 px (32 páginas). Carrinho e confirmação simulados com `page.route`, escritas bloqueadas, nada pago. **Imagem:** diferença de pixels entre as capturas antes e depois do Nanquim em `fatias/7-portao-2` |
| Resultado | **0 marcas de corte** · **0 mudanças fora do escopo** |

## 1. Nenhuma marca de corte

| Onde | Evidência medida |
| --- | --- |
| Código | **`src/styles.css`:** as 4 regras de `.crop-marks` e o token `--crop-size` saíram. **Componentes:** `PackageGames.tsx` e `OfferSection.tsx` não usam mais a classe. **Docs:** `DESIGN.md` não tem mais a seção "Marcas de corte" nem as menções em Tinta, Layout, Forma e Folha. A narrativa de `.impeccable/design.json` e a passagem também foram corrigidas. `git grep -i "crop\|marcas de corte"` em `src`, `DESIGN.md` e `.impeccable` não acha nada; na passagem, só o registro "retiradas no Portão 2" |
| DOM, todas as rotas | `/`, `/blog`, `/blog/exemplo-como-publicar`, `/ajuda`, `/termos`, `/privacidade`, `/entrar`, `/jogo-gratuito`, `/email/preferencias`, `/nao-existe`, `/carrinho`, `/pagamento`, `/meus-jogos`, `/pedidos`, `/conta` e `/pedido/confirmacao` (pago), a 375 e 1280 px. Em todas: **0 elementos com classe `crop`, 0 regras CSS com `crop`**, nenhuma rolagem horizontal e nenhum erro de console |
| Pseudo-elementos com borda | Os únicos `::before`/`::after` com borda visível em todo o site são **3 linhas, nenhuma em L**: a linha de recorte (`.cut-line::before`, tracejado turquesa), o pontilhado da ficha (`.ficha > div::after`) e a régua das listas (`li::after`, 1 px a 18 %) |
| Folha e oferta na home | **Folha:** `.games-carousel.folha` sem borda própria; só as calhas tracejadas entre as cartas, padding de 18 px (10 px no celular). **Oferta:** `.offer-summary` mantém só a borda do card prevista no DESIGN.md (2 px Turquesa J001, raio de 14 px), sem nenhum canto de Tinta. Ver [`portao-2/home-1280-folha-oferta-freebie.webp`](portao-2/home-1280-folha-oferta-freebie.webp) e [`portao-2/home-375-folha-oferta-freebie.webp`](portao-2/home-375-folha-oferta-freebie.webp) |

**Efeito colateral conferido:** as marcas davam `position: relative` à folha e à oferta. Hoje as duas ficam `static`, e nenhum filho delas se posiciona com `absolute`. Nada se deslocou: as páginas antes e depois têm a mesma altura.

## 2. Nada mais mudou

**Diff do commit:** 11 arquivos. Além da documentação e das 4 capturas, ele só toca:
- a classe nos 2 componentes;
- as 5 linhas de CSS;
- a etiqueta e o comentário do freebie em `experience.ts`, onde o campo `proposal` saiu e a condição em `OfferSection.tsx` passou a ser só `stage === 'test'`. No `test` o bloco continua aparecendo; no `preview` e no `live`, continua ausente, igual a antes.

**Diferença de pixels** entre as capturas antes e depois do Nanquim:

| Captura | Altura antes = depois | Áreas diferentes |
| --- | --- | --- |
| `home-1280` | 6023 = 6023 px | 4 quadrados de 18×18 px (cantos da folha e da oferta) + a faixa da etiqueta do freebie |
| `home-375` | 6986 = 6986 px | os mesmos 4 cantos + a etiqueta (mais 1 pixel isolado de compressão) |

Fora isso, as capturas são idênticas: hero, textos, cartas, preço, botões e rodapé.

## 3. Decisões do Portão 2 registradas

- **Marcas de corte:** retiradas do site, do DESIGN.md, do sidecar e da passagem (condição do responsável). Ficam a tesoura (três cortes), o tracejado das cartas e a ficha.
- **Freebie:** copy aprovada. A etiqueta virou "Em preparação". O bloco continua só no stage `test` até existir o resgate no backend.
- **P2-5, Kito com lágrima nos vazios:** **ACEITO**. O responsável mantém a caixa com lágrima nos vazios. Erro, falha de pagamento e 404 seguem com a pose neutra.
- **P2-8, exceção do atlas:** **ACEITO**. O responsável aprovou 976 KB na carga da home, contra a meta de cerca de 500 KB.

O [balanço final](../2026-10-balanco-final.md) foi atualizado com essas decisões.

## 4. A9: decisões finais e os dois commits que faltavam

**Decisões dos itens pendentes do Portão 2** (repassadas pelo orquestrador):
- **Item 2, rótulos e textos dos pilares removidos:** **aprovado**. O responsável aprovou o resultado visual, e a remoção estava na lista apresentada a ele.
- **Item 4, relatos reais:** **ficam com o responsável**, que os envia quando tiver. Até lá, os de exemplo aparecem só no stage `test`, e a seção some no `live`.
- **Item 6, repetição de "após a confirmação" na oferta:** **adiada** para uma limpeza de copy depois do merge, com aprovação do responsável. O P2-10 passa a ACEITO (adiado), com a pendência registrada.

**Veredito: `f27cba8` e `5ffd538` APROVADOS, sem ajustes.** Medi no 5180, a 375 e 1280 px. O erro de rota foi simulado trocando, só no navegador, o módulo da rota `/ajuda` por um que lança erro ao renderizar. O erro da newsletter foi simulado com 503 em `api/account`. A adição de item foi simulada com `page.route`, sem escrita na API.

### `f27cba8`: erros de rota e newsletter

| Critério | Status | Evidência medida |
| --- | --- | --- |
| `PendingPage` sem rótulo, com token | RESOLVIDO | 0 `.eyebrow`. O h1 em Bricolage usa `--text-headline` (34 px a 375, 52 px a 1280) e o `style` literal saiu; a classe `.pending-page` substitui os utilitários |
| Erro de rota: Kito neutro + "Tentar novamente" secundário | RESOLVIDO | `.kito-still` com 128 px (375) e 160 px (1280), quadro 01 (`0 0`). Mensagem com `role="alert"`. "Voltar ao início" (primário) e "Tentar novamente" (secundário: Papel, borda Tinta), ambos com 50 px. No 404 o botão de repetir não aparece. Foco de 3 px nos dois botões, axe sem violações e nenhuma rolagem horizontal. [`portao-2/a9-erro-rota-e-newsletter-1280.webp`](portao-2/a9-erro-rota-e-newsletter-1280.webp) |
| Erro da newsletter | RESOLVIDO | No rodapé, logado e com a conta falhando: `.data-error`, mensagem "Não conseguimos abrir sua preferência agora." com `role="alert"` e "Tentar novamente" como `button-secondary` (50 px, raio de 6 px). Não sobrou nenhum botão de texto. [`portao-2/a9-erro-rota-newsletter-carrinho-375.webp`](portao-2/a9-erro-rota-newsletter-carrinho-375.webp) |
| Post inexistente do blog | ABERTO (fora do commit, com a Lupa) | `/blog/nao-existe` ainda mostra "Não foi possível abrir este artigo", sem o Kito. O `ErrorBoundary` de `blog.post.tsx` não mudou. É bug funcional, que já está no QA |

### `5ffd538`: gaveta do carrinho

| Critério | Status | Evidência medida |
| --- | --- | --- |
| Retorno do login para `/carrinho?add=P001` | RESOLVIDO | 0 diálogos abertos e "Finalizar compra" visível. A URL fica limpa (`/carrinho`), e a própria página avisa "Produto adicionado ao carrinho." com `role="status"`: quem compra recebe o retorno sem ter nada cobrindo a ação seguinte |
| Fora do carrinho, nada mudou | RESOLVIDO | Na home, "Adicionar ao carrinho" continua abrindo a gaveta com o item, o total e "Finalizar compra" |

### Recomendações (P2, sem bloquear)

- **Botão do carrinho no cabeçalho, em `/carrinho`:** clicar nele ainda abre a gaveta por cima da própria página do carrinho, o mesmo conteúdo duas vezes. Em `/pagamento` o cabeçalho não tem o botão. Sugestão: em `/carrinho`, o botão fica inerte, com `aria-current="page"`, ou leva ao topo da página.
- **`HydrateFallback`:** o "Carregando" que vem do `PendingPage` não tem `role="status"` nem as reticências que os outros estados de carregamento usam (F6.5). No dev, as rotas privadas mostram o próprio estado ("Verificando acesso", com `role="status"`), então isso só aparece no build. Conferi pela leitura do código.
