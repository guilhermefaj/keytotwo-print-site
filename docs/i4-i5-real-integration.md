# I4/I5 — integração real após A2

2026-10-08. Backend integrado por f82beb4. Em `src/lib/downloads.ts` e `src/lib/email-preferences.ts`, test/live passam a usar API por padrão. Preview continua mock; um mock local exige `VITE_DELIVERY_MODE=mock` ou `VITE_EMAIL_PREFERENCES_MODE=mock`. Sem alterações no backend ou nas chaves.

## Verificação real no site 5178

`node scripts/verify-delivery-local.mjs` com `KTT_QA_EMAIL`, `KTT_DELIVERY_MAIL_ID` e `KTT_MARKETING_MAIL_ID` da conta/mensagens locais preparadas: **PASS, exit 0**. O script não registra sessões, códigos OTP, tokens de descadastro ou URLs assinadas.

- Login pelo site com código recebido no Mailpit real.
- Pedido local 0109CE00 preparado pelo Ferrolho pela via do webhook/fulfill_order. A sessão paga foi simulada: **não houve pagamento 4242**.
- Meus jogos mostrou 5 jogos TESTE, um PDF por jogo, com referência ao Pacote KeyToTwo.
- Clique em Baixar PDF chamou `POST /download-url` real: 200. Download nativo do B2 concluído: `TESTE-J01-v1.0.pdf`, 699 bytes, cabeçalho `%PDF-`. Este é um PDF fictício do seed, não material comercial.
- Link `/d/{token}` do e-mail de entrega: 302 para HTTPS do B2. URL assinada não persistida no relatório.
- Link do rodapé do e-mail de pós-compra abriu `/email/preferencias` sem login. GET da API: 302. Abrir/hidratar não enviou POST.
- Confirmação explícita: POST 200, tela de sucesso, token removido do endereço. Repetição do mesmo link e confirmação: 200 novamente.
- Minha conta mostrou opt-in desmarcado, inclusive após recarregar.

Evidências fora do git: `D:/Maestri/qa/keytotwo-a2/integration/report.json`, `library-desktop.png`, `unsubscribed-desktop.png` e `TESTE-J01-v1.0.pdf`.

## QA integrado

- `npm run lint`: exit 0.
- `npm run build` (inclui typecheck): exit 0.
- `I2B_LOCAL_QA=1 npm run test:e2e -- --workers=8`: **94 passed, 6 skipped**, exit 0. Skips: dois cartões Stripe reais, três cenários exclusivos de mock e um cenário de preview. Integrações de login/código/senha/recuperação/carrinho usam a stack local; I3 e cenários de falha I4/I5 usam fixtures explícitas.
- A primeira execução após reconstruir pegou HTML/assets antigos no processo sirv de preview. Reiniciei apenas meu preview 4174, mantendo o Servidor 5178. Suíte repetida sobre os arquivos novos. Um assert de ALREADY_OWNED foi delimitado à oferta para distinguir seu alerta do alerta da barra mobile; a verificação funcional foi preservada.

Continua pendente: Stripe 4242/recusa reais dependem da publishable key correta, de outra conta no modelo atual. Sem commit nem push.
