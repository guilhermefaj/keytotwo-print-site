# Loja — evidências do I4

Direção vigente: `DESIGN.md`, Folha de recorte. A Loja usa Papel, Tinta, linhas turquesa decorativas, capas tipográficas e a prévia real já aprovada do J001. Nenhuma arte foi gerada. A home mantém apenas a oferta dos pacotes até o I7; menu e rodapé aguardam I6.

As capturas WebP são produzidas por `tests/e2e/shop.spec.ts`, com Playwright e conversão Sharp, em 375 e 1280 px. Os arquivos `test-*` usam respostas sintéticas de `/catalog` nos testes: R$ 9,90 para J001 e R$ 19,90 para P001, ambos identificados como valores de teste. Não são preços aprovados para live. Os arquivos `preview-*` exibem os produtos sem preço ou ação de compra.

Reprodução: build no stage escolhido e `E2E_PORT=4174 SHOP_CAPTURE=1 npx playwright test tests/e2e/shop.spec.ts --workers=1`. PowerShell: definir as variáveis com `$env:` antes do comando.

Verificações: axe WCAG 2/2.1/2.2 AA nas três páginas em 375/1280; overflow em 320/375/768/1024/1440 com texto 200%; estados de catálogo ausente, carregamento, erro/retry e preço ausente; páginas e metadados no prerender; slugs desconhecidos na 404 existente. O detector Impeccable não identificou desvios nos arquivos da Loja.

Limite de publicação: prerender e sitemap usam `availability: sale` do conteúdo. A presença no `/catalog` confirma disponibilidade na tela, sem conceder venda apenas por existir HTML. Produtos editoriais `soon` não recebem página. O P001 fica em breve quando o backend o omite pela completude; o preço real do J001 segue pendente e bloqueia release live.
