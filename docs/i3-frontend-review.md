# I3-A — checkout no Redesign

2026-10-08. Trabalho sobre `feat/redesign`, backend I3 integrado pelo Costura em `b30bffa`, sem commit de frontend. Porta de desenvolvimento: `http://127.0.0.1:5178`.

## Implementação

- `/carrinho` habilita Finalizar compra apenas com itens válidos, preços e subtotal, sem alertas impeditivos; encaminha a `/pagamento`, protegida por RequireAuth e noindex.
- `/pagamento`: resumo, links para termos/política em nova aba, caixa obrigatória desmarcada e aceite antes de POST/montagem. Desmarcar cancela a requisição pendente e desmonta o formulário. Mudança da versão do carrinho reinicia o aceite. Termos divergentes exigem recarregar e aceitar novamente; erros não viram confirmações simuladas.
- `src/lib/stripe.ts` carrega somente `https://js.stripe.com/dahlia/stripe.js`, sob demanda, com timeout e nova tentativa. Sem dependência/runtime Stripe no bundle. `Stripe(pk, {betas: ['custom_checkout_payment_form_1']})`, `initCheckoutFormSdk`, aparência exata do Studio, `createForm({layout:'expanded'})`, mount/destroy, loadActions e confirm pelo evento do formulário.
- Cupom separado “Tenho um cupom”: `applyPromotionCode`/`removePromotionCode` nas actions carregadas do SDK. Subtotal, desconto e total vêm da sessão Stripe e atualizam antes de pagar. A região do formulário fica inerte durante a atualização. Sem cálculo local do desconto no modo Stripe.
- `/pedido/confirmacao`: paid, processing, pending_payment, failed, expired, not_found e next=other_account. Consulta a API autenticada, nunca usa o retorno do cliente como prova de pagamento. Processing/pending têm até seis novas consultas com recuo (1,5 / 3 / 6 / 10 / 15 / 20 s) e atualização manual. Outra conta não mostra itens e permite sair preservando o destino. Paid atualiza carrinho e conta e oferece Meus jogos.
- Não afirmamos que um e-mail já foi enviado: o backend informa que o envio entra no I4.
- Arquivos principais: `src/routes/{pagamento,carrinho,pedido.confirmacao}.tsx`, `src/components/checkout/`, `src/lib/{stripe,checkout}.ts`, rotas/SEO, CSS e testes E2E. Não alterados: supabase, documentos de contrato, Docker/nginx, Playwright config, package/lock.

## Modo atual e configuração

Depois do merge, o dev 5178 e o build estão em **Stripe real, modo de teste**, com `VITE_CHECKOUT_MODE=stripe` no `.env.local` ignorado. O mock continua disponível apenas por configuração de preview/test e é identificado: não recebe dados de cartão, não chama POST /checkout, não cobra nem libera jogos. `session_id=demo` só é interpretado com mock habilitado e não comprova compra no modo Stripe.

- `VITE_CHECKOUT_MODE=stripe` habilita a integração real; durante a preparação, test/preview sem essa configuração usam mock. Live não permite mock.
- `VITE_TERMS_VERSION`: padrão provisório `rascunho-2026-10-08`, igual ao contrato local. Pendente D11: substituir junto com texto jurídico e TERMS_VERSION do servidor.
- `VITE_STRIPE_PUBLISHABLE_KEY`: copiada **somente essa entrada** do modelo de segredos para `.env.local`, conferido como ignorado pelo git. Nenhum valor registrado. Stage test recusa chave/sessão live.
- Supabase e Auth locais mantidos; nenhuma chave secreta de Stripe/Supabase foi lida ou incluída no frontend.

Return URL local confirmado pelo Ferrolho: 5178. O teste real começa nessa mesma origem para preservar a sessão. O restante do E2E roda contra o build em 4174.

## Verificações executadas

- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0 (também executado em ambos os builds).
- `npm run build`: exit 0 em mock e com `VITE_CHECKOUT_MODE=stripe`; 13 rotas pré-renderizadas, incluindo pagamento; sitemap test vazio/noindex.
- Build Stripe + `npm run test:e2e -- tests/e2e/i3-checkout.spec.ts --workers=2`: 14 PASS na primeira revisão. São fixtures controladas na fronteira Auth/API/Stripe, não pagamento real. Cobre contrato enviado, aceite, cupom inválido/aplicar/remover, desmontagem ao retirar aceite, confirmação, erros de carrinho/termos/provedor e recuo.
- Build Stripe + `npm run test:e2e -- --workers=2`: 68 PASS, 5 skips (I2b local opt-in e cenário exclusivo preview), antes da adição do teste mock e do teste Stripe real opt-in.
- Build mock: uma execução encontrou seletor ambíguo na transição da demonstração para a confirmação. Corrigido escopando o seletor à página de confirmação. Nova execução focal: 11 PASS, 4 skips exclusivos de Stripe.
- A execução completa seguinte coincidiu com o segundo reset autorizado do banco: 59 PASS, 10 skips e 6 falhas de smoke por `/catalog` HTTP 500. Assim que `/catalog` voltou a 200, `npm run test:e2e -- --last-failed --workers=2`: **6 PASS, exit 0**, sem mudar as asserções de console.
- Execução final em mock, após estabilizar a espera do carrinho na fixture: `$env:I2B_LOCAL_QA='1'; npm run test:e2e -- --workers=2`: **69 PASS, 6 skips, exit 0** (55,2 s). Os skips são quatro casos exclusivos do modo Stripe, o pagamento real opt-in e o cenário exclusivo preview. Os quatro testes reais do I2b (Mailpit, senha, carrinho, consentimento, biblioteca/conta) passaram após o reset.
- Responsividade automática da página de pagamento: 320, 390, 768, 1280 e 1440, fonte raiz 16/32 px, sem rolagem horizontal. Mock e fronteira Stripe simulada; iframe real ainda depende do backend.
- Smoke: rotas diretas, H1, noindex e console/hidratação; matriz pública 320/390/1440 e home com texto 200% preservadas.

## Pendente de integração

Após o merge `b30bffa`, o teste real fez login via Mailpit, adicionou o P001 (1990 BRL), aceitou os termos e recebeu **POST /checkout 200**. Falhou antes de preencher cartão: Stripe `payment_pages/.../init` retornou **404 resource_missing, No such checkout.session**. O Ferrolho reproduziu e confirmou que a chave publicável do modelo pertence a outra conta que a secreta usada para criar as sessões. Nenhuma chave foi exibida; somente a entrada publicável autorizada foi lida no modelo.

**Dependência do responsável:** corrigir `VITE_STRIPE_PUBLISHABLE_KEY` no modelo de segredos para a mesma conta de teste do backend. Depois recopiar somente essa entrada para `.env.local` e repetir os dois testes reais. Houve também uma falha transitória `ERR_CONNECTION_RESET` no CDN da Stripe; o teste permite uma tentativa pelo botão de recarregar existente, sempre com o script direto da Stripe.

**4242 e cartão recusado ainda não foram processados, e as duas capturas de sucesso não foram geradas.** O teste `tests/e2e/i3-stripe-local.spec.ts` cobre aprovação e recusa em contas novas, com cupom; seus seletores internos ainda aguardam a chave correta. Diretório planejado (não evidência existente): `D:/Maestri/qa/keytotwo-i3/`.

Verificação após o merge e habilitação real: lint, typecheck e build **exit 0**; `$env:I2B_LOCAL_QA='1'; npm run test:e2e -- --workers=2`: **72 PASS, 4 skips, exit 0** (58,3 s). Skips: mock, preview e os dois pagamentos reais opt-in. O checkout dessa suíte é validado por fixtures de fronteira; não deve ser confundido com pagamento na Stripe.

Com integração pronta: `$env:I3_STRIPE_QA='1'; npm run test:e2e -- tests/e2e/i3-stripe-local.spec.ts --workers=1`. Exercita código Mailpit → carrinho → aceite → aplicar/remover/reaplicar TESTE10 → cartão 4242 de teste → retorno → biblioteca e carrinho vazio. Sem trace, vídeo, HAR ou screenshots de dados de pagamento. Repetir I2b com `$env:I2B_LOCAL_QA='1'` após o reset.

`STRIPE_INTEGRATION_TODO.md` permanece sob autoria do Ferrolho no floor I3: preservar no merge, sem criar cópia divergente. Permanecem naquele documento CSP do nginx, HTTPS do ambiente remoto, webhook/túnel, teste real, validação jurídica e configuração live.

Fontes: nota autorizada **Stripe Checkout Studio** e `docs/api-contract.md` v0.3 do floor I3; tipos oficiais [Checkout SDK](https://github.com/stripe/stripe-js/blob/master/types/stripe-js/checkout.d.ts), [Checkout Form](https://github.com/stripe/stripe-js/blob/master/types/stripe-js/elements/payment-form.d.ts) e [cupons](https://docs.stripe.com/payments/advanced/discounts). Suporte e setup centralizados no TODO do backend: [Stripe Support](https://support.stripe.com/) e [Stripe MCP](https://docs.stripe.com/mcp).
