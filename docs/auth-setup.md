# Configurar o login no Supabase — passo a passo do responsável

Projeto: `keytotwo-print-db` (ref `oqizkhjosplnedddaakb`, sa-east-1), o backend de produção desde 2026-10-16 (o teste e o dev local usam o mesmo). Este guia cobre o que só o painel faz: SMTP da Brevo, login com Google, URLs de retorno e templates. No local, tudo isso já vem do `supabase/config.toml`.

**Segredos:** os valores ficam só em `D:/Maestri/keytotwo-print-site-secrets/.env`, fora do repositório. Este guia cita apenas os nomes das variáveis. Nunca cole valores em arquivos do repositório, em issues ou no chat.

Os nomes de menu do Supabase, da Brevo e do Google mudam com frequência. Se um item não estiver no lugar indicado, procure pelo nome do campo.

## 1. Brevo (e-mail)

1. **Domínio do remetente.** Em Brevo > *Senders, Domains & Dedicated IPs* > *Domains*, adicione o domínio do e-mail que vai em `EMAIL_FROM` e publique no DNS os registros indicados (SPF, DKIM e DMARC). Espere a Brevo marcar o domínio como autenticado. Sem isso, os códigos caem no spam.
2. **Remetente.** Cadastre `EMAIL_FROM` como remetente, com o nome de `EMAIL_FROM_NAME`.
3. **Chave SMTP**, usada pelo Supabase Auth. Em Brevo > *SMTP & API* > aba *SMTP*, anote o servidor, a porta e o login, e gere uma *SMTP key*. Preencha `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SMTP_LOGIN` e `BREVO_SMTP_KEY`. O servidor costuma ser `smtp-relay.brevo.com`, na porta 587; vale o que o painel mostrar.
4. **Chave de API**, usada no I4 pelo e-mail de acesso à compra, que sai das Edge Functions. Na aba *API keys*, gere uma chave e preencha `BREVO_API_KEY`.
5. **Rastreamento de links.** Se a conta reescreve links de e-mails transacionais para medir cliques, desligue. Links reescritos podem quebrar o botão de confirmação.

## 2. Supabase: e-mail e senha

No painel do projeto `keytotwo-print-db`:

1. **Authentication > Emails > SMTP Settings:** ligue *Enable custom SMTP* e preencha:

   | Campo | Valor |
   | --- | --- |
   | Sender email | `EMAIL_FROM` |
   | Sender name | `EMAIL_FROM_NAME` |
   | Host | `BREVO_SMTP_HOST` |
   | Port | `BREVO_SMTP_PORT` |
   | Username | `BREVO_SMTP_LOGIN` |
   | Password | `BREVO_SMTP_KEY` |
   | Minimum interval between emails | 60 segundos |

2. **Authentication > Sign In / Providers > Email**, os mesmos valores do local:

   | Campo | Valor |
   | --- | --- |
   | Enable Email provider | ligado |
   | Confirm email | **ligado** (cadastro com senha só entra depois de confirmar) |
   | Secure email change | ligado |
   | Secure password change | desligado |
   | Email OTP length | 6 |
   | Email OTP expiration | 600 segundos (os templates dizem "10 minutos") |
   | Minimum password length | 8 |
   | Password requirements | letras e números |

   *Leaked password protection* só existe no plano Pro. Registre para o lançamento.
3. **Authentication > Sign In / Providers > User Signups:** *Allow new users to sign up* ligado. O comprador cria a conta no primeiro acesso.
4. **Authentication > Rate Limits:** com SMTP próprio, o padrão é 30 e-mails por hora. Mantenha no teste e reveja antes do lançamento, conforme o limite do plano da Brevo.

## 3. Supabase: URLs de retorno

**Authentication > URL Configuration:**

- **Site URL:** `SITE_URL`, a URL do site. Os templates usam esse valor no link de Ajuda.
- **Redirect URLs:** `SITE_URL/**`, o teste (`https://teste.keytotwo.com.br/**`), o admin (`https://admin.keytotwo.com.br/**`) e, para o dev local, `http://127.0.0.1:5178/**`.

