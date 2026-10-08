# I4-A — entrega no Redesign

2026-10-08. Frontend em `feat/redesign`, sobre `b30bffa`, sem commit. Contrato consultado: `docs/api-contract.md` v0.3.1 do floor `feati4-entrega`, seções 6.7–6.9, e esclarecimentos do Ferrolho. Nenhum arquivo do backend foi alterado.

## Implementação

- Meus jogos mantém a compra e oferece um único **Baixar PDF** por jogo, escolhendo `files.find(kind === 'pdf')`; formato e tamanho aparecem discretamente. Sem arquivo publicado, mostra preparação e ajuda.
- Cada clique pede uma URL nova a `POST /download-url`. Se a resposta já estiver vencida ou a menos de cinco segundos do vencimento, pede uma nova uma única vez. Nenhuma URL assinada é persistida. A abertura usa um link nativo temporário, sem fetch/blob, com `referrerPolicy=no-referrer`; o B2 fornece o anexo.
- Erros: arquivo indisponível preserva a compra e oferece ajuda; arquivo retirado recarrega a biblioteca; sessão expirada mantém o jogo selecionado no `next` de login. `?link=expirado` e `?link=indisponivel` explicam o retorno dos links de e-mail. O site não chama `/d/{token}`.
- `/jogo-gratuito` existe, com noindex, e só aparece no header/rodapé quando `GET /free-game` informa disponibilidade. Sem jogo, não mostra botão nem inventa conteúdo. Quando disponível, usa `POST /free-download`, sem exigir sessão.
- Confirmação paga, com entrega conectada: “Seus jogos estão em Meus jogos e também foram enviados para o seu e-mail”. No mock, o aviso explícito de prévia evita afirmar um envio real.
- Arquivos principais: `src/lib/downloads.ts`, `src/components/account/DownloadButton.tsx`, `src/routes/{meus-jogos,jogo-gratuito,pedido.confirmacao}.tsx`, ShopProvider/context, header/rodapé, rotas/SEO/CSS e `tests/e2e/i4-downloads.spec.ts`. Smokes atualizados para a nova rota e o botão da biblioteca; configuração Playwright preservada.

## Configuração

O dev em `http://127.0.0.1:5178` permanece com **entrega mock identificada**, conforme instrução de aguardar a integração do backend I4 no floor. Em test/preview, `VITE_DELIVERY_MODE=api` habilita a API; live nunca permite o mock. O mock não pede URLs nem baixa arquivos.

Para validar a fronteira da API sem modificar o dev, a variável foi definida somente no processo de build. Depois, `npm run build` restaurou o build padrão com entrega mock. Stripe continua configurada no modo real de teste, com o bloqueio da chave publicável registrado em `i3-frontend-review.md`.

## Verificações executadas

- `npm run lint`: exit 0.
- `npm run build`: exit 0, incluindo `npm run typecheck`; 14 rotas pré-renderizadas. Executado com entrega API e com entrega mock.
- Build API: `npm run test:e2e -- tests/e2e/i4-downloads.spec.ts --workers=2`: **9 PASS, 1 skip** exclusivo do mock, exit 0. Auth, API e resposta PDF são fixtures controladas, não downloads reais do B2.
- Build mock: mesmo comando: **4 PASS, 6 skips** exclusivos de API, exit 0.
- Suíte geral no build atual: `npm run test:e2e -- --workers=2`: **75 PASS, 14 skips, exit 0** (57,9 s). Skips: quatro fluxos I2b locais opt-in (reset I4 pendente), dois pagamentos Stripe reais opt-in (chave bloqueada), seis cenários exclusivos de entrega API já verificados no build focal, um cenário exclusivo de checkout mock e um exclusivo de stage preview.
- Cobertura focal: novo link a cada clique, renovação de resposta vencida, erros 401/404/503, recarga de biblioteca, retorno ao jogo, arquivo em preparação, gratuito disponível/indisponível e mock sem requisição de download.
- Biblioteca: checagem automática sem rolagem horizontal em 320, 390, 768, 1280 e 1440 px, fonte raiz 16/32 px; foco restaurado no jogo selecionado.

## Pendências

- Reset I4 liberado pelo Ferrolho; `$env:I2B_LOCAL_QA='1'; npm run test:e2e -- tests/e2e/i2b-frontend.spec.ts --workers=1`: **4 PASS, exit 0** (11,3 s), com contas novas pelo Mailpit e conta do seed para a biblioteca. Integração do backend I4 no Redesign ainda aguarda o Costura; manter entrega mock até o aviso do orquestrador. Não foram verificados download real do B2 nem envio de e-mail neste frontend.
- Jogo gratuito ainda não definido; permanece fora da navegação.
- Retomar os pagamentos 4242/recusa e as duas capturas solicitadas quando o responsável corrigir a chave publicável da conta Stripe. Nenhuma captura de sucesso foi produzida enquanto o pagamento está bloqueado.
