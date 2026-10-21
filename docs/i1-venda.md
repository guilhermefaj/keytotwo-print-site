# I1 — página de venda estática

Implementação no floor `feat/i1-venda`, a partir de `59397be`. Sem alteração dos arquivos de arte ou da animação do Kito.

## Conteúdo e decisões

- Fontes consultadas: nota Maestri **Plano do site P1** (I1, ajustes e decisões do responsável); notas **Site - Estrutura e taxonomia**, **P001 - Pacote inicial de 5 jogos**, **J001 - Rabisque e Adivinhe** e **Site - Direção visual**, na base KeyToTwo Print.
- A decisão recebida durante a tarefa prevalece sobre a taxonomia anterior: carrinho com vários itens e pagamento Stripe, compra somente com cadastro, entrega em Meus jogos e por e-mail, acesso sem expiração. Não há backend ou carrinho funcional neste incremento.
- Conteúdo centralizado em `src/content/`. `pending()` mantém o marcador textual `PENDENTE`, inclusive no HTML pré-renderizado. Nome comercial, preço, condições não decididas, dois jogos, prévias e textos legais permanecem pendentes. As características de J001 não são atribuídas aos demais jogos.
- Não foram criadas imagens de jogos nem publicadas páginas do PDF pago. A prévia pública autorizada continua pendente.
- A condição **não há reembolso após a liberação do download** aparece na oferta, FAQ, Ajuda e políticas. A redação final e a validação jurídica continuam explicitamente pendentes.
- `PreviewPanel` foi removido. Os links levam às seções e páginas reais. Blog e jogo gratuito não aparecem por falta de conteúdo publicado.
- O ajuste 1 do **Plano do site P2**, recebido durante a tarefa, substitui o ajuste anterior: Entrar continua visível, mas todos os acessos ao carrinho ficam ocultos em preview. A contagem estática acessível e os links para a estrutura aparecem apenas em test/live; o carrinho funcional pertence ao I2b.
- `/carrinho` é uma casca privada com noindex, estrutura da lista e estado vazio, sem itens fictícios, armazenamento ou pagamento. A condição de não reembolso aparece antes de Finalizar compra, que encaminha a `/entrar?next=%2Fcarrinho` conforme P2; a autenticação e a proteção com RequireAuth pertencem ao I2b. Nenhum dado privado é servido nesta casca.
- Adicionar ao carrinho fica oculto até o I2b: não há botão inerte nem simulação de inclusão de itens. O estado Oferta em preparação explica a pendência. `src/content/products.ts` fornece a lista de produtos ao componente; a única entrada é o P001.

## Execução e SEO

`npm ci`, `npm run dev` → `127.0.0.1:5175`, com porta estrita. Os servidores 5173 e 5174 foram preservados.

`site.config.json` define `https://keytotwo.com.br` e stage `preview`; `VITE_SITE_URL` e `VITE_SITE_STAGE` sobrescrevem esses valores. A URL aceita apenas uma origem HTTP(S), sem caminho ou credenciais; live exige HTTPS.

`npm run build` roda typecheck, pré-renderização e `scripts/seo-files.mjs`. Fora de live, todas as páginas têm noindex, robots bloqueia rastreamento e o sitemap fica vazio. Em live, apenas `/`, `/ajuda`, `/termos`, `/privacidade` e `/reembolsos` entram no sitemap. Carrinho, entrada, páginas privadas, confirmação, preview e 404 continuam noindex. Metadados incluem title, description, canonical e Open Graph. **Atualização (SEO, 2026-10-22):** cada página tem imagem de compartilhamento 1200×630 (`og:image` e `twitter:card` `summary_large_image`): a capa do produto na página dele, a de Hora dos Artistas em `/gratuitos` e a da Coleção nas demais (`public/media/og`, gerada por `scripts/prepare-og-images.mjs`). Há JSON-LD de organização e site na home e de produto (com o preço aprovado em BRL) e trilha de navegação nas páginas de produto; avaliação nunca, sem relatos reais. As páginas de produto usam o nome na URL (`/loja/colecao-fundadores`, `/loja/rabisque-e-adivinhe`, `/loja/tabuleiro-da-sorte`, `/loja/o-sumico-de-rapadura`), e o nginx redireciona as antigas com código (`/loja/p001`…) com 301. Em live, o sitemap traz também a Loja, os produtos, Gratuitos e o Blog.

O bloqueio de publicação live com conteúdo pendente pertence ao `check-release` do Costura. O script SEO não aprova conteúdo nem substitui esse bloqueio.

## Verificações executadas

- `npm ci`: exit 0, 245 pacotes, zero vulnerabilidades reportadas pelo npm.
- `npm run lint`: exit 0.
- `npm run build`: exit 0, incluindo `npm run typecheck` com exit 0; 12 rotas pré-renderizadas e fallback SPA.
- `npm run test:e2e`: exit 0, **37 passed**. O smoke existente só recebeu a nova rota `/carrinho`.
- `node dist/i1-qa/verify-public.mjs`: PASS. Title, description e canonical únicos nas 12 rotas, lidos do HTML gerado; 287 destinos internos/âncoras válidos; nenhum `href="#"`; zero erros de página/console.
- A mesma checagem cobriu 70 combinações: sete páginas (`/`, `/preview/hero`, Ajuda, três políticas e Carrinho), larguras 320/390/768/1280/1440, texto 100%/200%, com os detalhes expandidos. Sem rolagem horizontal. As cinco demais rotas também passaram em 390 px.
- Teclado: menu abre com Enter, fecha com Escape e devolve foco; navegar pelo menu foca a oferta; FAQ alterna com Enter/Space. Finalizar compra leva a Entrar. A checagem confirma ausência de Adicionar ao carrinho e links de carrinho em preview, e somente P001 na lista.
- Script de robots/sitemap executado em pastas isoladas para preview, test e live: bloqueio e sitemap vazio nos dois primeiros; cinco URLs públicas no último. O build entregue continua em preview. Não foi executado um build completo live.

Artefatos não versionados: `dist/i1-qa/report.json`, `lint.log`, `e2e.log`, `verify-public.mjs`, `home-390.png` e `home-1440.png`. Capturas conferidas apenas quanto à composição geral; aprovação visual fica com o responsável.

O `verify:hero` legado não foi executado nesta tarefa. Ainda contém expectativas dos painéis de demonstração removidos e precisa ser adaptado no QA; este incremento foi verificado pelo smoke e pela checagem acima. O carrinho funcional, login, Stripe e envio por e-mail aguardam os próximos incrementos.
