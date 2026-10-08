# I5-A — preferências de e-mail

2026-10-08. Floor Redesign, sem commit. Contrato consultado: seções 6.10 e 7 do `docs/api-contract.md` do floor I4. O orquestrador confirmou: descadastro não expira e a resposta é idempotente; não criar estados que a API não distingue.

- Nova página pública `/email/preferencias?token=…`, fora da navegação, com noindex. Abrir a página não altera a preferência; um clique em **Parar de receber novidades** chama `POST /email/unsubscribe`, JSON `{ token }`, sem sessão.
- Sucesso inclui quem já estava descadastrado. Link ausente/inválido orienta acessar Minha conta; falha temporária permite tentar novamente. E-mails de acesso e dos pedidos continuam, como previsto no contrato.
- Sem decodificar, registrar ou persistir o token no cliente. `no-referrer` na página, token somente no corpo do POST, removido da URL após sucesso. Retorno de foco no título do resultado; convite de marketing oculto nessa página.
- Arquivos: `src/routes/email.preferencias.tsx`, `src/lib/email-preferences.ts`, rotas/SEO/root e testes `i5-email-preferences.spec.ts`; smokes incluem a 15ª rota. Sem alterações no backend ou configuração Playwright.

## Configuração e revisão

Dev 5178 mantém **mock identificado** até o merge I5. Para demonstração: `http://127.0.0.1:5178/email/preferencias?token=demonstracao`. O botão simula sem POST e confirma que nenhuma preferência foi alterada.

`VITE_EMAIL_PREFERENCES_MODE=api` habilita a integração; live nunca usa mock. A configuração API foi aplicada somente a um processo de build para testes com respostas simuladas. Em seguida o build padrão foi restaurado. Nenhum token real nem assinatura HMAC foi criado para testar o frontend.

## Verificações

- `npm run lint` e `npm run typecheck`: exit 0.
- `npm run build`: exit 0 com API e mock, 15 rotas pré-renderizadas.
- Build API + `npm run test:e2e -- tests/e2e/i5-email-preferences.spec.ts --workers=2`: **5 PASS, 1 skip** exclusivo do mock, exit 0. API interceptada: confirmação por teclado, nenhum POST ao abrir, ausência de Authorization/Referer, remoção do token, repetição idempotente, erro inválido e nova tentativa.
- Build padrão (I4/I5 mock) + `$env:I2B_LOCAL_QA='1'; npm run test:e2e -- --workers=2`: **85 PASS, 13 skips, exit 0** (1,2 min). Inclui os quatro fluxos reais do I2b após o reset e os três cenários aplicáveis de I5 mock. Skips: dois pagamentos reais bloqueados pela chave Stripe, um cenário exclusivo de checkout mock, seis de entrega API, três de preferências API (verificados no build focal) e um de stage preview.
- Responsividade automática em 320, 390, 768, 1280 e 1440 px com fonte raiz 16/32 px, sem rolagem horizontal.

Pendente: merge I5 e verificação com um link real do e-mail local, seguida da conferência da preferência na conta. Nada remoto; Stripe e Brevo dependem das correções do responsável já registradas no relatório I3.

Atualização 2026-10-08 após merge f82beb4: descadastro real habilitado e validado pelo link do Mailpit, sem login e com idempotência. O padrão de test passou a ser API; mock apenas por opção explícita. Resultado em [i4-i5-real-integration.md](i4-i5-real-integration.md).
