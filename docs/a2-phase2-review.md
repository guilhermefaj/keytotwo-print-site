# A2 — fase 2: conversão

2026-10-08, floor Redesign. Sem commit. Skills aplicadas: frontend-design, web-design-guidelines e copywriting.

- Experiência imediatamente abaixo da hero: páginas 1–3 reais do J001 e Kito tabuleiro; a legenda identifica três páginas de um jogo. Mesmas páginas na oferta, sem capas fictícias.
- Pacote KeyToTwo vem de `src/content/products.ts`, inclusive carrinho, pagamento, pedidos e referências na biblioteca. Preço consultado no catálogo, com Valor de teste; preview mantém Preço em breve. Não foram definidos preço comercial, jogos faltantes nem prova social.
- Confiança junto da oferta/carrinho/pagamento: Stripe, confirmação, e-mail, ajuda e política. Aceite abre o formulário automaticamente. Desmarcar aborta a requisição e desmonta o formulário; erro não fabrica sucesso. Cupom sempre visível quando o SDK está pronto.
- Botão Continuar com Google conserva o OAuth existente e usa o G oficial e Google Sans Medium, hospedados localmente. Fontes: https://developers.google.com/identity/branding-guidelines ; imagem https://developers.google.com/static/identity/images/g-logo.png ; fonte fornecida por https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&text=Continuar%20com%20Google . Subset apenas do rótulo. Nenhum fluxo Google real foi autenticado neste QA.
- Ilustrações reais nos pilares. Barra mobile aparece após a hero e se esconde na oferta, rodapé, menu, foco externo, teclado ou altura insuficiente. O teste confirma CTA para entrar preservando P001 e destino.
- Atlas WebP com pixels RGBA idênticos; PNG antigo removido do que é servido. Mesmos 12 quadros/10 FPS/ciclo 1,2 s e velocidades. Inventários atualizados pelo preparo.
- Revisão sênior Guache: aprovado após corrigir quatro tamanhos de texto. `/pedido/confirmacao` consta na área logada do header. Alterações dele preservadas.

## Verificações executadas

- `npm run lint`: exit 0.
- `npm run typecheck` e `npm run build`: exit 0; prerender de todas as rotas.
- `npm run test:e2e -- --workers=8`: **83 passed, 17 skipped**, exit 0. Inclui matriz 320/390/768/1280/1440, texto dobrado em cada elemento, pagamento ao aceite, abortar/reaceitar, erros, cupom, confirmação e barra mobile. Skips: integrações opt-in, stage preview e I4/I5 reais ainda não habilitados nesta fase.
- `npm run verify:hero`, build 4174: **PASS**, movimento/reduced motion, teclado, pausa/retomada, fora de vista, aba oculta, loop completo, contraste/axe e matriz. Relatório: `D:/Maestri/qa/keytotwo-a2/hero/report.json`.
- `node scripts/measure-conversion-media.mjs`: **943.604 bytes HTTP**, desktop e mobile, imagens/fontes sem cache antes de rolar, incluindo o que o lazy loading nativo antecipa. Meta de 500 KB **não atingida**. Antes: 1.430.259; redução total de 34%. Só o atlas exato: 492.982. Não reduzi quadros/resolução/pixels para forçar o limite.
- Inspeção das capturas de experiência desktop, pilares mobile, oferta mobile e login desktop. Ajustados alinhamento dos pilares e margens das páginas rotacionadas após a primeira rodada. Não é aprovação visual do responsável.

Capturas fora do git: `D:/Maestri/qa/keytotwo-a2/home-1440.png` e `home-390.png`; `hero-1440.png`, `hero-390.png`, `experience-1440.png`, `experience-390.png`, `offer-1440.png`, `offer-390.png`, `pillars-390.png`, `login-desktop.png`.

Pendências: preço/nome comercial/textos legais/prova social para release; meta de mídia; aprovação visual e 4242/recusa reais, bloqueados pela chave publicável de outra conta. A integração I4/I5 real é verificada em seguida, separadamente.

Após integrar I4/I5 reais: suíte final **94 passed / 6 skipped**, detalhes em [i4-i5-real-integration.md](i4-i5-real-integration.md). Medição final contra o build 4174: **942.704 bytes HTTP**, desktop e mobile, ainda acima da meta; o valor 943.604 acima corresponde ao dev 5178.
