# Revisão da fatia 2 — cabeçalho e rodapé (Prumo, 2026-10-10)

**Veredito: APROVADA COM AJUSTES.** O cabeçalho cumpre o Portão 1:
- "O pacote" e "Quero o pacote" levam à oferta.
- "Ajuda" tem o mesmo peso dos outros links.
- A Minha área ganhou o cabeçalho simplificado, também no menu móvel.
- Teclado e foco seguem corretos.

Faltam três coisas obrigatórias: o plano 003 do menu (que pertence a esta fatia), a linha de recorte fora das páginas privadas e o rótulo da gaveta vazia.

| | |
| --- | --- |
| Commit revisado | `67c66c5` (`git diff 286e90b..67c66c5`: `SiteHeader.tsx`, `SiteFooter.tsx`, `CutLine.tsx`, `site.ts`, `navigation.css` +2, `styles.css` rodapé, testes d1/d2) |
| Antes / depois | http://127.0.0.1:5178 / http://127.0.0.1:5180 (a API local já aceita a origem 5180; as medidas usam dados reais) |
| Critérios | [checklist](../2026-10-checklist-fatias.md), seções G e F2 |
| Contagem (critérios F2) | **RESOLVIDO 6 · PARCIAL 1 · ABERTO 3** |
| Achados da auditoria | P2-6 RESOLVIDO; P1-2 PARCIAL; P2-11 / A003 continua PARCIAL |

## Ajustes obrigatórios

1. **Plano 003a, menu móvel lento (F2.4, P2-11).** Os links ainda entram em **0,4 s**, com atraso de 60 ms + 50 ms × ordem e 16 px de deslocamento: medido no menu público e no privado a 375 px. O plano 003 é desta fatia e o DESIGN.md já registra o alvo: `navigation.css`, linhas `d1-link` com 240 ms, `calc(40ms + var(--link-order, 3) * 40ms)` e `translateX(8px)`.
2. **Linha de recorte nas páginas privadas e no checkout (F2.8).** A `CutLine` entra no rodapé em **todas** as rotas, inclusive `/carrinho`, `/pagamento`, `/meus-jogos`, `/pedidos` e `/conta` (medido: `cut-line` = 1 e tesoura presente nas 10 rotas). O DESIGN.md diz: "não dentro de uma folha, não em páginas privadas".
   - **Correção:** renderizar a `CutLine` só quando `publicFooter` for verdadeiro (a mesma lista que já esconde a newsletter em `SiteFooter.tsx`); nas demais rotas, `border-top: var(--line-rule)`.
   - **Evidência:** [`fatia-2/conta-1280-rodape-linha-de-recorte.webp`](fatia-2/conta-1280-rodape-linha-de-recorte.webp).
3. **"Conhecer o pacote" na gaveta vazia (F2.1, P1-2).** O Portão 1 manda sumir com esse rótulo, mas a gaveta vazia, aberta pelo cabeçalho, ainda o mostra, para visitante e logado (`CartDrawer.tsx:42`). Trocar por "Quero o pacote" → `/#comprar`. Se o orquestrador preferir tratar todos os vazios juntos, mover para F6.3, onde também estão `PurchaseUi.tsx:11`, `meus-jogos.tsx:28` e `pedidos.tsx:12`.

A regressão do logo do rodapé (F2.7) vem da fatia 1 e continua no commit `67c66c5`. A correção já está no checkout, ainda sem commit (`.footer-brand .brand img { width: 178px }` e 150 px no celular; medido em 178 px no 5180). Confiro no commit de ajustes.

## Critérios da fatia 2

