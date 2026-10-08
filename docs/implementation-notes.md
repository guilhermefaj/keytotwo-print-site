# Hero Kito: decisões e limites do incremento

Implementação da Tarefa 2, atualizada pelas Tarefas 3B/3C em `feat/hero-kito`. Autor: Aquarela. Sem commit ou push; integração pelo Costura após QA independente.

## Escopo entregue

- Preview em `/preview/hero`, também renderizado na raiz para o portal. Identificado visualmente como protótipo e com `noindex, nofollow`.
- Copy da hero preservada. `Ver pacote`, `Conhecer os jogos` e `Os 5 jogos` abrem demonstrações com estados pendentes explícitos.
- `Como funciona`, `Entrar`, jogo gratuito e blog omitidos: não há destinos implementados. Nenhum `href="#"`.
- Menu mobile baseado no Sheet do shadcn/ui/Radix; painéis com `<dialog>` nativo. Escape, contenção de foco, leitura inicial e retorno ao acionador.
- Céu uniforme, header opaco, título Bricolage Grotesque 700, corpo DM Sans 400/600. Tokens do briefing continuam propostos, não aprovados como identidade global.
- Originais usados separados dos assets públicos. SVG/CSS de chão e vegetação distante próprios; recortes da paisagem nas bordas, sem transformar o original em tile.
- Caminhada com quatro quadros oficiais RIGHT da revisão 2: [resultado e limites](kito-walk-review.md). Folhas x2/x3, troca de poses e deslocamento em camadas CSS independentes, sem atualização React por quadro.

## Pendências visíveis

A composição e a oferta final do P001, dois jogos, preço, arquivos, condições comerciais e integração dos destinos ficam pendentes. Não são inferidos no protótipo. Sem banco, pagamento ou serviços de arquivos neste incremento.

A caminhada usa apenas a arte oficial fornecida, com pausa/retomada, movimento reduzido com escolha explícita para iniciar, suspensão fora de vista, em aba oculta e com menu/painel aberto. A pausa manual prevalece sobre o retorno à página. O perfil e os quatro quadros substituem a proposta inicial de três quartos com 6–8 quadros; o rig da tentativa interrompida foi removido. O ajuste de velocidade é médio: os dois recuos das solas são diferentes, portanto não se afirma contato fisicamente imóvel em todos os quadros.

## Verificação

O script `scripts/verify-hero.mjs` executa Chromium e axe. Compara a largura do documento, caixas de conteúdo e separação entre a nota e a cena em 320×800, 390×844, 768×1024, 1280×720 e 1440×900. Repete a matriz com **todos os tamanhos computados de fonte multiplicados por dois**, preservando dimensões do viewport (emulação de zoom somente de texto). Isso não equivale a uma verificação manual do zoom nativo de todos os navegadores.

O mesmo script mede normal/hover/active/focus de cinco famílias de controles, valida teclado e foco, acompanha um loop real inteiro em cada escala e verifica a imobilidade das duas animações quando pausadas. Movimento reduzido começa no quadro 01 da mesma folha; Enter permite iniciar. O teste de aba oculta usa Chromium headless isolado via CDP nativo, pois a emulação de foco padrão do Playwright mascara a visibilidade. Não sobrescreve visibilityState nem injeta visibilitychange. Gera capturas e mede Resource Timing em páginas novas sem cache. Relatórios e capturas ficam fora do versionamento.

A página cresce verticalmente quando precisa. Em 320 px e 1280×720 pode haver rolagem vertical; não há altura fixa que esconda conteúdo. A meta de mídia inclui as seis imagens WebP e as três fontes WOFF2 efetivamente transferidas; não inclui JavaScript/CSS.

## Fontes técnicas de implementação

- [Vite: host, porta e strictPort](https://vite.dev/config/server-options).
- [Tailwind: plugin para Vite](https://tailwindcss.com/docs/installation/using-vite).
- [shadcn/ui: Sheet](https://ui.shadcn.com/docs/components/radix/sheet), adaptação da [registry new-york](https://ui.shadcn.com/r/styles/new-york/sheet.json), licença MIT; somente o menu utiliza essa base.
- [Chrome DevTools Protocol: emulação de foco](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled), razão para testar a visibilidade em navegador isolado sem essa emulação.
