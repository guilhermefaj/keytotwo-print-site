# Testes das Edge Functions

Dois tipos de teste, na mesma pasta:

- **Contrato** (`*.test.ts`): sem rede e sem banco. `contract-helpers.ts` grava um ambiente fictício e troca o `fetch` por respostas simuladas (JWKS, RPCs, Stripe, Brevo e Mailpit).
- **Integração** (`*.integration.test.ts`): contra a stack local (`supabase start`), o Mailpit e o bucket de TESTE do B2. Ligados só com `KT_INTEGRATION=1`; a Stripe é simulada em `stripe-fake.ts`.

Env, `fetch` e os singletons das funções valem para o processo inteiro. Por isso, com `KT_INTEGRATION=1` o `contract-helpers.ts` fica inerte e os testes de contrato são ignorados; sem ele, as integrações são ignoradas.

## Como rodar

Na raiz do repositório:

```sh
# Contrato (sem stack)
npx deno@2.9.6 task --config supabase/functions/deno.json test:contract

# Integração e tudo: carregue antes o ambiente da stack, sem imprimir valores
set -a; eval "$(npx supabase@2.118.0 status -o env)"; set +a
npx deno@2.9.6 task --config supabase/functions/deno.json test:integration
npx deno@2.9.6 task --config supabase/functions/deno.json test:all
```

Os `deno task` rodam **um arquivo por processo** (`run-all.ts`) e terminam com um resumo; saem com código 1 se algum arquivo falhar.

A pasta inteira também roda num processo só, num modo de cada vez:

```sh
npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json --allow-env supabase/functions/tests/
KT_INTEGRATION=1 npx deno@2.9.6 test --no-lock --config supabase/functions/deno.json \
  --allow-env --allow-read --allow-net --allow-run=docker supabase/functions/tests/
```

## No CI

Desde 2026-10-16 o desenvolvimento usa o Supabase hospedado e não há stack local na máquina. A integração roda no job `integration` do `.github/workflows/ci.yml` (em PR, só quando o diff toca o que ela testa; no `main` e em `gh workflow run CI --ref <branch>`, sempre):
- sobe uma stack efêmera com o seed de TESTE;
- gera um `supabase/functions/.env` descartável;
- serve as funções e grava o Vault;
- roda `test:integration`, o `trigger-senha.mjs` e o e2e completo com `I2B_LOCAL_QA=1` contra um build stage=test ligado a essa stack.

O teste de entrega lê o bucket de TESTE do B2 com os segredos do repositório `B2_TEST_READ_KEY_ID` e `B2_TEST_READ_APPLICATION_KEY`. Sem eles, é ignorado com aviso. `checkout.integration` com `KT_STRIPE=1` (Stripe real) continua só manual.

## Requisitos da integração

- `supabase/functions/.env` local com `B2_*` (chave só leitura), `EMAIL_LINK_SECRET`, `API_PUBLIC_URL`, `EMAIL_FROM*` e `BREVO_WEBHOOK_SECRET`. Os testes leem só esses nomes e não imprimem valores.
- Depois de cada `db reset`: o passo do Price (`node supabase/local/aplicar-price-teste.mjs`) e o do Vault (`node supabase/local/aplicar-dispatch-vault.mjs`).
- `followups.integration.test.ts` usa o `psql` do contêiner do banco local (`--allow-run=docker`) para simular o tempo do enfileirador e pausa o job `email-dispatch-tick` durante o teste, religando no fim.
- As chamadas ao B2 têm uma nova tentativa curta se a conexão falhar (`fetchRetry`, só nos testes).
- Usuários de teste usam `teste-*@example.com`. Os que ficam com pedido ou consentimento continuam no banco local (FK `RESTRICT`, D-23); o `db reset` limpa.