| ID | Status | Evidência medida (5178 → 5180) |
| --- | --- | --- |
| F2.1 Um nome por ação | PARCIAL | **Cabeçalho:** "O pacote" ia para `/#experiencia` e agora vai para **`/#comprar`**; clicar nele leva a `/#comprar` com a oferta no topo (88 px) e o preço visível. O CTA "Quero o pacote" vai para `/#comprar`; logado e dono do pacote, mostra "Meus jogos". **Menu:** mesmos destinos. **Rodapé:** "Escolher nosso encontro" virou **"Quero o pacote"** e "Conta" virou "Minha conta". **Falta:** a gaveta vazia (ajuste 3). Ficam para as fatias 3–6: "Escolher nosso encontro" na hero, na prévia, no fechamento e no post; "Conhecer o pacote de jogos" em `/blog` |
| F2.2 "Ajuda" no mesmo peso | RESOLVIDO | Era 13 px, peso 400, Tinta suave; agora **15 px, peso 400, Tinta**, igual aos outros links. Na página ativa, peso 600 com sublinhado |
| F2.3 Minha área simplificada | RESOLVIDO | Em `/meus-jogos`, `/pedidos` e `/conta`: nav com "Meus jogos · Minha conta · Ajuda" (`aria-current="page"` correto), à direita só o menu da conta, sem CTA e sem carrinho (`data-private="true"`). No menu móvel: os mesmos 3 links, conta só com "Sair", sem botão e sem a "Ajuda" duplicada. [`fatia-2/conta-1280-cabecalho-antes-depois.webp`](fatia-2/conta-1280-cabecalho-antes-depois.webp), [`fatia-2/menu-375-privado-antes-depois.webp`](fatia-2/menu-375-privado-antes-depois.webp) |
| F2.4 Menu móvel (A003a) | ABERTO | Ajuste 1 |
| F2.5 Hover de deslocamento só com ponteiro fino (A003b) | RESOLVIDO | Sem objeto: a fatia 1 removeu todas as setas e o hover de seta |
| F2.6 Cabeçalho Céu → Papel | RESOLVIDO | **Home, no topo:** fundo transparente sobre o Céu da hero, sem sombra. **Depois de rolar 500 px:** Papel a 94 %, desfoque de 12 px e sombra de cabeçalho. **Em `/ajuda`:** Papel desde o início. Altura de 64 px; logo de 146 px. [`fatia-2/home-1280-cabecalho-rolado-antes-depois.webp`](fatia-2/home-1280-cabecalho-rolado-antes-depois.webp) |
| F2.7 Logo do rodapé | ABERTO no commit | Regressão da fatia 1; a correção está no checkout, sem commit (ver acima) |
| F2.8 Linha de recorte só entre folhas públicas | ABERTO | Ajuste 2 |
| F2.9 `/pagamento` em modo foco | RESOLVIDO | Já existia e continua igual: logo, "Compra segura", "Voltar ao carrinho", sem nav (escritas bloqueadas, nada pago) |
| F2.10 Escape e `overscroll` | RESOLVIDO | Menu (público e privado) e gaveta (visitante e logado): Escape fecha e o foco volta ao gatilho ("Abrir menu" e "Carrinho, 0 itens"). `overscroll-behavior: contain` nos dois painéis |

**Regras gerais:**
- **G4:** axe sem violações em `/conta` (1280) e no menu aberto (375).
- **G5:** Shift+Tab do rodapé ao topo de `/ajuda` não deixou nenhum foco sob o cabeçalho fixo; o "Pular para o conteúdo" fica acima do cabeçalho (`z-index` 100).
- **G1:** a copy alterada é só a aprovada no Portão 1 ("Quero o pacote", destinos e lista da Minha área); "Minha conta" foi confirmado pelo orquestrador.

## Recomendações (P2, não bloqueiam)

- **Vigia de seção:** depois da oferta, "O pacote" continua marcado como `aria-current="location"` sobre Dúvidas e o fechamento (medido ao rolar até `#duvidas`). Era assim antes. Sugestão: incluir `duvidas` em `homeSections` sem link associado, para limpar o estado.
- **Menu da conta repete a navegação na Minha área:** no desktop, o menu do avatar repete "Meus jogos" e "Minha conta", que já estão na nav; no celular, a fatia deixou só "Sair". Alinhar o desktop ao celular.
- **Tracejado sob o bloco da conta no menu (`.sheet-account`):** é divisória de painel, então deveria ser régua de Tinta (F5.9).
- **"Conta" × "Minha conta" na aba e no h1:** já decidido pelo orquestrador para a fatia 5; não conto aqui.

## Ambiente e método

- **O 5180 servia trabalho não commitado:** os ajustes da fatia 1 (tokens de tipo, logo do rodapé) e a fatia 3 (hero). `SiteHeader.tsx`, `SiteFooter.tsx` e `CutLine.tsx` não tinham alteração local; em `navigation.css`, a alteração local só troca valores literais por tokens de mesmo valor computado. As medidas de cabeçalho, menu, gaveta e rodapé valem para `67c66c5`, exceto o logo (F2.7).
- **Ferramentas:** Playwright com axe. Medi estilos computados, `href` e `aria-current`, o vigia de seção rolando até cada âncora, o clique em "O pacote", Escape e foco nos dois painéis, e Shift+Tab sob o cabeçalho fixo. Escritas na API bloqueadas no navegador de teste, nada pago.
- **Não rodei o e2e:** ele exige `npm run build` no checkout compartilhado, onde o Nanquim está trabalhando. O relatório da fatia informa 90 testes passando e 2 pulados.