## 4. Supabase: templates em pt-BR

**Authentication > Emails > Templates.** Para cada template, troque o assunto e cole o conteúdo **inteiro** do arquivo indicado:

| Template no painel | Assunto | Arquivo |
| --- | --- | --- |
| Magic Link | Seu código de acesso à KeyToTwo | `supabase/templates/codigo-acesso.html` |
| Confirm signup | Confirme seu e-mail na KeyToTwo | `supabase/templates/confirmacao-cadastro.html` |
| Reset Password | Redefina sua senha da KeyToTwo | `supabase/templates/redefinicao-senha.html` |

- O *Magic Link* é o e-mail do código de acesso de quem já tem conta.
- O *Confirm signup* vale para o cadastro com senha e para o primeiro código de um e-mail novo, por isso traz código e botão.
- Os demais templates (*Invite*, *Change Email*, *Reauthentication*) não são usados no P1 e ficam como estão.

## 5. Login com Google

**No Google Cloud Console**, em [Google Auth Platform](https://console.cloud.google.com/auth/overview), com um projeto da KeyToTwo:

1. **Branding:** nome do app `KeyToTwo`, e-mail de suporte e e-mail de contato do desenvolvedor. Logo só se quiser passar pela verificação de marca, que leva alguns dias úteis.
2. **Audience:** tipo *External*. No teste, deixe em *Testing* e adicione como *test users* as contas Google que vão testar. Para abrir a todos, publique o app. Com escopos básicos não há revisão de escopo; só a marca pode passar por verificação.
3. **Data Access (Scopes):** `openid` (adicionar à mão), `.../auth/userinfo.email` e `.../auth/userinfo.profile`. Nenhum outro.
4. **Clients > Create client**, tipo **Web application**, nome `KeyToTwo Supabase`:
   - *Authorized JavaScript origins:* a origem de `SITE_URL` (sem caminho) e, para desenvolvimento, `http://127.0.0.1:5178`.
   - *Authorized redirect URIs:*
     - `https://oqizkhjosplnedddaakb.supabase.co/auth/v1/callback`
     - `http://127.0.0.1:54321/auth/v1/callback` (Supabase local)
   - Crie e copie o *Client ID* para `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` e o *Client secret* para `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.

**No Supabase**, em **Authentication > Sign In / Providers > Google:** ligue o provedor e preencha *Client IDs* (`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`) e *Client Secret* (`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`). Deixe *Skip nonce check* e *Allow users without an email* desligados. A *Callback URL* mostrada ali tem de ser igual à primeira URI de redirecionamento acima.

**Contas com o mesmo e-mail:** o Supabase liga automaticamente o Google à conta que já tem aquele e-mail confirmado. Não há opção a mudar. *Manual linking* fica desligado.

**No local** (quem for testar o Google): defina `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` no ambiente do terminal antes de `npx supabase@2.118.0 start`. Sem elas, o provedor sobe ligado, mas o Google recusa o login (client id inválido).

## 6. Conferência depois de configurar

1. No site de teste, peça um código com um e-mail seu: o e-mail chega do remetente `EMAIL_FROM`, em pt-BR, e o código entra.
2. Crie uma conta com senha usando outro e-mail. O site pede o código primeiro e só depois a senha; em seguida, saia e entre com a senha. Uma senha cadastrada antes da confirmação do e-mail não vale: o banco a apaga na primeira confirmação (proteção contra tomada de conta).
3. Peça a redefinição de senha: chega o e-mail "Redefina sua senha da KeyToTwo".
4. Entre com Google usando uma conta de teste cadastrada em *Audience*.
5. Em **Authentication > Users**, confira que cada e-mail aparece uma única vez, mesmo usando código e Google.

Se algo falhar, mande ao orquestrador o passo e a mensagem de erro, sem valores de chaves.
