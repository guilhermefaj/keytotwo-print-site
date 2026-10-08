# Contrato de dados — KeyToTwo Print (v0.3.5)

| | |
| --- | --- |
| Versão | 0.3.5, 2026-10-08. Substitui a v0.2.2 (seção 13 lista o que mudou). A v0.3.1 incorporou a revisão cruzada do Ferrolho (checkout embutido, D-21). A v0.3.2 registrou o I2b implementado, decidiu o P-15 e acrescentou o marcador do convite de marketing (D-22). A v0.3.3 acrescenta os **cupons** (D-24 e D-25: `orders` ganha subtotal, desconto e código promocional; `order_items` guarda o preço cheio) e especifica as RPCs do I3 como implementadas (linha "Implementado (I3)"). A v0.3.4 especifica como implementadas as RPCs de download, entrega, jogo gratuito e fila de e-mail do I4 (linha "Implementado (I4)") e traz no seed os metadados reais dos 5 PDFs de TESTE (D-26). A v0.3.5 especifica como implementados `record_email_event`, `private.enqueue_followups` e a agenda do `pg_cron` com o Vault (D-27, linha "Implementado (I5)"): **as 22 RPCs do contrato existem no banco**. |
| Dono | Lastro (Dados e Supabase). Consumidor: Ferrolho (Edge Functions). |
| Escopo | Referência para as migrações do I2b em diante. **Nenhuma migração, nenhuma escrita remota.** As migrações rascunho da v0.2.2 (sem commit, nunca aplicadas) serão reescritas no I2b. |
| Ambiente | Postgres 17 (projeto de teste `keytotwo-print-db`, sa-east-1, plano Free). Desenvolvimento local com Supabase CLI. |
| Fontes | Nota **Plano do site P2** (ajustes do orquestrador no topo e seção 3, que é a especificação), Plano do site P1 (decisões do responsável), `docs/auth-setup.md`, skills `supabase` e `supabase-postgres-best-practices`. |
| Verificado (DDL do contrato) | O DDL dos blocos `-- @ddl` (19 tabelas, funções e triggers de `private`, triggers em `auth.users`, RLS e GRANTs) aplica sem erro num Postgres descartável (imagem Supabase, PG 17.6) com o **schema `auth` real do GoTrue v2.197** e GRANT automático da plataforma emulado, e **160 verificações passaram** (a mesma bateria rodou de novo depois da v0.3.1, com `terms_accepted_at NOT NULL` e as assinaturas de `create_order_from_cart`, `fulfill_order` e `set_order_status` alteradas): CHECKs e unicidades novas; matriz de 64 transições (11 arestas + 8 "mesmo estado" passam, 45 recusadas); imutabilidade de pedido e item; I-5 por item com `SET CONSTRAINTS IMMEDIATE` (14 casos); trigger de senha e de perfil (7 cenários, inclusive senha trocada no mesmo `UPDATE` da confirmação); consentimento só por inserção com `profiles` sincronizado; `marketing_allowed`; `product_is_sellable`; exclusão de usuário (RESTRICT/CASCADE/SET NULL); nenhum privilégio de tabela, coluna ou sequência para `anon`, `authenticated` e `service_role`; ACL das 21 assinaturas; `public.test` (sósia) com ACL e RLS inalterados. |
| Implementado (I2b) | 4 migrações em `supabase/migrations` (`commerce_schema`, `auth_triggers`, `rls_grants`, `rpcs_i2b`), `supabase/seed.sql`, 8 arquivos pgTAP em `supabase/tests/database` (`01`, `02`, `03`, `04`, `06`, `07`, `08`, `11`) e `supabase/tests/gotrue/trigger-senha.mjs`. Na stack local, `supabase db reset` aplica migrações e seed do zero; `supabase test db` passa; o teste da trigger com o GoTrue real (v2.197) passa; `supabase db advisors --local` não tem WARN nem ERROR (só INFO: 4 FKs compostas sem índice que cubra as duas colunas). Números da última rodada: `supabase test db` com 8 arquivos e **394** testes (PASS); 10 RPCs. |
| Implementado (I3) | Migração `20261008174321_i3_checkout_fulfillment.sql` (subtotal, desconto e código promocional em `orders`; `guard_order_changes` com os valores imutáveis; `private.access_effect` e `private.cancel_order_emails`; `create_order_from_cart`, `attach_checkout_session`, `fulfill_order`, `set_order_status`, `get_order_status`; `get_account` com o desconto), seed com subtotal e desconto, pgTAP `05_checkout_fulfill` e `90_concurrency` (dblink; spike do P-12 feito), T72 no `07`, constraints do cupom no `01` e imutabilidade no `03`, `supabase/local/aplicar-price-teste.mjs` (passo local, fora do git, que põe o Price de TESTE da Stripe no P001). **15 RPCs** no banco (10 do I2b + 5 do I3). Verificado na stack local: `supabase db reset` do zero aplica as 5 migrações e o seed; `supabase test db`: 10 arquivos e **683** testes (PASS, inclusive a corrida com `dblink` com conexões `service_role`, que também passa 4 vezes seguidas no banco descartável); `supabase db advisors --local` sem WARN nem ERROR (INFO: 4 FKs compostas sem índice e índices ainda não usados); caminho de atualização (banco do I2b com o seed antigo, depois a migração do I3: subtotal = total e desconto 0 nos pedidos existentes); mutação (sem o `FOR UPDATE` do pedido o T120 quebra). |
| Implementado (I4) | Migração `20261008183123_i4_delivery_downloads_queue.sql` (nenhuma tabela muda): `resolve_download`, `resolve_delivery`, `get_free_game`, `resolve_free_download`, `claim_email_batch` e `mark_email_result`. Seed com tamanho e sha256 reais dos 5 PDFs de TESTE no bucket de teste do B2 (D-26). pgTAP `09_email_queue` e `10_downloads`, T125 no `90_concurrency` (dois despachantes e a marcação simultânea), I4 sobre o seed no `11`. **21 RPCs** no banco. Verificado na stack local: `supabase db reset` do zero com as 6 migrações e o seed; `supabase test db` com 12 arquivos e **831** testes (PASS); `supabase db advisors --local` sem WARN nem ERROR (INFO: 4 FKs compostas sem índice e índices ainda não usados). |
| Implementado (I5) | Migração `20261008190749_i5_followups_suppressions_agenda.sql` (nenhuma tabela muda): extensões `pg_cron`, `pg_net` e `supabase_vault`; `record_email_event` (público, só `service_role`); `private.enqueue_followups` e `private.dispatch_tick` (sem EXECUTE para papel de API); o job `email-dispatch-tick` a cada 5 minutos. Passo local `supabase/local/aplicar-dispatch-vault.mjs` (grava no Vault a URL e a chave do despacho, sem imprimir). pgTAP `12_followups` (T65, T88 e T89). **22 RPCs** no banco, todas as do contrato. Verificado na stack local: `supabase db reset` do zero com as 7 migrações e o seed; `supabase test db` com 13 arquivos e **879** testes (PASS, também depois de o despacho já ter enviado as entregas do seed); `supabase db advisors --local` sem WARN nem ERROR; o primeiro disparo real do `pg_cron` rodou (`succeeded`), o `pg_net` chamou o `email-dispatch` pelo Kong com a chave do Vault e recebeu **HTTP 200**, e o despacho enviou (modo log) as 2 entregas do seed. |
| Não verificado | Fora do I5: o despacho real pela Brevo, o `brevo-webhook` e o link `GET /d/{token}` (Ferrolho, só se provam na integração); a chave `dispatch` e os segredos do Vault na nuvem (I6, à mão no painel); a assinatura da URL no B2; o login com Google (exige credenciais do Google; verificação manual). O Checkout real da Stripe (sessão embutida, cupom, retorno) é do Ferrolho e só se prova na integração. Regras de plataforma (Data API) não foram lidas do projeto remoto. |

Os blocos `sql` marcados com `-- @ddl` são o DDL de referência (exequível). Os demais são assinaturas e exemplos. Nome comercial, preço, composição de avulsos, textos legais e remetentes **não são decididos aqui**: aparecem como `PENDENTE` (seção 11).

## 0. Decisões (resumo)

| # | Decisão | Por quê |
| --- | --- | --- |
| D-1 | **Zero acesso direto do cliente.** `anon` e `authenticated` não têm GRANT em tabela, sequência ou função. RLS ligada em todas, com a policy `deny_client_access`. | Ajuste 3 do orquestrador (P1) e mudança da Data API em 2026-10-30. A leitura passa pela API. |
| D-2 | **Toda escrita passa por RPC** `SECURITY DEFINER`, com `EXECUTE` só para `service_role`. | Invariantes ficam no banco e testáveis por pgTAP; um bug de rota não grava estado inválido. |
| D-3 | **Idempotência em 3 camadas:** PK do evento Stripe, constraints únicas (sessão, intent, direito, `dedupe_key`) e trava `FOR UPDATE` da linha do pedido (e do carrinho). | Evento repetido, webhook e página de retorno simultâneos não duplicam pedido, acesso nem e-mail. |
| D-4 | O evento Stripe é gravado **na mesma transação do efeito**, não antes. | Evita evento "registrado e não processado". Falha antes do commit = Stripe reenvia. |
| D-5 | **Comprar ≠ poder baixar.** `orders.status` (pagamento) e `entitlements.status` (acesso) são estados separados, ligados pela invariante diferida I-5, agora **por item**. | Contestação e reembolso têm estado próprio; atraso de liberação não pede nova compra. |
| D-6 | Composição de cada produto **congelada** em `entitlement_games` na compra. O arquivo servido é a versão **publicada vigente** de cada jogo (P-2). | "Não substituir silenciosamente um jogo comprado." |
| D-7 | Chave do B2 só em `file_objects`, sem URL, prefixo igual a `access`. FKs compostas impedem arquivo grátis em jogo pago e jogo grátis em pacote. | Conteúdo pago nunca vira URL pública. |
| D-8 | IDs: `uuid` (v4) nas entidades que aparecem na API; `bigint identity` no catálogo e nos logs. Texto + `CHECK`, sem `ENUM`. | Opaco contra enumeração; PG17 não tem `uuidv7()`. |
| D-9 | **Gate de venda por produto:** só entra no carrinho e só é cobrado produto `active`, completo (`games_expected`) e com todos os jogos publicados. | "Vender o pacote completo quando os conteúdos estiverem disponíveis." |
| D-11 | `public.test` intocada. Nenhuma migração usa `alter default privileges` nem `GRANT/REVOKE ... ON ALL ... IN SCHEMA public` (seção 10). | Restrição permanente do responsável (keep-alive externo). |
| D-12 | **`service_role` não tem privilégio de tabela algum, sem exceção.** Toda leitura e escrita da API passam por RPC, inclusive a fila de e-mail (`claim_email_batch`, `mark_email_result`). **Vale também no COMMIT:** os gatilhos diferidos (a I-5) disparam fora da RPC, com o papel da sessão; por isso `private.assert_order_entitlement_consistency` é `SECURITY DEFINER` (defeito achado na integração do I3 e coberto pelo T130). | Menor privilégio. Testes que contam linhas leem como dono (`postgres`). |
| D-13 | **Venda só para usuário cadastrado e com e-mail confirmado.** `orders.user_id` é `NOT NULL`: o dono do pedido é sempre o usuário. Some a compra anônima (`claim_orders`, vínculo por e-mail, `relation anonymous/claimable`). | Decisão do responsável. Grande simplificação. |
| D-14 | **Carrinho multi-item, 1 por usuário,** quantidade sempre 1. `carts.version` sobe a cada mudança e protege contra cobrar carrinho diferente do mostrado. | Decisão do responsável. |
| D-15 | **Sem reembolso e acesso sem expiração (P-1 e P-3 decididos).** Contestação aberta revoga o acesso do pedido inteiro; vencida devolve; perdida mantém revogado; reembolso manual excepcional revoga o pedido inteiro. `entitlements.expires_at` deixa de existir. | Decisão do responsável; o texto legal depende de advogado (CDC art. 49). |
| D-16 | **Posse sobreposta (D2, padrão provisório):** recusa produto cujos jogos o usuário já tem todos (`already_owned`); sobreposição parcial é aceita com aviso, sem desconto. | Ajuste 2 do orquestrador; vale até o responsável decidir. |
| D-17 | **Entrega dos jogos por e-mail, por link (D4):** o banco enfileira o e-mail `delivery` com `entitlement_id` e `game_id` por jogo, sem token; o link `GET /d/{token}` confere o direito no clique (`resolve_delivery`). Anexo fica como opção do despachante (`resolve_delivery` devolve `size_bytes`). | Ajuste 3 do orquestrador. |
| D-18 | **Trigger em `auth.users`:** zera a senha na primeira confirmação do e-mail, cria o perfil e registra `account_confirmed`. | Fecha o ataque de cadastro prévio com senha do atacante (decisão aprovada). |
| D-19 | **LGPD:** consentimento de marketing só por **inserção** (`marketing_consents`), sem IP; `profiles.marketing_opt_in` é sincronizado por trigger. Funil sem dado pessoal além do `user_id`. E-mail transacional não depende de consentimento. | Plano P2, seção 5. |
| D-20 | **Fila de e-mail no banco** (fonte da verdade): follow-ups agendados e checados (consentimento, supressão, carrinho) no momento do envio; a Brevo só envia. | Plano P2, seção 5. |
| D-21 | **Aceite dos termos (sem reembolso) na nossa página**, antes de montar o formulário embutido do Stripe (sem `consent_collection`). O pedido grava `terms_accepted_at` (`NOT NULL`) e `terms_version` **na criação**; `fulfill_order` e `set_order_status` não recebem mais o aceite. | Decisão do orquestrador (nota Stripe Checkout Studio). O texto legal depende de advogado (CDC art. 49). |
| D-22 | **Marcador do convite de marketing** (`profiles.marketing_prompted_at`, RPC `mark_marketing_prompt`): o convite pós-login aparece uma vez e vale entre aparelhos. **Ver ou dispensar o convite não é consentimento:** nada entra em `marketing_consents` e `marketing_opt_in` não muda. | Pedido da Aquarela, aprovado pelo orquestrador (relatado pelo Ferrolho). |
| D-23 | **FK de consentimento permanece `RESTRICT`; exclusão de conta é anonimização** (P-8, D6). Nenhum `DELETE` físico de usuário com histórico; a RPC de anonimização é futura, conduzida pelo suporte. | Decisão do orquestrador (achado do Ferrolho: `23503` ao apagar conta com consentimento). |
| D-24 | **Cupons habilitados no checkout (I3).** A sessão da Stripe traz o que foi cobrado; o pedido grava `amount_subtotal` (soma dos preços cheios), `amount_discount`, `amount_total` (= subtotal − desconto, **sem imposto**: `automatic_tax` desligado) e `promotion_code` (o texto digitado, ou NULL). `order_items.unit_amount` guarda o **preço cheio** do item; o desconto fica só no pedido. Tudo é gravado uma vez e não muda (`KT010`). As regras comerciais do cupom (percentual, validade, usos) vivem na Stripe, não no banco. | Decisão do responsável (nota Plano do site P2, "Cupons"); desenho do Lastro, valores conferidos pelo Ferrolho. |
| D-25 | **Cupom de 100%:** `payment_status = 'no_payment_required'` com total 0 e desconto > 0 libera o acesso como pago (pedido `paid` com total 0, sem `payment_intent`). Sem desconto, ou com total > 0, continua `KT002`. | Padrão do Lastro para o cupom aprovado; confirmação do responsável em P-22. |
| D-26 | **Arquivos do B2: o banco guarda só metadados e a chave sai só das RPCs de download.** `resolve_download`, `resolve_delivery` e `resolve_free_download` devolvem `bucket` e `object_key` a quem tem `EXECUTE` (só o `service_role`, ou seja, a API), que assina a URL no servidor; nenhuma outra RPC nem tabela expõe a chave e nenhuma coluna guarda URL. Publicar um arquivo novo segue **SQL do operador**, no ciclo da seção 7 (sem RPC de publicação na API: P-4). O seed traz os 5 PDFs de TESTE do bucket de teste com tamanho e sha256 reais (conteúdo fictício). | Decisão do Lastro (P-4) com os dados do Ferrolho; D-12. |
| D-27 | **Agenda dos follow-ups e do despacho: `pg_cron` a cada 5 minutos chama `private.dispatch_tick()`**, que enfileira os follow-ups (`private.enqueue_followups`) e, se o **Vault** tem `email_dispatch_url` e `email_dispatch_key`, chama a função de borda `email-dispatch` por `pg_net` (`POST`, cabeçalhos `Content-Type` e `apikey`, corpo `{"limit": 20}`). **Nenhum valor secreto vai para migração ou para o git:** local = passo `supabase/local/aplicar-dispatch-vault.mjs` (lê `supabase status -o env` e grava a URL do Kong e a secret key `default`); nuvem = chave nomeada `dispatch` criada no painel e gravada no Vault à mão (I6). Sem os segredos o job só enfileira e avisa no log. | Proposta do Ferrolho, aceita pelo Lastro; D-12 e D3. |

## 1. Convenções e fronteiras

- **Schemas.** `public`: tabelas e RPCs (único schema que a Data API expõe). `private`: funções auxiliares e de trigger, sem acesso para nenhum papel de API. A única mudança fora de `public`/`private` são **triggers em `auth.users`** (D-18); nenhum dado do Auth é alterado além da senha na primeira confirmação.
- **Nomes.** `snake_case`, tabelas no plural, constraints nomeadas `<tabela>_<coluna>_<tipo>`.
- **Tempo e dinheiro.** `timestamptz` em tudo. Valores em `bigint` na menor unidade da moeda (centavos), moeda em `text` de 3 letras minúsculas como a Stripe (`brl`). O banco **não guarda preço de vitrine**: o preço vem da Stripe (Price); `order_items` guarda o valor **cobrado**.
- **E-mail.** Sempre `lower(btrim(...))`. As RPCs normalizam; o `CHECK` é a rede de segurança.
- **Referência do pedido** mostrada ao usuário: derivada, `upper(left(replace(id::text,'-',''),8))`. Sem coluna.
- **Todas as RPCs com `p_user_id`** conferem que o usuário existe, não foi removido e tem `email_confirmed_at` (`private.require_confirmed_email`): senão `KT009` (vira 403 `EMAIL_NOT_CONFIRMED`). Exceção: `unsubscribe` (descadastro nunca é bloqueado).
- **Erros de contrato:** `SQLSTATE` da classe `KT` (seção 6.1). Resultados esperados de negócio (duplicado, adiado, produto indisponível, já possuído) **não** são erros: voltam em `outcome`.
- **Implementação das RPCs:** `language plpgsql`, `security definer`, `set search_path = ''`, tudo qualificado (`public.`, `auth.`, `private.`), dono `postgres`. Colunas de retorno (`order_id`...) colidem com colunas de tabela: usar `#variable_conflict use_column` ou qualificar. No `plpgsql`, não referenciar campos de `new` que só existem em uma das tabelas dentro de um mesmo `CASE`; usar `if/else`.
- **Migrações** (regras de segurança, seção 10): só objetos nomeados; GRANT/REVOKE explícitos por objeto; todo `drop`+`create` de função repete o `REVOKE`/`GRANT`. Criar o arquivo com `supabase migration new <nome>`.
- **Exclusão de conta:** `auth.users` tem FK `RESTRICT` de pedidos, consentimentos e fila: conta com histórico **não** se apaga com `DELETE`; anonimiza-se (P-8). **Decisão do orquestrador (D-23):** `marketing_consents.user_id` **continua `RESTRICT`**; o histórico de consentimento é prova (LGPD) e não some em cascata. A exclusão de conta será por **anonimização**, com uma RPC futura conduzida pelo suporte, sem `DELETE` físico do usuário. Retenção e anonimização do e-mail no histórico: decisão **pendente** do responsável (D6, P-19). Para limpar o banco **local** dos testes, usar `supabase db reset` (um `DELETE` em `auth.users` de quem tem consentimento falha com `23503`; é o comportamento desejado).

## 2. Entidades

### 2.1 Fundação

```sql
-- @ddl
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
```

### 2.2 Catálogo: `products`, `games`, `product_games`

`products` é a unidade de venda: pacote (`bundle`) ou avulso (`single`). Catálogo genérico: novos produtos são linhas novas, sem mudança de schema. `games` são os componentes; `games.access` separa jogo vendido (`paid`) do jogo gratuito (`free`).

```sql
-- @ddl
create table public.products (
  id              bigint generated always as identity primary key,
  code            text not null unique,
  slug            text not null unique,
  kind            text not null,             -- bundle | single
  name            text,                      -- nome comercial: PENDENTE até decisão do responsável
  status          text not null default 'draft',
  stripe_price_id text unique,               -- por ambiente (P-5); nunca é preço de vitrine
  games_expected  smallint,                  -- trava de completude; avulso = 1
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint products_code_check   check (code ~ '^[A-Z][A-Z0-9-]{1,23}$'),
  constraint products_slug_check   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_kind_check   check (kind in ('bundle', 'single')),
  constraint products_name_check   check (name is null or btrim(name) <> ''),
  constraint products_status_check check (status in ('draft', 'active', 'archived')),
  constraint products_price_check  check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint products_games_expected_check check (games_expected is null or games_expected > 0),
  constraint products_single_check check (kind <> 'single' or games_expected is null or games_expected = 1),
  constraint products_active_requires_data check (
    status <> 'active' or (name is not null and stripe_price_id is not null and games_expected is not null))
);

-- @ddl
create table public.games (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  slug       text not null unique,
  name       text not null,
  access     text not null default 'paid',
  status     text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_code_check   check (code ~ '^[A-Z][A-Z0-9-]{1,23}$'),
  constraint games_slug_check   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint games_name_check   check (btrim(name) <> ''),
  constraint games_access_check check (access in ('paid', 'free')),
  constraint games_status_check check (status in ('draft', 'published')),
  constraint games_id_access_key unique (id, access)   -- alvo das FKs compostas
);
-- no máximo UM jogo gratuito publicado (P-10)
create unique index games_one_published_free on public.games ((true))
  where access = 'free' and status = 'published';

-- @ddl
create table public.product_games (
  product_id  bigint   not null references public.products (id),
  game_id     bigint   not null,
  game_access text     not null default 'paid',
  position    smallint not null,
  primary key (product_id, game_id),
  constraint product_games_position_check check (position >= 1),
  constraint product_games_paid_only      check (game_access = 'paid'),
  constraint product_games_position_key   unique (product_id, position),
  constraint product_games_game_fkey foreign key (game_id, game_access) references public.games (id, access)
);
create index product_games_game_id_idx on public.product_games (game_id);
```

### 2.3 Arquivos: `files` e `file_objects` (metadados do B2)

Detalhes e ciclo de publicação na seção 7. Sem mudança em relação à v0.2.2.

```sql
-- @ddl
create table public.files (
  id           uuid primary key default gen_random_uuid(),
  game_id      bigint,
  product_id   bigint references public.products (id),   -- ZIP do pacote (futuro)
  kind         text   not null,
  access       text   not null,
  version      text   not null,
  filename     text   not null,                           -- nome mostrado no download
  size_bytes   bigint not null,
  sha256       text   not null,                           -- hex minúsculo do conteúdo
  status       text   not null default 'draft',
  published_at timestamptz,
  retired_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint files_game_fkey foreign key (game_id, access) references public.games (id, access),
  constraint files_id_access_key unique (id, access),
  constraint files_owner_check check (
    (game_id is not null and product_id is null)
    or (game_id is null and product_id is not null and access = 'paid')),
  constraint files_kind_check    check (kind in ('pdf', 'zip')),
  constraint files_access_check  check (access in ('paid', 'free')),
  constraint files_version_check check (version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
  constraint files_filename_check check (
    char_length(filename) between 5 and 200
    and filename !~ '[/\\[:cntrl:]]'
    and lower(filename) like ('%.' || kind)),
  constraint files_size_check   check (size_bytes > 0),
  constraint files_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint files_status_check check (status in ('draft', 'published', 'retired')),
  constraint files_status_dates_check check (
    (status = 'draft'     and published_at is null     and retired_at is null) or
    (status = 'published' and published_at is not null and retired_at is null) or
    (status = 'retired'   and published_at is not null and retired_at is not null))
);
create unique index files_game_version_key    on public.files (game_id, kind, access, version) where game_id is not null;
create unique index files_product_version_key on public.files (product_id, kind, version)      where product_id is not null;
-- um único arquivo publicado por (jogo, tipo, acesso) e por (pacote, tipo)
create unique index files_one_published_per_game    on public.files (game_id, kind, access)
  where status = 'published' and game_id is not null;
create unique index files_one_published_per_product on public.files (product_id, kind)
  where status = 'published' and product_id is not null;

-- @ddl
create table public.file_objects (
  file_id     uuid primary key,
  access      text not null,                       -- espelha files.access (FK composta)
  bucket      text not null,
  object_key  text not null,
  b2_file_id  text,                                -- fileId nativo do B2, opcional
  uploaded_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint file_objects_file_fkey foreign key (file_id, access) references public.files (id, access) on delete cascade,
  constraint file_objects_bucket_check check (bucket ~ '^[A-Za-z0-9-]{6,50}$'),
  -- lista branca: sem esquema (https:), sem "?", sem espaço; prefixo = acesso
  constraint file_objects_key_check check (
    char_length(object_key) <= 1024
    and object_key ~ '^(paid|free)/[A-Za-z0-9._/-]+$'
    and object_key !~ '\.\.'
    and left(object_key, char_length(access) + 1) = access || '/'),
  constraint file_objects_location_key unique (bucket, object_key)
);
```

### 2.4 Conta: `profiles`, `marketing_consents`, `email_suppressions`

`profiles` guarda o que a conta tem além do Auth: o cliente da Stripe e o **estado atual** do consentimento de marketing. O histórico do consentimento fica em `marketing_consents` (só inserção). Quem cria o perfil é a trigger de `auth.users` (seção 2.10).

```sql
-- @ddl
create table public.profiles (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id  text unique,                 -- criado no 1º checkout (set_stripe_customer)
  marketing_opt_in    boolean not null default false,
  marketing_opt_in_at timestamptz,                 -- quando o opt-in vigente foi dado; NULL sem opt-in
  marketing_prompted_at timestamptz,               -- quando o convite de marketing foi exibido pela 1ª vez; ver ou dispensar NÃO é consentimento
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_customer_check check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  constraint profiles_opt_in_check   check (marketing_opt_in = (marketing_opt_in_at is not null))
);

-- @ddl
-- Histórico do consentimento (LGPD). SÓ INSERÇÃO. Sem IP e sem user agent (P-6/D6). O e-mail é fotografia.
create table public.marketing_consents (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id),
  email        text not null,
  action       text not null,
  source       text not null,
  text_version text,                               -- versão do texto mostrado; obrigatória ao conceder
  occurred_at  timestamptz not null default now(),
  constraint marketing_consents_email_check  check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint marketing_consents_action_check check (action in ('granted', 'revoked')),
  constraint marketing_consents_source_check check (source in
    ('signup_prompt', 'account', 'cart', 'unsubscribe_link', 'brevo_webhook', 'support')),
  constraint marketing_consents_text_check   check (action <> 'granted' or text_version is not null),
  constraint marketing_consents_version_check check (text_version is null or text_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  -- origens que só concedem ou só revogam
  constraint marketing_consents_source_action_check check (
    (source in ('signup_prompt', 'cart') and action = 'granted')
    or (source in ('unsubscribe_link', 'brevo_webhook') and action = 'revoked')
    or source in ('account', 'support'))
);
create index marketing_consents_user_idx on public.marketing_consents (user_id, occurred_at desc, id desc);

-- @ddl
-- Supressões vindas da Brevo (bounce, reclamação, descadastro). Consultada antes de QUALQUER envio de marketing.
create table public.email_suppressions (
  email               text not null,
  reason              text not null,
  source              text not null,
  provider_message_id text,
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  primary key (email, reason),
  constraint email_suppressions_email_check  check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_suppressions_reason_check check (reason in ('hard_bounce', 'complaint', 'unsubscribe_all')),
  constraint email_suppressions_source_check check (source in ('brevo_webhook', 'unsubscribe_link', 'support'))
);
```

### 2.5 Carrinho: `carts` e `cart_items`

Um carrinho por usuário, persistente entre aparelhos. Não há carrinho anônimo. Quantidade é sempre 1 (sem coluna).

```sql
-- @ddl
create table public.carts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  version    integer not null default 0,           -- sobe a cada mudança; chave anti-duplicidade do lembrete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),   -- "última mudança" (lembrete 3 h depois)
  constraint carts_version_check check (version >= 0)
);

-- @ddl
create table public.cart_items (
  user_id    uuid   not null references public.carts (user_id) on delete cascade,
  product_id bigint not null references public.products (id),
  added_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index cart_items_product_id_idx on public.cart_items (product_id);
```

### 2.6 Pedidos: `orders`, `order_items`, `order_events`

Um pedido é do usuário (`user_id NOT NULL`) e tem 1 ou mais itens. O que foi cobrado vem da sessão da Stripe e é gravado na liberação (`fulfill_order`) ou, no pagamento assíncrono, em `pending_payment`: o pedido guarda `amount_subtotal`, `amount_discount`, `amount_total` e `promotion_code` (D-24); cada item guarda o **preço cheio** (`unit_amount`, antes do cupom). Sem imposto: `amount_total = amount_subtotal − amount_discount`.

```sql
-- @ddl
create table public.orders (
  id                         uuid primary key default gen_random_uuid(),   -- client_reference_id e chave de idempotência da Stripe
  user_id                    uuid not null references auth.users (id),     -- dono, sempre; não muda
  email                      text not null,                                -- fotografia do e-mail da conta
  status                     text not null default 'open',
  cart_version               integer not null,                             -- versão do carrinho que originou o pedido
  terms_version              text not null,                                -- versão dos termos mostrada na página do site
  terms_accepted_at          timestamptz not null,                         -- aceite na página do site, antes do formulário; gravado na criação
  amount_total               bigint,
  currency                   text,
  amount_subtotal            bigint,                                       -- soma dos preços cheios dos itens, antes do cupom (da sessão); gravado uma vez
  amount_discount            bigint,                                       -- desconto do cupom (da sessão); 0 sem cupom
  promotion_code             text,                                         -- texto do código promocional digitado; NULL sem código
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text unique,
  livemode                   boolean not null,
  checkout_expires_at        timestamptz,
  paid_at                    timestamptz,
  refunded_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint orders_id_user_key unique (id, user_id),     -- alvo da FK composta de entitlements
  constraint orders_status_check check (status in
    ('open', 'pending_payment', 'paid', 'failed', 'expired', 'disputed', 'dispute_lost', 'refunded')),
  constraint orders_email_check check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint orders_cart_version_check check (cart_version >= 0),
  constraint orders_terms_version_check check (btrim(terms_version) <> ''),
  constraint orders_money_pair     check ((amount_total is null) = (currency is null)),
  constraint orders_amount_check   check (amount_total is null or amount_total >= 0),
  constraint orders_currency_check check (currency is null or currency ~ '^[a-z]{3}$'),
  constraint orders_session_check  check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]+$'),
  constraint orders_intent_check   check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  constraint orders_amount_required check (
    status not in ('pending_payment', 'paid', 'disputed', 'dispute_lost', 'refunded')
    or (amount_total is not null and amount_subtotal is not null)),
  constraint orders_discount_pair  check ((amount_subtotal is null) = (amount_discount is null)),
  constraint orders_discount_range check (
    amount_subtotal is null
    or (amount_total is not null and amount_subtotal >= 0 and amount_discount >= 0
        and amount_discount <= amount_subtotal and amount_total = amount_subtotal - amount_discount)),
  constraint orders_promotion_code_check check (
    promotion_code is null or (promotion_code = btrim(promotion_code) and char_length(promotion_code) between 1 and 200)),
  constraint orders_paid_at_check     check ((status in ('paid', 'disputed', 'dispute_lost', 'refunded')) = (paid_at is not null)),
  constraint orders_refunded_at_check check ((status = 'refunded') = (refunded_at is not null))
);
create index orders_user_idx  on public.orders (user_id, created_at desc);
create index orders_stale_idx on public.orders (created_at) where status in ('open', 'pending_payment');
create index orders_paid_followup_idx on public.orders (paid_at) where status = 'paid';

-- @ddl
create table public.order_items (
  order_id        uuid     not null references public.orders (id),
  product_id      bigint   not null references public.products (id),
  position        smallint not null,
  stripe_price_id text     not null,         -- Price enviado ao Checkout (fotografia na criação do pedido)
  unit_amount     bigint,                    -- PREÇO CHEIO do item (antes do cupom), das line_items; preenchido na liberação
  currency        text,
  primary key (order_id, product_id),
  constraint order_items_position_check check (position >= 1),
  constraint order_items_position_key   unique (order_id, position),
  constraint order_items_price_check    check (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint order_items_amount_check   check (unit_amount is null or unit_amount >= 0),
  constraint order_items_currency_check check (currency is null or currency ~ '^[a-z]{3}$'),
  constraint order_items_money_pair     check ((unit_amount is null) = (currency is null))
);
create index order_items_product_id_idx on public.order_items (product_id);

-- @ddl
-- Trilha de transições (append-only). Sem dado pessoal.
create table public.order_events (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders (id),
  from_status      text,
  to_status        text not null,
  source           text not null,
  stripe_event_id  text,
  reason           text,
  created_at       timestamptz not null default now(),
  constraint order_events_source_check check (source in ('checkout', 'webhook', 'return_page', 'reconcile', 'system')),
  constraint order_events_reason_check check (reason is null or char_length(reason) <= 200)
);
create index order_events_order_id_idx on public.order_events (order_id, id);
```

### 2.7 Acesso: `entitlements` e `entitlement_games`

`entitlements` é o **direito de baixar**, um por item do pedido. Leva `user_id` (coerente com o pedido, por FK composta) para consultar posse sem join. **Sem expiração.**

```sql
-- @ddl
create table public.entitlements (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid   not null,
  product_id    bigint not null,
  user_id       uuid   not null,
  status        text   not null default 'active',
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint entitlements_item_fkey       foreign key (order_id, product_id) references public.order_items (order_id, product_id),
  constraint entitlements_order_user_fkey foreign key (order_id, user_id)    references public.orders (id, user_id),
  constraint entitlements_order_product_key unique (order_id, product_id),
  constraint entitlements_status_check check (status in ('active', 'revoked')),
  constraint entitlements_reason_check check (revoke_reason is null or revoke_reason in ('refund', 'dispute', 'manual')),
  constraint entitlements_state_check check (
    (status = 'active'  and revoked_at is null     and revoke_reason is null) or
    (status = 'revoked' and revoked_at is not null and revoke_reason is not null))
);
create index entitlements_user_active_idx on public.entitlements (user_id) where status = 'active';
create index entitlements_product_id_idx  on public.entitlements (product_id);

-- @ddl
-- Fotografia da composição do produto na compra. Imutável.
create table public.entitlement_games (
  entitlement_id uuid     not null references public.entitlements (id),
  game_id        bigint   not null references public.games (id),
  position       smallint not null,
  primary key (entitlement_id, game_id),
  constraint entitlement_games_position_check check (position >= 1)
);
create index entitlement_games_game_id_idx on public.entitlement_games (game_id);
```

### 2.8 Eventos: `stripe_events`, `funnel_events`, `download_events`

```sql
-- @ddl
-- Livro-razão de idempotência. Sem payload (evita dado pessoal). Escrito só pelas RPCs, na transação do efeito.
create table public.stripe_events (
  id               text primary key,             -- evt_...
  type             text not null,
  livemode         boolean not null,
  stripe_object_id text,                         -- cs_..., ch_..., dp_...
  order_id         uuid references public.orders (id),
  outcome          text not null,
  received_at      timestamptz not null default now(),
  constraint stripe_events_id_check check (id ~ '^evt_[A-Za-z0-9_]+$'),
  constraint stripe_events_outcome_check check (outcome in ('applied', 'noop', 'ignored', 'not_found'))
);
create index stripe_events_order_id_idx on public.stripe_events (order_id) where order_id is not null;

-- @ddl
-- Funil: SÓ INSERÇÃO, escrito só pelas RPCs e triggers, sem dado pessoal além do user_id (SET NULL se a conta for apagada).
-- O primeiro download sai de download_events (não duplica aqui).
create table public.funnel_events (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users (id) on delete set null,
  type         text not null,
  order_id     uuid references public.orders (id),
  product_id   bigint references public.products (id),
  cart_version integer,
  occurred_at  timestamptz not null default now(),
  constraint funnel_events_type_check check (type in ('account_confirmed', 'cart_item_added', 'cart_item_removed',
    'checkout_started', 'checkout_expired', 'order_paid', 'delivery_sent', 'dispute_opened', 'dispute_closed')),
  constraint funnel_events_shape_check check (
    case type
      when 'account_confirmed' then true
      when 'cart_item_added'   then product_id is not null and cart_version is not null
      when 'cart_item_removed' then product_id is not null and cart_version is not null
      else order_id is not null
    end)
);
create unique index funnel_events_account_confirmed_key on public.funnel_events (user_id)
  where type = 'account_confirmed' and user_id is not null;
create unique index funnel_events_once_per_order_key on public.funnel_events (order_id, type)
  where type in ('checkout_started', 'checkout_expired', 'order_paid', 'delivery_sent');
create index funnel_events_type_idx    on public.funnel_events (type, occurred_at);
create index funnel_events_user_idx    on public.funnel_events (user_id, occurred_at) where user_id is not null;
create index funnel_events_order_idx   on public.funnel_events (order_id) where order_id is not null;
create index funnel_events_product_idx on public.funnel_events (product_id) where product_id is not null;

-- @ddl
-- Sem IP, sem user agent. Escrito só por resolve_download/resolve_delivery/resolve_free_download (append-only).
create table public.download_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete set null,   -- NULL no gratuito (e se a conta for apagada)
  file_id    uuid not null references public.files (id),
  kind       text not null,
  created_at timestamptz not null default now(),
  constraint download_events_kind_check check (kind in ('paid', 'free'))
);
create index download_events_file_idx on public.download_events (file_id, created_at);
create index download_events_user_idx on public.download_events (user_id, created_at) where user_id is not null;
```

### 2.9 Fila de e-mail: `email_outbox`

Fonte da verdade dos e-mails do app (a Brevo só envia; Auth usa o SMTP da Brevo por fora desta tabela). Cada linha é um e-mail **decidido** pelo banco; marketing é rechecado no envio (seção 6.7).

```sql
-- @ddl
create table public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id),
  order_id            uuid references public.orders (id),         -- NULL em e-mail que não é de um pedido
  kind                text not null,                              -- delivery | cart_reminder | post_purchase
  category            text not null,                              -- transactional | marketing
  to_email            text not null,
  payload             jsonb not null default '{}'::jsonb,         -- fotografia: nomes, ref, ids; SEM token
  scheduled_at        timestamptz not null default now(),
  dedupe_key          text not null unique,
  status              text not null default 'queued',
  skip_reason         text,
  attempts            integer not null default 0,
  last_error          text,                                       -- código/mensagem curta; sem e-mail nem token
  provider_message_id text,
  locked_at           timestamptz,                                -- preenchido enquanto status = sending
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now(),
  constraint email_outbox_kind_check     check (kind in ('delivery', 'cart_reminder', 'post_purchase')),
  constraint email_outbox_category_check check (category in ('transactional', 'marketing')),
  constraint email_outbox_kind_category_check check ((kind = 'delivery') = (category = 'transactional')),
  constraint email_outbox_delivery_order_check check (kind <> 'delivery' or order_id is not null),
  constraint email_outbox_to_check       check (to_email = lower(btrim(to_email)) and to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_outbox_payload_check  check (jsonb_typeof(payload) = 'object'),
  constraint email_outbox_dedupe_check   check (dedupe_key ~ '^[A-Za-z0-9:._-]{3,200}$'),
  constraint email_outbox_status_check   check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'canceled')),
  constraint email_outbox_skip_check     check (
    (status in ('skipped', 'canceled')) = (skip_reason is not null)),
  constraint email_outbox_skip_reason_check check (skip_reason is null or skip_reason in
    ('no_opt_in', 'suppressed', 'already_purchased', 'cart_changed', 'cart_empty', 'order_not_paid',
     'entitlement_revoked', 'email_not_confirmed')),
  constraint email_outbox_attempts_check check (attempts >= 0),
  constraint email_outbox_error_check    check (last_error is null or char_length(last_error) <= 500),
  constraint email_outbox_sent_check     check ((status = 'sent') = (sent_at is not null)),
  constraint email_outbox_lock_check     check ((status = 'sending') = (locked_at is not null))
);
create index email_outbox_due_idx   on public.email_outbox (scheduled_at) where status in ('queued', 'sending');
create index email_outbox_user_idx  on public.email_outbox (user_id, kind, status);
create index email_outbox_order_idx on public.email_outbox (order_id) where order_id is not null;
```

`dedupe_key`: `delivery:{order_id}`, `cart_reminder:{user_id}:{cart_version}`, `post_purchase:{order_id}`. `payload` da entrega (por jogo, sem token; o despachante gera o HMAC no envio):

```json
{ "order_ref": "A1B2C3D4",
  "items": [ { "code": "P001", "name": "…" } ],
  "games": [ { "entitlement_id": "…", "game_id": 1, "code": "…", "name": "…" } ] }
```

### 2.10 Funções e triggers internos (schema `private`)

Sem GRANT para nenhum papel de API. A checagem de `EXECUTE` de trigger ocorre só na criação.

```sql
-- @ddl
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function private.normalize_email(p_email text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(lower(btrim(p_email)), '')
$$;

-- E-mail normalizado do usuário, só se ele existe, não foi removido e CONFIRMOU o e-mail.
-- Vale para os três métodos de login (código, senha com confirmação, Google): o Auth só preenche
-- email_confirmed_at depois de o e-mail ser verificado.
create function private.confirmed_email(p_user_id uuid) returns text
language sql stable set search_path = '' as $$
  select private.normalize_email(u.email)
  from auth.users u
  where u.id = p_user_id
    and u.deleted_at is null
    and u.email_confirmed_at is not null
$$;

-- Usada por toda RPC com p_user_id (exceto unsubscribe): KT009 sem e-mail confirmado. Devolve o e-mail.
create function private.require_confirmed_email(p_user_id uuid) returns text
language plpgsql stable set search_path = '' as $$
declare v_email text;
begin
  if p_user_id is null then
    raise exception 'p_user_id é obrigatório' using errcode = 'KT001';
  end if;
  v_email := private.confirmed_email(p_user_id);
  if v_email is null then
    raise exception 'usuário sem e-mail confirmado' using errcode = 'KT009';
  end if;
  return v_email;
end $$;

create function private.order_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'open'            then p_to in ('pending_payment', 'paid', 'failed', 'expired')
    when 'pending_payment' then p_to in ('paid', 'failed')
    when 'paid'            then p_to in ('disputed', 'refunded')
    when 'disputed'        then p_to in ('paid', 'dispute_lost', 'refunded')
    else false
  end
$$;

-- Jogos que o usuário já possui (direito ativo).
create function private.owned_game_ids(p_user_id uuid) returns setof bigint
language sql stable set search_path = '' as $$
  select distinct eg.game_id
  from public.entitlements e
  join public.entitlement_games eg on eg.entitlement_id = e.id
  where e.user_id = p_user_id and e.status = 'active'
$$;

-- Gate de venda (D-9): ativo, com preço, composição completa e todo jogo publicado com PDF pago publicado.
create function private.product_is_sellable(p_product_id bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.status = 'active'
      and p.stripe_price_id is not null
      and p.games_expected is not null
      and (select count(*) from public.product_games pg where pg.product_id = p.id) = p.games_expected
      and not exists (
        select 1
        from public.product_games pg
        join public.games g on g.id = pg.game_id
        where pg.product_id = p.id
          and (g.status <> 'published'
               or not exists (select 1 from public.files f
                              where f.game_id = g.id and f.kind = 'pdf' and f.access = 'paid' and f.status = 'published')))
  )
$$;

-- Pode receber marketing agora? Opt-in vigente, e-mail confirmado, sem supressão (bounce/reclamação)
-- e sem descadastro geral posterior ao opt-in.
create function private.marketing_allowed(p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select p.marketing_opt_in
       and u.email_confirmed_at is not null
       and u.deleted_at is null
       and not exists (
         select 1 from public.email_suppressions s
         where s.email = private.normalize_email(u.email)
           and (s.reason in ('hard_bounce', 'complaint')
                or (s.reason = 'unsubscribe_all' and s.created_at > p.marketing_opt_in_at)))
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.user_id = p_user_id
  ), false)
$$;

-- I-5 (checada no commit), por item. paid: todo item tem direito, ativo ou revogado manualmente (atendimento).
-- disputed, dispute_lost e refunded: todo item tem direito e todos revogados. Demais estados: nenhum direito.
-- SECURITY DEFINER (D-12): os gatilhos diferidos disparam no COMMIT, fora da RPC, com o papel da sessão (service_role, sem SELECT em tabela).
create function private.assert_order_entitlement_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_status   text;
  v_items    integer;
  v_ents     integer;
  v_active   integer;
  v_revoked  integer;
  v_manual   integer;
begin
  -- if/else (e não CASE): cada tabela tem só um dos campos de "new".
  if tg_table_name = 'orders' then
    v_order_id := new.id;
  else
    v_order_id := new.order_id;
  end if;

  select o.status into v_status from public.orders o where o.id = v_order_id;
  if not found then
    return null;
  end if;

  select count(*) into v_items from public.order_items i where i.order_id = v_order_id;
  select count(*),
         count(*) filter (where e.status = 'active'),
         count(*) filter (where e.status = 'revoked'),
         count(*) filter (where e.status = 'revoked' and e.revoke_reason = 'manual')
    into v_ents, v_active, v_revoked, v_manual
    from public.entitlements e
   where e.order_id = v_order_id;

  if v_status = 'paid' then
    if v_items < 1 or v_ents <> v_items or v_revoked <> v_manual then
      raise exception 'pedido % paid: itens=%, direitos=%, revogados fora do atendimento=%',
        v_order_id, v_items, v_ents, v_revoked - v_manual using errcode = 'KT011';
    end if;
  elsif v_status in ('disputed', 'dispute_lost', 'refunded') then
    if v_items < 1 or v_ents <> v_items or v_active > 0 then
      raise exception 'pedido % (%): itens=%, direitos=%, ativos=% (todos devem estar revogados)',
        v_order_id, v_status, v_items, v_ents, v_active using errcode = 'KT011';
    end if;
  elsif v_ents > 0 then
    raise exception 'pedido % (%) não pode ter direito', v_order_id, v_status using errcode = 'KT011';
  end if;
  return null;
end $$;

-- Tabelas de log: só inserção.
create function private.forbid_modification() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% é só inserção (% não permitido)', tg_table_name, tg_op using errcode = 'KT008';
end $$;

-- download_events e funnel_events: só inserção, exceto o SET NULL de auth.users (conta anonimizada).
create function private.guard_user_nulling() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.user_id is not null and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception '% é só inserção (% não permitido)', tg_table_name, tg_op using errcode = 'KT008';
end $$;

-- O estado atual do consentimento (profiles) acompanha a última linha do histórico, na mesma transação.
create function private.sync_profile_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.profiles p
     set marketing_opt_in    = (new.action = 'granted'),
         marketing_opt_in_at = case when new.action = 'granted' then new.occurred_at end
   where p.user_id = new.user_id;
  if not found then
    raise exception 'usuário % sem perfil', new.user_id using errcode = 'KT001';
  end if;
  return null;
end $$;

-- orders: transições só pelas arestas da seção 4.1; colunas imutáveis; dono e ids da Stripe não mudam.
create function private.guard_order_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.livemode is distinct from old.livemode
     or new.created_at is distinct from old.created_at
     or new.cart_version is distinct from old.cart_version
     or new.terms_version is distinct from old.terms_version then
    raise exception 'orders: id, livemode, created_at, cart_version e terms_version são imutáveis' using errcode = 'KT010';
  end if;
  -- o dono nunca muda (atendimento: set local keytotwo.allow_reassign = 'on')
  if new.user_id is distinct from old.user_id
     and coalesce(current_setting('keytotwo.allow_reassign', true), 'off') <> 'on' then
    raise exception 'orders: o dono do pedido não muda' using errcode = 'KT010';
  end if;
  if old.stripe_checkout_session_id is not null
     and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'orders: stripe_checkout_session_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.stripe_payment_intent_id is not null
     and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'orders: stripe_payment_intent_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.terms_accepted_at is not null and new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'orders: terms_accepted_at não muda depois de gravado' using errcode = 'KT010';
  end if;
  -- D-24: o que foi cobrado (e o cupom) é gravado uma vez
  if (old.amount_total is not null and new.amount_total is distinct from old.amount_total)
     or (old.amount_subtotal is not null and new.amount_subtotal is distinct from old.amount_subtotal)
     or (old.amount_discount is not null and new.amount_discount is distinct from old.amount_discount)
     or (old.currency is not null and new.currency is distinct from old.currency)
     or (old.promotion_code is not null and new.promotion_code is distinct from old.promotion_code) then
    raise exception 'orders: valores e código promocional não mudam depois de gravados' using errcode = 'KT010';
  end if;
  if new.status is distinct from old.status and not private.order_transition_allowed(old.status, new.status) then
    raise exception 'orders: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
  end if;
  return new;
end $$;

-- order_items: só se inserem e se apagam com o pedido open; o valor cobrado entra uma vez (open ou pending_payment).
create function private.guard_order_item_changes() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = coalesce(new.order_id, old.order_id);

  if tg_op = 'INSERT' then
    if v_status is distinct from 'open' then
      raise exception 'order_items: só se inserem itens em pedido open' using errcode = 'KT010';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if v_status is not null and v_status <> 'open' then
      raise exception 'order_items: só se apagam itens de pedido open' using errcode = 'KT010';
    end if;
    return old;
  end if;

  if new.order_id is distinct from old.order_id
     or new.product_id is distinct from old.product_id
     or new.position is distinct from old.position
     or new.stripe_price_id is distinct from old.stripe_price_id then
    raise exception 'order_items: pedido, produto, posição e Price são imutáveis' using errcode = 'KT010';
  end if;
  if new.unit_amount is distinct from old.unit_amount or new.currency is distinct from old.currency then
    if old.unit_amount is not null or v_status not in ('open', 'pending_payment') then
      raise exception 'order_items: o valor cobrado entra uma vez, com o pedido open ou pending_payment' using errcode = 'KT010';
    end if;
  end if;
  return new;
end $$;

-- ===== triggers de public ========================================================================
create trigger products_set_updated_at     before update on public.products     for each row execute function private.set_updated_at();
create trigger games_set_updated_at        before update on public.games        for each row execute function private.set_updated_at();
create trigger files_set_updated_at        before update on public.files        for each row execute function private.set_updated_at();
create trigger carts_set_updated_at        before update on public.carts        for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at     before update on public.profiles     for each row execute function private.set_updated_at();
create trigger orders_set_updated_at       before update on public.orders       for each row execute function private.set_updated_at();
create trigger entitlements_set_updated_at before update on public.entitlements for each row execute function private.set_updated_at();
create trigger email_outbox_set_updated_at before update on public.email_outbox for each row execute function private.set_updated_at();

create trigger order_events_forbid_modification       before update or delete on public.order_events       for each row execute function private.forbid_modification();
create trigger stripe_events_forbid_modification      before update or delete on public.stripe_events      for each row execute function private.forbid_modification();
create trigger entitlement_games_forbid_modification before update or delete on public.entitlement_games for each row execute function private.forbid_modification();
create trigger marketing_consents_forbid_modification before update or delete on public.marketing_consents for each row execute function private.forbid_modification();
create trigger email_suppressions_forbid_modification before update or delete on public.email_suppressions for each row execute function private.forbid_modification();
create trigger download_events_guard before update or delete on public.download_events for each row execute function private.guard_user_nulling();
create trigger funnel_events_guard   before update or delete on public.funnel_events   for each row execute function private.guard_user_nulling();

create trigger marketing_consents_sync after insert on public.marketing_consents
  for each row execute function private.sync_profile_consent();

create trigger orders_guard_changes      before update on public.orders
  for each row execute function private.guard_order_changes();
create trigger order_items_guard_changes before insert or update or delete on public.order_items
  for each row execute function private.guard_order_item_changes();

create constraint trigger orders_consistency       after insert or update on public.orders
  deferrable initially deferred for each row execute function private.assert_order_entitlement_consistency();
create constraint trigger entitlements_consistency after insert or update on public.entitlements
  deferrable initially deferred for each row execute function private.assert_order_entitlement_consistency();
```

Outras funções e triggers internos (descritos aqui, escritos no I2b a partir do rascunho da v0.2.2 já ajustado às regras abaixo):

| Objeto | Onde | Regra |
| --- | --- | --- |
| `private.guard_file_changes()` | `files` (BEFORE UPDATE/DELETE) | `status` só avança (`draft→published→retired`, `KT006`); conteúdo (`game_id`, `product_id`, `kind`, `access`, `version`, `filename`, `size_bytes`, `sha256`, `published_at`) imutável depois de `draft` (`KT010`); só rascunho se apaga. Preenche `published_at`/`retired_at` se vierem nulos. |
| `private.guard_file_object_changes()` | `file_objects` (BEFORE UPDATE/DELETE) | `bucket` e `object_key` imutáveis quando o arquivo não é `draft`. |
| `private.access_effect(text)` | usada por `set_order_status` | Motivo da revogação que o estado impõe aos direitos de **todos** os itens: `disputed` e `dispute_lost` → `dispute`; `refunded` → `refund`; demais → NULL. `disputed→paid` reativa só os revogados por `dispute` (os `manual` ficam); `refunded` troca `dispute` por `refund` (o `manual` fica). |
| `private.cancel_order_emails(uuid, text)` | usada por `set_order_status` | Passa para `canceled` (com o motivo dado) os e-mails ainda `queued` de um pedido: contestação aberta e reembolso (`entitlement_revoked`). |
| `private.enqueue_followups(timestamptz)` | agenda do `pg_cron` (I5) | Seção 6.7. |

#### Triggers em `auth.users` (D-18)

```sql
-- @ddl
-- AFTER INSERT: cria o perfil; se o usuário já nasce confirmado (Google, criação administrativa), registra account_confirmed.
create function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  if new.email_confirmed_at is not null then
    insert into public.funnel_events (user_id, type) values (new.id, 'account_confirmed')
    on conflict (user_id) where type = 'account_confirmed' and user_id is not null do nothing;
  end if;
  return null;
end $$;

-- BEFORE UPDATE da PRIMEIRA confirmação (email_confirmed_at: NULL -> valor):
--  (a) zera a senha, a menos que o mesmo UPDATE já troque a senha (a nova veio com prova de posse do e-mail);
--  (b) garante o perfil; (c) registra account_confirmed (uma vez por usuário).
create function private.handle_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is not distinct from old.encrypted_password then
    new.encrypted_password := '';
  end if;
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.funnel_events (user_id, type) values (new.id, 'account_confirmed')
  on conflict (user_id) where type = 'account_confirmed' and user_id is not null do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();
create trigger on_auth_user_confirmed before update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_auth_user_confirmed();
```

Regras e limites da trigger:

- **Por que:** sem ela, quem cadastra o e-mail de outra pessoa com uma senha dele (conta não confirmada) passa a ter acesso quando a vítima confirma o e-mail por código ou Google. Zerar a senha na primeira confirmação invalida a senha definida antes da confirmação. O site pede uma senha nova logo após a confirmação (`updateUser`), já com sessão.
- **Só a primeira confirmação** (`NULL → valor`). Trocar a senha depois, trocar o e-mail e novos logins não são afetados.
- **A senha vira `''`** (não `NULL`) — **P-15 decidido pelo comportamento real do GoTrue v2.197**: `''` e `NULL` funcionam (login recusado, `GET /user`, código, `updateUser` e recuperação de senha, sem erro nos logs do Auth); fica `''` por ter sido o formato exercitado em todos os cenários do teste `supabase/tests/gotrue/trigger-senha.mjs`. Quem entra por código nasce com um bcrypt **aleatório** gravado pelo próprio GoTrue; a trigger o troca por `''` na confirmação. Tentar entrar com senha vazia é recusado.
- **Falha-segura:** nenhuma das funções levanta erro de propósito (`on conflict do nothing`); um erro na trigger derrubaria cadastro e login.
- **Segurança:** `SECURITY DEFINER`, `search_path` vazio, dono `postgres`; o `supabase_auth_admin` dispara sem precisar de privilégio em `public`.
- **Backfill:** a migração do I2b cria o perfil dos usuários que já existirem (`insert ... select ... on conflict do nothing`).
- **Dono do arquivo:** Lastro; desenho e revisão: Ferrolho.

#### Grants e RLS

```sql
-- @ddl
-- Modelo de migração: lista FIXA de tabelas (nunca "all tables in schema public": atingiria public.test).
-- D-12: NENHUM privilégio de tabela para anon, authenticated nem service_role.
do $$
declare t text;
begin
  foreach t in array array[
    'products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions',
    'carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games',
    'stripe_events','funnel_events','download_events','email_outbox']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format($p$create policy deny_client_access on public.%I as permissive
                      for all to anon, authenticated using (false) with check (false)$p$, t);
  end loop;
end $$;

-- identidades (reverte o padrão da plataforma, caso o projeto ainda o aplique)
revoke all on sequence public.products_id_seq, public.games_id_seq, public.order_events_id_seq,
                       public.download_events_id_seq, public.funnel_events_id_seq,
                       public.marketing_consents_id_seq
  from public, anon, authenticated, service_role;

-- funções internas: nenhum papel de API
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'private'::regnamespace
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
```

## 3. Invariantes

| # | Garantia | Mecanismo |
| --- | --- | --- |
| I-1 | Um pedido tem 1 ou mais itens (`order_items`) e um direito por item. | PK `(order_id, product_id)`; `entitlements unique (order_id, product_id)` + FK composta para o item |
| I-2 | Uma sessão ou intent da Stripe pertence a um único pedido; um cliente da Stripe a um único perfil. | `unique` em `stripe_checkout_session_id`, `stripe_payment_intent_id`, `profiles.stripe_customer_id` |
| I-3 | Um evento Stripe tem efeito no máximo uma vez. | PK de `stripe_events` + checagem sob a trava do pedido |
| I-4 | No máximo uma entrega (`delivery`) por pedido; um lembrete por versão do carrinho; um pós-compra por pedido. | `email_outbox.dedupe_key` único |
| I-5 | **Pedido `paid` ⇔ todos os itens têm direito `active`** (ou revogação manual de atendimento). `disputed`, `dispute_lost` e `refunded`: todos revogados. Demais estados: nenhum direito. | Trigger de restrição diferido (`assert_order_entitlement_consistency`) |
| I-6 | Transições de pedido só avançam pelas arestas da seção 4.1. | `guard_order_changes` (vale para RPC e SQL direto) |
| I-7 | Composição comprada não muda. | `entitlement_games` só inserção, sem FK de volta para `product_games` |
| I-8 | Um arquivo publicado por (jogo, tipo, acesso) e por (pacote, tipo). No máximo um jogo grátis publicado. | Índices únicos parciais |
| I-9 | Arquivo herda o `access` do jogo; jogo grátis nunca entra em produto. | FKs compostas `(game_id, access)` |
| I-10 | Chave do B2: sem URL, sem `..`, prefixo igual a `access`, única. | `file_objects_key_check`, `file_objects_location_key` |
| I-11 | Nenhuma coluna guarda URL (pública ou assinada). Nenhuma tabela guarda IP. | Revisão de schema + teste pgTAP T08 |
| I-12 | Logs não se alteram: `order_events`, `stripe_events`, `download_events`, `funnel_events`, `marketing_consents`, `email_suppressions`, `entitlement_games`. | `forbid_modification` / `guard_user_nulling` |
| I-13 | Só entra no carrinho e só é cobrado produto vendável **e não possuído por inteiro**. | `product_is_sellable` + `owned_game_ids` nas RPCs de carrinho e checkout |
| I-14 | E-mail armazenado sempre normalizado. | `CHECK` + `normalize_email` |
| I-15 | Todo pedido tem dono (`user_id NOT NULL`) e o dono não muda. | `NOT NULL` + `guard_order_changes` |
| I-16 | `profiles.marketing_opt_in` = última ação do histórico de consentimento. Marketing só sai com opt-in vigente, sem supressão, **checado no envio**. | `sync_profile_consent`; `marketing_allowed` em `claim_email_batch` |
| I-17 | A senha definida antes da primeira confirmação do e-mail não vale. | Trigger `on_auth_user_confirmed` |
| I-18 | Carrinho isolado por usuário, quantidade 1, `version` monotônica. | PK `(user_id, product_id)`; RPCs sob `FOR UPDATE` do carrinho |
| I-19 | Itens do pedido não mudam depois de `open` (exceto o valor cobrado, preenchido uma vez). | `guard_order_item_changes` |

## 4. Estados e transições

### 4.1 Pedido (`orders.status`)

```
open            → pending_payment | paid | failed | expired
pending_payment → paid | failed
paid            → disputed | refunded
disputed        → paid | dispute_lost | refunded
expired, failed, dispute_lost, refunded: terminais
```

| De → Para | Quem aplica | Gatilho (Stripe / fluxo) | Efeito nos direitos | Observação |
| --- | --- | --- | --- | --- |
| (novo) → `open` | `create_order_from_cart` | Finalizar compra | nenhum | Funil `checkout_started`. Reaproveita pedido `open` da mesma versão |
| `open` → `pending_payment` | `set_order_status` | `checkout.session.completed` com `payment_status='unpaid'` (método assíncrono) | nenhum | Exige subtotal, desconto, total e moeda (o aceite dos termos já está no pedido); grava o código promocional |
| `open` → `paid` | `fulfill_order` | `checkout.session.completed` com `payment_status='paid'` (ou `no_payment_required` com cupom de 100%, D-25); ou retorno | **cria** um direito `active` por item + fotografia; limpa do carrinho os produtos pagos e sobe a `version`; enfileira a entrega | Funil `order_paid`. Único caminho para `paid` a partir de `open` |
| `pending_payment` → `paid` | `fulfill_order` | `checkout.session.async_payment_succeeded` | idem | |
| `open`/`pending_payment` → `failed` | `set_order_status` | `checkout.session.async_payment_failed` (pode chegar antes do `completed`) | nenhum | Terminal; nova tentativa = novo pedido |
| `open` → `expired` | `set_order_status` | `checkout.session.expired` | nenhum | Terminal. Funil `checkout_expired` |
| `paid` → `disputed` | `set_order_status` | `charge.dispute.created` | **revoga todos** (`dispute`); cancela e-mails ainda na fila | Funil `dispute_opened` |
| `disputed` → `paid` | `set_order_status` | `charge.dispute.closed` ganha | **reativa** os revogados por `dispute` | Funil `dispute_closed`. Não reenvia a entrega |
| `disputed` → `dispute_lost` | `set_order_status` | `charge.dispute.closed` perdida | permanecem revogados | Terminal. Funil `dispute_closed` |
| `paid`/`disputed` → `refunded` | `set_order_status` | `charge.refunded` **manual e excepcional** (o produto não oferece reembolso) | **revoga todos** (`refund`); cancela e-mails na fila | Terminal. Reembolso é sempre do pedido inteiro; parcial só pelo suporte (D5), fora das RPCs |

Qualquer outro par: via RPC o resultado é `outcome='ignored'` (nada muda, evento registrado); via SQL direto, `KT006`.

**Eventos fora de ordem.** `disputed`, `dispute_lost` e `refunded` com o pedido ainda `open` ou `pending_payment` (o evento de cobrança chegou antes da liberação), e `dispute_lost` com o pedido ainda `paid` (a abertura da contestação não chegou), devolvem `outcome='deferred'`: nada muda e o evento **não** é gravado em `stripe_events`. A rota responde `500` e a Stripe reenvia. Com o pedido `failed` ou `expired`, continua `ignored`. Se a ordem nunca se resolver, a reconciliação é manual (`p_source='reconcile'`).

### 4.2 Direito (`entitlements.status`)

| De → Para | Quem | Quando |
| --- | --- | --- |
| (nenhum) → `active` | `fulfill_order` | Pagamento confirmado (um por item) |
| `active` → `revoked` | `set_order_status` | Contestação aberta (`dispute`) ou reembolso manual (`refund`), no pedido inteiro |
| `revoked` → `active` | `set_order_status` | Contestação vencida (`disputed→paid`), só os revogados por `dispute` |
| qualquer → `revoked (manual)` / restauração | SQL de atendimento | Fora das RPCs; o `manual` é o único motivo que a I-5 aceita em pedido `paid` |

Direito nunca é apagado e **não expira**.

### 4.3 Outros estados

| Entidade | Estados | Regra |
| --- | --- | --- |
| `products.status` | `draft → active → archived` | `active` exige nome, `stripe_price_id` e `games_expected` (CHECK). Ativar em produção é ato manual do responsável. |
| `games.status` | `draft ↔ published` | Publicado só com ao menos um PDF `published` (verificado por `product_is_sellable` e pelos resolvers). |
| `files.status` | `draft → published → retired` | Avança só para frente (`guard_file_changes`). |
| `email_outbox.status` | `queued → sending → sent`; `sending → queued` (nova tentativa, com `scheduled_at` adiado) ou `failed` (esgotou ou recusa definitiva); `queued → skipped` (regra do envio) ou `canceled` (fato posterior) | Seção 6.7. `sending` parado há mais de 10 minutos volta a ser elegível. |

## 5. Matriz de acesso

**Papéis:** `anon` (sem sessão), `authenticated` (sessão), `service_role` (backend; ignora RLS, mas **sem GRANT de tabela**). `postgres` é o dono e executa as RPCs `SECURITY DEFINER`.

### 5.1 Tabelas

| Tabela | anon | authenticated | service_role | RLS / policy |
| --- | --- | --- | --- | --- |
| as 19 tabelas da seção 2 | nada | nada | **nada** (só as RPCs leem e escrevem) | RLS on; `deny_client_access` |

- Nenhum papel de API tem `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` ou `TRIGGER` em tabela, nem uso de sequência. Não há exceção (a v0.2.2 liberava `email_outbox`; a fila agora vai por RPC).
- `deny_client_access`: `for all to anon, authenticated using (false) with check (false)`. Redundante com a ausência de GRANT de propósito (defesa em profundidade, documenta a intenção e silencia o aviso `rls_enabled_no_policy`). `service_role` não precisa de policy.
- Suporte, diagnóstico e testes que contam linhas usam o dono (`postgres`, via `psql`/SQL Editor), não a chave secreta.

O bloco de RLS e GRANT está em 2.10 (`-- @ddl`).

### 5.2 Funções

| Função | anon | authenticated | service_role |
| --- | --- | --- | --- |
| as 22 RPCs da seção 6 | nada | nada | `EXECUTE` |
| `private.*` | nada | nada | nada (só o dono) |

```sql
-- Modelo por RPC (repetir em toda migração que recriar a função). Exemplo:
revoke all on function public.cart_add(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.cart_add(uuid, text) to service_role;
```

Tipos das 22 assinaturas (para `REVOKE`/`GRANT` e para `has_function_privilege` nos testes):

```
get_catalog()
get_cart(uuid)
cart_add(uuid, text)
cart_remove(uuid, text)
create_order_from_cart(uuid, boolean, integer, text, boolean)
attach_checkout_session(uuid, text, timestamptz)
set_stripe_customer(uuid, text)
fulfill_order(uuid, text, text, bigint, text, text, text, boolean, jsonb, text, text)
set_order_status(uuid, text, text, text, text, bigint, text, text)
get_order_status(uuid, uuid)
get_library(uuid)
get_account(uuid)
set_marketing_consent(uuid, boolean, text, text)
mark_marketing_prompt(uuid)
unsubscribe(uuid, text)
record_email_event(text, text, text, timestamptz)
resolve_download(uuid, uuid)
resolve_delivery(uuid, bigint)
get_free_game()
resolve_free_download(uuid)
claim_email_batch(integer, uuid, timestamptz)
mark_email_result(uuid, text, text, text)
```

### 5.3 Regra da Data API (vale para tudo)

Desde 2026-10-30 tabelas novas em `public` não recebem GRANT automático. Este contrato **nunca depende do padrão da plataforma**: cada objeto novo recebe `REVOKE ALL` e os GRANTs da matriz. Funciona nos dois regimes. Se um dia o cliente precisar ler algo direto (P-6): `GRANT SELECT (colunas)` + policy `to authenticated using ((select auth.uid()) = user_id)` + índice em `user_id` (já existe em `orders`, `entitlements`, `carts`, `profiles`).

## 6. RPCs

Todas: `security definer`, `search_path=''`, `EXECUTE` só `service_role`, chamadas pelo backend com a chave secreta. O backend autentica o usuário (JWT) e passa o `user_id` já verificado; nenhuma RPC confia em dado do navegador. As que recebem `p_user_id` exigem e-mail confirmado (`KT009`), exceto `unsubscribe`.

### 6.1 Códigos de erro (`SQLSTATE`)

| Código | Nome | Quando | HTTP no PostgREST |
| --- | --- | --- | --- |
| `KT001` | `invalid_argument` | Argumento nulo, fora do formato ou valor desconhecido | 400 |
| `KT002` | `payment_not_confirmed` | `fulfill_order` com `p_payment_status` diferente de `paid`; `no_payment_required` só passa com total 0 e desconto > 0 (cupom de 100%, D-25) | 400 |
| `KT003` | `product_unavailable` | `fulfill_order` com item cujo produto não tem jogos (composição vazia) | 400 |
| `KT004` | `session_conflict` | Sessão, intent ou cliente da Stripe diferente do já associado | 400 |
| `KT005` | `livemode_mismatch` | `p_livemode` ≠ `orders.livemode` | 400 |
| `KT006` | `invalid_transition` | Só via SQL direto (trigger). As RPCs devolvem `outcome='ignored'` (ou `'deferred'`) | 400 |
| `KT007` | `data_required` | Falta valor ou moeda para o estado pedido; termos não aceitos em `create_order_from_cart` (e, como defesa, `orders.terms_accepted_at` nulo na liberação) | 400 |
| `KT008` | `append_only` | `UPDATE`/`DELETE` em tabela de log | 400 |
| `KT009` | `email_not_confirmed` | Usuário inexistente, removido ou sem `email_confirmed_at` (vira 403 `EMAIL_NOT_CONFIRMED`) | 400 |
| `KT010` | `immutable_column` | Alterar coluna imutável (pedido, item, arquivo) | 400 |
| `KT011` | `access_inconsistent` | I-5 violada no commit (pagamento e direitos divergem) | 400 |
| `KT012` | `items_mismatch` | `fulfill_order`: as `line_items` da sessão não batem com os itens do pedido, ou os valores (soma dos itens, subtotal, desconto, total) não fecham ou diferem do já gravado; `set_order_status('pending_payment')` com valores que não fecham | 400 |

Violação de unicidade (`23505`) de sessão/intent de outro pedido também chega como erro; tratar como `KT004`. **Resposta do webhook:** `200` com log nos casos que reenvio não resolve (`KT001`, `KT002`, `KT004`, `KT005`, `KT007`, `KT012`); `500` nos defeitos nossos ou de dados, que o reparo cura e a Stripe reenvia por até 3 dias (`KT003`, `KT010`, `KT011`) e nas falhas de rede ou de banco. `KT003` (composição vazia de um produto já pago) fica em `500` de propósito: `200` deixaria um cliente pago sem acesso até a reconciliação manual, enquanto o reenvio libera o pedido assim que a composição for corrigida. Cupom: `no_payment_required` com total 0 e desconto > 0 é cupom de 100% e libera o acesso (D-25); qualquer outro `no_payment_required` é `KT002` (nada foi cobrado nem desconto aplicado).

### 6.2 Catálogo e carrinho

Regra de **posse**: o usuário possui um jogo se tem direito `active` cuja fotografia o contém (`private.owned_game_ids`). **Posse sobreposta (D-16):** produto cujos jogos o usuário já tem **todos** é recusado (`already_owned`); sobreposição **parcial** é aceita e sinalizada (`owned_games`), sem desconto. Sobreposição entre itens do próprio carrinho também é sinalizada (`shared_with`).

```sql
create function public.get_catalog() returns jsonb;
```
- `[ { "code", "kind", "name", "stripe_price_id", "games": [ { "code", "name" } ] } ]`: produtos `active` e vendáveis (`product_is_sellable`), jogos por `position`. O preço mostrado vem da Stripe (Price), em cache curto na rota.

```sql
create function public.get_cart(p_user_id uuid) returns jsonb;
```
- `{ "version": 3, "items": [ { "code", "kind", "name", "stripe_price_id", "games": [ { "code", "name" } ], "available": true, "status": "ok", "owned_games": [ "…" ], "shared_with": [ "…" ] } ] }`.
- `status`: `ok` | `unavailable` (deixou de ser vendável) | `already_owned` (o usuário passou a possuir todos os jogos). `available = (status = 'ok')`. Itens na ordem de `added_at`. Sem carrinho: `{"version": 0, "items": []}`.

```sql
create function public.cart_add(p_user_id uuid, p_product_code text)
  returns table (outcome text, cart_version integer, owned_games jsonb);
```
- `outcome`: `added` | `noop` (já no carrinho) | `already_owned` | `product_unavailable`. `owned_games` = códigos dos jogos do produto que o usuário já possui (aviso de sobreposição parcial).
- Cria o carrinho se não existe; trava o carrinho `FOR UPDATE`; `added` sobe a `version` e grava o funil `cart_item_added`.

```sql
create function public.cart_remove(p_user_id uuid, p_product_code text)
  returns table (outcome text, cart_version integer);   -- 'removed' | 'noop'
```
- `removed` sobe a `version` e grava `cart_item_removed`. Código desconhecido ou fora do carrinho: `noop`.

### 6.3 Checkout

```sql
create function public.create_order_from_cart(
  p_user_id       uuid,
  p_livemode      boolean,   -- obrigatório: vem da chave da Stripe do ambiente
  p_cart_version  integer,   -- a versão que o usuário viu
  p_terms_version text,      -- versão dos termos mostrada na página do site
  p_terms_accepted boolean   -- o usuário aceitou os termos (sem reembolso) antes do formulário; precisa ser true
) returns table (
  outcome            text,    -- 'ok' | 'cart_empty' | 'cart_changed' | 'product_unavailable' | 'already_owned'
  order_id           uuid,
  email              text,    -- e-mail da conta (pré-preenche o formulário embutido)
  stripe_customer_id text,    -- NULL antes do 1º checkout (a rota cria o cliente e chama set_stripe_customer)
  items              jsonb,   -- [ { "product_code", "stripe_price_id" } ] por position
  reused             boolean,
  detail             jsonb    -- códigos dos produtos que causaram o recuso; versão atual em cart_changed
);
```
1. `require_confirmed_email` → e-mail da conta. `p_terms_accepted` diferente de `true`: `KT007`, sem gravar nada.
2. Trava o carrinho `FOR UPDATE`. Sem carrinho ou vazio: `cart_empty`. `version` diferente de `p_cart_version`: `cart_changed` (com a versão atual em `detail`).
3. Algum item não vendável: `product_unavailable`. Algum item com todos os jogos já possuídos: `already_owned`. Ambos com os códigos em `detail`.
4. **Reaproveita** o pedido `open` do usuário com a mesma `cart_version`, o mesmo `livemode`, o **mesmo `terms_version`**, os mesmos itens com os **mesmos `stripe_price_id` de hoje** e `checkout_expires_at` nulo ou futuro (`reused=true`; o Checkout recria a mesma sessão pela chave de idempotência `order_id`). Outra versão dos termos, outro ambiente, um Price que mudou ou uma sessão vencida criam pedido novo, com novo aceite; o pedido antigo segue `open` até o `expired` da Stripe. O reaproveitamento lê o pedido sem travá-lo (a ordem de travas é pedido, depois carrinho).
5. Senão grava o pedido `open` (`email` da conta, `cart_version`, `terms_version`, **`terms_accepted_at = now()`**, `livemode`), os `order_items` com `position` pela ordem de `added_at` (empate: id do produto) e o `stripe_price_id` atual de cada produto, a trilha `order_events` (`null → open`, origem `checkout`) e o funil `checkout_started`.

`detail`: `{"cart_version": N}` em `cart_changed`; `{"product_codes": ["…"]}` em `product_unavailable` e `already_owned` (`product_unavailable` tem precedência); nulo nos demais casos. Fora do `ok`, só `outcome` e `detail` vêm preenchidos.

Concorrência: dois checkouts simultâneos do mesmo usuário serializam na trava do carrinho; o segundo reaproveita o pedido do primeiro.

```sql
create function public.attach_checkout_session(p_order_id uuid, p_checkout_session_id text,
                                               p_expires_at timestamptz default null)
  returns text;   -- 'applied' | 'noop' | 'ignored' | 'not_found'
```
- Avaliação: `KT001` (pedido nulo ou sessão fora de `cs_(test|live)_…`) → `not_found` → `KT005` (prefixo `cs_live_` diferente de `orders.livemode`) → sessão já gravada: igual = `noop`, diferente = `KT004` → pedido que não está `open` = `ignored` → `applied` (grava a sessão e `checkout_expires_at`). Sessão de outro pedido: `23505`. Trava o pedido `FOR UPDATE`.

```sql
create function public.set_stripe_customer(p_user_id uuid, p_stripe_customer_id text) returns text;
```
- Devolve o `cus_…` **vigente**. Se o perfil ainda não tem, grava; se já tem, **não sobrescreve** e devolve o gravado. Cliente já usado por outro perfil: `23505`. Atualização condicional (`where stripe_customer_id is null`), sem corrida.

### 6.4 `fulfill_order`: pagamento confirmado → pedido `paid` + um direito por item

```sql
create function public.fulfill_order(
  p_order_id            uuid,           -- orders.id (vem de client_reference_id)
  p_checkout_session_id text,           -- cs_...
  p_payment_status      text,           -- 'paid'; 'no_payment_required' só com total 0 e desconto > 0 (cupom de 100%, D-25)
  p_amount_subtotal     bigint,         -- centavos, da sessão: soma dos preços cheios, antes do desconto
  p_amount_discount     bigint,         -- centavos: total_details.amount_discount da sessão (0 sem cupom)
  p_amount_total        bigint,         -- centavos, da sessão (= subtotal − desconto, sem imposto)
  p_currency            text,
  p_promotion_code      text,           -- texto do código promocional (promotion_code.code); NULL sem código
  p_payment_intent_id   text,           -- pi_...; aceita NULL (cupom de 100%); nunca apaga nem sobrescreve o já gravado
  p_customer_id         text,           -- cus_...; confere/grava no perfil
  p_livemode            boolean,
  p_items               jsonb,          -- line_items: [ { "stripe_price_id", "quantity", "unit_amount" (PREÇO CHEIO), "currency" } ]
  p_source              text default 'webhook',   -- 'webhook' | 'return_page' | 'reconcile'
  p_stripe_event_id     text default null,        -- evt_...; null fora do webhook
  p_event_type          text default null         -- event.type, para o livro-razão (null grava 'unspecified')
) returns table (
  outcome           text,      -- 'applied' | 'noop' | 'duplicate_event' | 'ignored' | 'not_found'
  order_id          uuid,
  order_status      text,
  entitlement_count integer,
  outbox_id         uuid,      -- e-mail de entrega (delivery) do pedido
  send_delivery     boolean    -- true SÓ para a chamada que criou a linha da entrega
);
```

**Algoritmo (uma transação):**

1. Validar argumentos (`KT001`; só `p_promotion_code`, `p_payment_intent_id`, `p_customer_id`, `p_stripe_event_id` e `p_event_type` podem ser NULL; `p_items` é uma lista não vazia; valores ≥ 0; moeda em minúsculas). Pagamento: `p_payment_status = 'paid'`, ou `'no_payment_required'` com `p_amount_total = 0` e `p_amount_discount > 0` (cupom de 100%, D-25); senão `KT002`.
2. `select ... from orders where id = p_order_id for update`. Não existe: `not_found` (grava o evento, se houver, com `order_id` nulo; evento já gravado: `duplicate_event`).
3. `p_livemode` ≠ `orders.livemode`, ou prefixo da sessão (`cs_live_`) incoerente com o pedido: `KT005`.
4. `p_stripe_event_id` já em `stripe_events`: `duplicate_event`, **nada muda**.
5. Sessão e intent: o pedido não pode estar associado a outra sessão nem a outro intent (`KT004`; intent `NULL` é aceito). Cliente: o perfil não pode ter outro `stripe_customer_id` (`KT004`).
6. Estado: `open`/`pending_payment` → segue; `paid` → `noop`; demais → `ignored`. Em `noop` e `ignored` o evento fica no livro-razão com esse resultado e nada mais muda.
7. **Itens e valores (`KT012`):** `p_items` precisa ter exatamente os `stripe_price_id` dos `order_items` (cada um uma vez, `quantity = 1`, `unit_amount` inteiro ≥ 0, `currency = p_currency`); a soma dos `unit_amount` tem de ser o `p_amount_subtotal`; `p_amount_discount ≤ p_amount_subtotal`; `p_amount_subtotal − p_amount_discount = p_amount_total`. Se o pedido já tem valores (de `pending_payment`), a sessão não pode trazer outros; um código promocional já gravado não pode ser trocado (se a sessão vier sem código, vale o gravado). Preenche `unit_amount` (preço cheio) e `currency` de cada item.
8. `orders`: `status='paid'`, `paid_at=now()`, `amount_subtotal`, `amount_discount`, `amount_total`, `currency`, `promotion_code` (sem espaços; vazio vira NULL) e intent. O aceite dos termos já está gravado desde a criação do pedido. O perfil sem cliente da Stripe recebe `p_customer_id`.
9. Para cada item: `insert into entitlements ... on conflict (order_id, product_id) do nothing`; se inseriu, copia `product_games` do produto para `entitlement_games` (produto sem jogos: `KT003`, e nada do pedido é gravado).
10. **Carrinho:** trava o carrinho (depois do pedido), apaga de `cart_items` os produtos do pedido e **sobe a `version`**. Cancela os `cart_reminder` ainda `queued` do usuário (`skip_reason='already_purchased'`).
11. **Entrega:** `insert into email_outbox (kind 'delivery', category 'transactional', dedupe_key 'delivery:{order_id}', to_email, payload) on conflict (dedupe_key) do nothing` → `send_delivery := inseriu`. `to_email` = `auth.users.email` normalizado do dono (senão, `orders.email`). `payload` conforme a seção 2.9, com **um jogo por jogo comprado** (se o mesmo jogo chega por dois itens do pedido, aparece uma vez, com o direito do item de menor `position`).
12. `order_events` (origem `p_source`, com o evento); funil `order_paid`; `stripe_events` (`applied`, com `p_event_type` e a sessão como `stripe_object_id`). Retorna `applied`.

**Idempotência e concorrência**

| Situação | Resultado |
| --- | --- |
| Primeira chamada | `applied`: pedido `paid`, N direitos e N fotografias, 1 entrega `queued`, carrinho sem os itens pagos e com `version` maior, 1 `order_event`, 1 `stripe_event`, funil `order_paid` |
| Mesmo evento reenviado | `duplicate_event`; contagens idênticas; `send_delivery=false` |
| Outro evento ou página de retorno para o mesmo pedido | `noop`; `send_delivery=false`; devolve o `outbox_id` da entrega que já existe |
| N chamadas simultâneas (webhook + order-status) | A trava `FOR UPDATE` do pedido serializa; a 2ª em diante relê o pedido já `paid` e devolve `noop`/`duplicate_event`. Exatamente uma `applied` e uma com `send_delivery=true` (T120, T121) |
| Falha antes do commit (inclusive `KT003`, `KT004`, `KT012`) | Nada gravado (inclusive o evento): a Stripe reenvia |

Ordem de travas: **pedido, depois carrinho**. `create_order_from_cart` só trava o carrinho (e insere um pedido novo) e `cart_add`/`cart_remove` só o carrinho: não há ciclo (T127).

Exemplo (supabase-js, backend), com o código promocional lido da sessão (`total_details.breakdown.discounts[].promotion_code.code`, expandido na leitura):

```ts
const { data, error } = await admin.rpc('fulfill_order', {
  p_order_id: session.client_reference_id,
  p_checkout_session_id: session.id,
  p_payment_status: session.payment_status,           // 'paid'; 'no_payment_required' só com cupom de 100% (D-25)
  p_amount_subtotal: session.amount_subtotal,
  p_amount_discount: session.total_details?.amount_discount ?? 0,
  p_amount_total: session.amount_total,
  p_currency: session.currency,
  p_promotion_code: promotionCode ?? null,            // texto digitado (ex.: "TESTE10") ou null
  p_payment_intent_id: typeof session.payment_intent === 'string'    // NULL quando não há intent
    ? session.payment_intent
    : (session.payment_intent?.id ?? null),
  p_customer_id: typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null),
  p_livemode: session.livemode,
  p_items: lineItems.map((li) => ({
    stripe_price_id: li.price.id, quantity: li.quantity, unit_amount: li.price.unit_amount, currency: li.currency })),   // PREÇO CHEIO
  p_source: 'webhook',
  p_stripe_event_id: event.id,
  p_event_type: event.type,
});
// data[0] = { outcome: 'applied', order_id, order_status: 'paid', entitlement_count: 2, outbox_id, send_delivery: true }
if (data[0].send_delivery) await dispatchEmail(data[0].outbox_id);   // depois do commit (claim_email_batch com p_outbox_id)
```

### 6.5 `set_order_status`: demais transições

```sql
create function public.set_order_status(
  p_order_id           uuid,
  p_new_status         text,     -- 'pending_payment' | 'failed' | 'expired' | 'disputed' | 'dispute_lost' | 'refunded' | 'paid' (só a partir de 'disputed')
  p_source             text default 'webhook',   -- 'webhook' | 'return_page' | 'reconcile'
  p_stripe_event_id    text default null,
  p_reason             text default null,   -- livre, sem dado pessoal, até 200 caracteres (ex.: o motivo da contestação)
  p_amount_total       bigint default null, -- para 'pending_payment'
  p_currency           text default null,   -- para 'pending_payment'
  p_payment_intent_id  text default null,   -- para 'pending_payment'
  p_amount_subtotal    bigint default null, -- para 'pending_payment' (D-24)
  p_amount_discount    bigint default null, -- para 'pending_payment' (D-24)
  p_promotion_code     text default null,   -- para 'pending_payment' (D-24)
  p_event_type         text default null    -- event.type, para o livro-razão (null grava 'unspecified')
) returns table (
  outcome            text,   -- 'applied' | 'noop' | 'duplicate_event' | 'ignored' | 'deferred' | 'not_found'
  order_id           uuid,
  previous_status    text,
  order_status       text,
  entitlement_status text    -- 'active' (algum direito ativo) | 'revoked' (todos revogados) | null (sem direitos)
);
```

- O backend resolve o `order_id` antes, pelo `client_reference_id` da sessão. Nos eventos de cobrança (`charge.*`), que trazem o intent, a rota busca na Stripe a sessão do `payment_intent` e usa o `client_reference_id` dela, sem ler o banco.
- Ordem de avaliação: `KT001` (argumentos) → `not_found` → `duplicate_event` → `noop` (mesmo estado) → `KT001` (`paid` a partir de `open`/`pending_payment`: use `fulfill_order`) → `deferred` → `ignored` (aresta inexistente) → `applied`. `not_found` **não grava** o evento (sem pedido não há `livemode` para o livro-razão): a rota registra no log.
- `p_new_status = 'open'` ou desconhecido: `KT001`. `pending_payment` exige subtotal, desconto, total e moeda (`KT007`) que fechem (`desconto ≤ subtotal` e `subtotal − desconto = total`, senão `KT012`); grava o código promocional e o intent, se vierem. O aceite dos termos já está no pedido.
- Efeitos (seção 4.1): `disputed` revoga **todos** os direitos ativos do pedido (`dispute`) e cancela os e-mails `queued` do pedido (`entitlement_revoked`); `disputed→paid` reativa os revogados por `dispute` (os `manual` ficam); `dispute_lost` mantém revogado; `refunded` grava `refunded_at`, revoga todos (`refund`; os que a contestação tinha revogado passam a `refund`, o `manual` fica) e cancela e-mails `queued`. Funil: `checkout_expired` (em `expired`), `dispute_opened` (em `disputed`), `dispute_closed` (em `disputed→paid` e `disputed→dispute_lost`). Motivo do estado nos direitos: `private.access_effect`.
- Concorrência: mesma trava `FOR UPDATE` do pedido. Um evento de contestação que ganha a trava antes de `fulfill_order` devolve `deferred`; reenviado depois, vira `applied` (T122).

### 6.6 Consulta: `get_order_status`, `get_library`, `get_account`

```sql
create function public.get_order_status(p_order_id uuid, p_user_id uuid)
  returns table (outcome text, status text, items jsonb, relation text);
```
- `outcome`: `ok` | `not_found` (os demais campos vêm nulos). `status` é o `orders.status`. `items` = `[ { "code", "name" } ]` por `position`, **só para o dono**; para `other` vem NULL (defesa em profundidade: a rota também não mostra). `relation`: `owner` (`orders.user_id = p_user_id`) ou `other` (qualquer outro). Nunca devolve e-mail, valores nem id de usuário. A rota localiza o pedido pelo `client_reference_id` da sessão. `KT009` sem e-mail confirmado; `KT001` com argumento nulo.

```sql
create function public.get_library(p_user_id uuid) returns jsonb;
```
Por **jogo**, com os produtos de origem, e os pedidos em processamento:

```json
{ "games": [ { "code": "…", "name": "…", "acquired_at": "…",
               "products": [ { "code": "P001", "name": "…" } ],
               "files": [ { "id": "…", "kind": "pdf", "version": "1.0", "size_bytes": 1234 } ] } ],
  "pending": [ { "ref": "A1B2C3D4", "created_at": "…", "products": [ { "code": "…", "name": "…" } ] } ] }
```
- `games`: jogos das fotografias dos direitos `active` do usuário, sem repetir (mesmo jogo por dois produtos: um item com os dois em `products`). `acquired_at` = o menor `granted_at`. Ordem: `acquired_at`, menor `position`, `code`. `files` traz só `published` e `access='paid'` (jogo sem arquivo publicado aparece com `"files": []`: a compra é preservada).
- `pending`: pedidos do usuário em `pending_payment`, do mais recente ao mais antigo.
- O ZIP do pacote (`bundle_file`) não entra na v0.3 (ZIP completo está em "Depois"). Sem compras: `{"games": [], "pending": []}`. Nunca inclui chave do B2, URL nem e-mail.

```sql
create function public.get_account(p_user_id uuid) returns jsonb;
```

```json
{ "email": "…",
  "marketing": { "opted_in": true, "updated_at": "…", "text_version": "v1", "prompted_at": "…" },
  "orders": [ { "ref": "A1B2C3D4", "created_at": "…", "paid_at": "…", "status": "paid",
                "amount_subtotal": 0, "amount_discount": 0, "amount_total": 0, "currency": "brl", "promotion_code": null,
                "items": [ { "code": "P001", "name": "…", "unit_amount": 0, "currency": "brl" } ] } ] }
```
- `email`: `auth.users.email`. `marketing.opted_in` vem de `profiles`; `updated_at` = a última linha do histórico (NULL se nunca houve); `text_version` = a do consentimento vigente (NULL sem opt-in); `prompted_at` = `profiles.marketing_prompted_at` (NULL se o convite nunca foi exibido).
- `orders`: do usuário, **sem** `open` e `expired`, do mais recente ao mais antigo; `ref` de 8 caracteres maiúsculos; `items` por `position` (com o **preço cheio** em `unit_amount`; subtotal, desconto, total e código do cupom ficam no pedido; nulos antes de `pending_payment`). Sem ids da Stripe nem URL (o comprovante, se adotado, a rota busca na Stripe).

### 6.7 Consentimento, supressão e fila de e-mail

```sql
create function public.set_marketing_consent(p_user_id uuid, p_granted boolean, p_source text,
                                             p_text_version text default null)
  returns table (outcome text, opted_in boolean);   -- 'applied' | 'noop'
```
- `p_source` ∈ `signup_prompt`, `account`, `cart` (origens do usuário). Conceder exige `p_text_version` (`KT001`). **Mesmo estado não cria linha** no histórico (`noop`). Insere em `marketing_consents` (e-mail da conta como fotografia); a trigger atualiza `profiles`. Revogar cancela o marketing ainda na fila (`no_opt_in`). Com `p_source = 'signup_prompt'`, preenche também `profiles.marketing_prompted_at` se estiver nulo (inclusive em `noop`: a pessoa viu o convite).

```sql
create function public.mark_marketing_prompt(p_user_id uuid) returns timestamptz;
```
- Idempotente: grava `now()` em `profiles.marketing_prompted_at` se estiver nulo e devolve o valor gravado. `KT009` como as demais RPCs com `p_user_id`. **Não é consentimento:** ver ou dispensar o convite não grava nada em `marketing_consents` e não muda `marketing_opt_in`. O site usa o marcador para não repetir o convite entre aparelhos.

```sql
create function public.unsubscribe(p_user_id uuid, p_source text default 'unsubscribe_link')
  returns table (outcome text, opted_in boolean);   -- 'applied' | 'noop'
```
- Descadastro em 1 clique (token HMAC verificado pela rota). Registra `revoked` (origem `unsubscribe_link` ou `support`) e cancela os e-mails de marketing `queued` do usuário (`no_opt_in`). **Não exige e-mail confirmado**; efeito imediato.

```sql
create function public.record_email_event(p_email text, p_event text, p_provider_message_id text default null,
                                          p_occurred_at timestamptz default now())
  returns table (outcome text, user_id uuid);   -- 'applied' | 'noop'
```
- `p_event` ∈ `hard_bounce`, `complaint`, `unsubscribe` (este grava o motivo `unsubscribe_all`); evento desconhecido (inclusive `soft_bounce` e `delivered`), nulo ou e-mail fora do formato: `KT001`. O e-mail é normalizado (maiúsculas e espaços não importam).
- Insere em `email_suppressions` (origem `brevo_webhook`, mensagem do provedor cortada em 200 caracteres); **idempotente** por `(email, motivo)`. **O horário que vale é o do evento** (`p_occurred_at`; no futuro vira agora) e vai para `occurred_at` e `created_at`, de modo que um descadastro **anterior** ao opt-in não bloqueia o opt-in novo. A supressão vale mesmo sem conta (`user_id` nulo no retorno); conta removida não casa.
- `complaint` e `unsubscribe`, com conta cujo consentimento está vigente e o evento é **posterior** ao opt-in: revogam o consentimento (origem `brevo_webhook`) e cancelam o marketing na fila (`no_opt_in`); a transacional (entrega) não é tocada. Por isso, depois de um novo opt-in, um **novo** descadastro ainda revoga (a supressão antiga é a mesma linha), e o reenvio de um evento velho não revoga o opt-in novo. `hard_bounce` só suprime: o marketing que estiver na fila é barrado no envio (`suppressed`).
- `outcome`: `applied` (a supressão foi inserida ou o consentimento foi revogado) | `noop`; `user_id` volta nos dois casos.


```sql
create function public.claim_email_batch(p_limit integer default 20, p_outbox_id uuid default null,
                                         p_now timestamptz default now())
  returns table (id uuid, kind text, category text, user_id uuid, order_id uuid,
                 to_email text, payload jsonb, attempts integer);
```
- `p_limit` de 1 a 200 e `p_now` não nulo (`KT001`). Examina até `p_limit` e-mails vencidos (`scheduled_at <= p_now`; `queued`, ou `sending` parado há mais de 10 minutos), do mais antigo ao mais novo, com `FOR UPDATE SKIP LOCKED`, ou só o `p_outbox_id` (envio imediato depois do `COMMIT`). **Devolve só os que ficaram `sending`** (com `locked_at = p_now`); os cancelados, pulados e adiados saem da fila sozinhos e não voltam na resposta. Dois despachantes ao mesmo tempo nunca recebem a mesma linha (T125).
- `sending` parado há mais de 10 minutos (o despachante caiu) volta e **conta uma tentativa**; na 5ª, vira `failed` (`last_error` "despachante não respondeu (timeout)") em vez de travar a fila.
- **Marketing é rechecado aqui** (opt-in vigente, e-mail confirmado, supressão):
  - sem `marketing_allowed` → `skipped`: `no_opt_in` (sem opt-in), `email_not_confirmed` (e-mail não confirmado ou conta removida) ou `suppressed` (bounce, queixa, descadastro geral depois do opt-in);
  - `cart_reminder`: carrinho vazio ou inexistente → `skipped` (`cart_empty`); `version` diferente da do `payload` (ou `payload` sem `cart_version`) → `skipped` (`cart_changed`);
  - `post_purchase` com o pedido fora de `paid` → `skipped` (`order_not_paid`);
  - limite de **1 e-mail de marketing por pessoa a cada 24 h** (D3, janela móvel): se o último `sent` do usuário tem menos de 24 h, ou se outro marketing dele está `sending`, o e-mail **não é pulado**: volta a `queued` com `scheduled_at` = 24 h depois desse envio. A entrega transacional não conta nem sofre o limite.
- Transacional (`delivery`): pedido `disputed`, `dispute_lost` ou `refunded`, ou algum direito do pedido fora de `active` → `canceled` (`entitlement_revoked`); pedido em outro estado que não `paid` → `canceled` (`order_not_paid`); senão segue.

```sql
create function public.mark_email_result(p_id uuid, p_status text,
                                          p_provider_message_id text default null, p_error text default null)
  returns table (outcome text, status text, next_attempt_at timestamptz);
```
- `p_status` ∈ `sent`, `failed` (erro transitório) e `rejected` (recusa definitiva do provedor); outro valor ou `p_id` nulo: `KT001`. `outcome`: `applied` | `noop` | `not_found`. Só vale para linhas `sending`; para linha que já saiu de `sending` (ou nunca entrou) o resultado é `noop`, com o estado atual, e nada muda.
- `sent`: grava `sent_at`, a mensagem do provedor (até 200 caracteres) e, na entrega, o funil `delivery_sent` (uma vez por pedido). `failed`: soma uma tentativa; abaixo de 5 volta a `queued` com `scheduled_at` adiado em **5 min × tentativas²** (5, 20, 45 e 80 min) e devolve essa data em `next_attempt_at`; a 5ª falha é `failed` final. `rejected` vai direto a `failed` (uma tentativa a mais). `last_error` é cortado em 500 caracteres. O banco decide a nova tentativa; a rota só informa o resultado.


**`private.enqueue_followups(p_now timestamptz default now()) returns integer`** (chamada só pela agenda; **nenhum papel de API executa**; devolve quantos e-mails enfileirou). As constantes são a **proposta D3** (P-18) e ficam à vista na função:

| Fluxo | Regra | `dedupe_key` |
| --- | --- | --- |
| `cart_reminder` | Carrinho cuja última mudança (`carts.updated_at`) foi há **3 h ou mais** (inclusivo), com ao menos um item **vendável e ainda não possuído por inteiro**; usuário com `marketing_allowed`; sem pedido em `pending_payment`; um por `version` | `cart_reminder:{user_id}:{cart_version}` |
| `post_purchase` | Pedido `paid` entre **3 dias (inclusivo) e 14 dias (exclusivo)** atrás, com direito ativo; usuário com `marketing_allowed`; um por pedido. A janela superior evita disparar pós-compra de pedido velho quando a agenda ligar | `post_purchase:{order_id}` |

- `scheduled_at = least(p_now, now())`: em produção é `p_now`; permite ao teste adiantar o relógio do enfileiramento (`p_now = now() + 4 h`) e ainda assim ter a linha vencida para o `claim_email_batch` com `now()`.
- **Nunca enfileira** sem opt-in, com supressão, para e-mail não confirmado, carrinho vazio, item fora do ar ou já possuído, nem lembrete cujo carrinho foi pago depois (a `version` sobe e o carrinho esvazia na compra). Conferir de novo no envio é obrigatório (`claim_email_batch`). O `payload` do lembrete: `{ "cart_version": 3, "items": [ { "code", "name" } ] }` (só os itens vendáveis e não possuídos); do pós-compra: `{ "order_ref", "games": [ { "code", "name" } ] }` (um por jogo, na ordem dos itens). A linha traz `user_id` e o e-mail da conta; o despachante gera o token de descadastro com o `user_id` que o `claim_email_batch` devolve.


**O que cancela ou pula**

| Evento | Efeito na fila |
| --- | --- |
| Compra paga (`fulfill_order`) | `cart_reminder` `queued` do usuário → `canceled` (`already_purchased`) |
| Contestação aberta ou reembolso | e-mails `queued` do pedido → `canceled` (`entitlement_revoked`) |
| Descadastro, queixa, `unsubscribe_all` | marketing `queued` do usuário → `canceled` (`no_opt_in`) |
| Bounce permanente | marketing deixa de ser elegível (`suppressed`) no envio |
| Carrinho mudou antes do envio | `skipped` (`cart_changed`) |

### 6.7.1 Agenda: `pg_cron`, `pg_net` e Vault

```sql
create function private.dispatch_tick() returns void;   -- só o pg_cron (postgres) executa
-- select cron.schedule('email-dispatch-tick', '*/5 * * * *', 'select private.dispatch_tick()');
```
1. **Enfileira:** `private.enqueue_followups()`. Um erro vira `WARNING` no log do banco e **não** impede o passo 2 (a fila existente nunca fica refém).
2. **Chama o despacho** se o Vault tem **os dois** segredos: `net.http_post(url := email_dispatch_url, headers := {'Content-Type': 'application/json', 'apikey': email_dispatch_key}, body := {'limit': 20})`. Falta qualquer um: não chama e avisa (`WARNING`, sem valor de segredo). Falha na chamada também vira `WARNING`. O `pg_net` é assíncrono: a resposta do despacho não volta para o job.
3. O despacho (Ferrolho) aceita o `apikey` igual à chave local `default` ou, na nuvem, à chave `dispatch`; ele pega a fila com `claim_email_batch`, envia pela Brevo e informa com `mark_email_result` (inclui os reenvios das falhas).

- **Segredos no Vault, nunca na migração:** `email_dispatch_url` e `email_dispatch_key`. Local: `node supabase/local/aplicar-dispatch-vault.mjs` depois de cada `supabase db reset` (a URL é a do Kong dentro da rede do Docker, `http://supabase_kong_<project_id>:8000/functions/v1/email-dispatch`). Nuvem (I6): gravados à mão no Vault, com a chave `dispatch`.
- **Em desenvolvimento** o job roda a cada 5 min e pode enfileirar para dados de QA com opt-in (e, com o Vault preenchido, mandar o despacho enviar); se atrapalhar, `select cron.unschedule('email-dispatch-tick')` (o job volta no próximo `db reset`). Os testes do banco se isolam disso: o `09` e o `12` tomam a fila só dentro da transação e o `11` não depende do estado da fila.
- `pg_cron` (em `pg_catalog`), `pg_net` (em `extensions`) e `supabase_vault` (em `vault`) são criados pela migração do I5; a extensão `pg_cron` só pode ser criada no banco indicado por `cron.database_name`.

### 6.8 Downloads

A chave do B2 (`bucket` e `object_key`) **sai só destas RPCs**, para a API (D-26). O cliente nunca a recebe: a API assina uma URL de curta duração no servidor e responde com ela.

```sql
create function public.resolve_download(p_user_id uuid, p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text,
                 content_type text, size_bytes bigint);
```
- `KT009` sem e-mail confirmado; `KT001` com argumento nulo. `outcome`: `ok` | `not_found` | `not_entitled` | `unavailable`. Os campos de localização só vêm preenchidos com `ok`. HTTP sugerido: 404 / 404 / 403 / 503.
- Avaliação, nesta ordem:
  1. Arquivo inexistente ou `access='free'` (o gratuito tem a sua rota): `not_found`.
  2. Sem direito: `not_entitled` se o arquivo está `published`; `not_found` se não está (rascunho e aposentado não vazam).
  3. Com direito: `published` → `ok`. `retired` **com sucessor publicado** (mesmo jogo ou produto, mesmo tipo e acesso) → `not_found`: o site recarrega a biblioteca e recebe o id novo. `draft`, ou `retired` sem sucessor → `unavailable`.
- Direito = direito `active` do `p_user_id` cuja fotografia contém o `game_id` do arquivo (vale para quem tem o jogo por **qualquer** produto), ou, no ZIP, o `product_id` do direito igual ao do arquivo. Revogado (reembolso, contestação) não resolve. Sem expiração.
- Com `ok`, grava `download_events (kind='paid', user_id, file_id)` na mesma transação; as recusas não gravam nada. `content_type` derivado de `kind` (`application/pdf` ou `application/zip`). `filename` é o nome do `Content-Disposition` gravado no upload.

```sql
create function public.resolve_delivery(p_entitlement_id uuid, p_game_id bigint)
  returns table (outcome text, bucket text, object_key text, filename text,
                 content_type text, size_bytes bigint);
```
- Link do e-mail (`GET /d/{token}`): o token HMAC (validade, direito e jogo) é verificado pela rota; **o direito é conferido de novo no clique**. `KT001` com argumento nulo. `outcome` (nesta ordem): `not_found` (direito inexistente ou jogo fora da fotografia do direito) → `revoked` (direito revogado: a rota leva a `/meus-jogos`; o link de pedido contestado ou reembolsado não baixa) → `unavailable` (sem PDF pago publicado do jogo) → `ok`.
- Serve a versão **vigente** do jogo (P-2). Com `ok`, grava `download_events (kind='paid', user_id do direito)`. `size_bytes` permite ao despachante decidir **anexo** em vez de link (D4); anexar exige PDFs medidos abaixo do limite da Brevo.

```sql
create function public.get_free_game() returns jsonb;
-- {"available": false}
-- {"available": true, "game": {"code","name"}, "file": {"id","version","size_bytes","filename"}}
create function public.resolve_free_download(p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text,
                 content_type text, size_bytes bigint);   -- 'ok' | 'not_found'
```
- Disponível = jogo `access='free'` e `published` com PDF `free` `published` (e objeto no B2). Senão `available=false` (nenhum botão no site). A resposta não traz bucket nem chave.
- `resolve_free_download`: `ok` só para arquivo `access='free'` e `published` de jogo grátis `published`; qualquer outro id (inclusive pago) é `not_found`. Sem login. Grava `download_events (kind='free', user_id NULL)`. **Não captura e-mail nem contato** (condições do gratuito pendentes, P-10); `download_events` não tem coluna de IP, agente nem e-mail.

### 6.9 Rota → RPC (para o Ferrolho)

| Rota / evento | Chamadas ao banco |
| --- | --- |
| `GET /catalog` (pública) | `get_catalog()` (preço lido da Stripe) |
| `GET /cart` | `get_cart(uid)` |
| `POST /cart/items` | `cart_add(uid, code)` |
| `DELETE /cart/items/{code}` | `cart_remove(uid, code)` |
| `POST /checkout` | `create_order_from_cart` (a rota repassa o `terms_accepted` colhido na nossa página) → (cliente: `set_stripe_customer`) → Stripe (sessão **embutida**, sem `consent_collection`, com código promocional liberado) → `attach_checkout_session` |
| `GET /order-status` | Lê a sessão na Stripe (o pedido vem do `client_reference_id`); se preciso, `fulfill_order`/`set_order_status` com `p_source='return_page'`; depois `get_order_status(order_id, uid)` |
| `GET /library` | `get_library(uid)` |
| `GET /account` | `get_account(uid)` |
| `PUT /account/marketing` | `set_marketing_consent(uid, granted, source, text_version)` |
| `POST /account/marketing/prompt` | `mark_marketing_prompt(uid)` → `get_account(uid)` |
| `POST /download-url` | `resolve_download(uid, file_id)` → assina a URL no B2 |
| `GET /d/{token}` (pública) | `resolve_delivery(entitlement_id, game_id)` → 302 para a URL assinada ou `/meus-jogos` |
| `GET /free-game`, `POST /free-download` | `get_free_game()`, `resolve_free_download(file_id)` |
| `POST /email/unsubscribe` (pública, token HMAC) | `unsubscribe(uid, 'unsubscribe_link')` |
| `stripe-webhook` | `fulfill_order`/`set_order_status` com `p_stripe_event_id` e `p_event_type` (e, na liberação, subtotal, desconto e código promocional da sessão); `deferred` → responde `500` (a Stripe reenvia); `send_delivery` → despacho imediato |
| `brevo-webhook` | `record_email_event(email, event, message_id, occurred_at)` |
| `POST /email/unsubscribe` (pública, token HMAC) | `unsubscribe(uid, 'unsubscribe_link')` (o `user_id` do token vem da linha do `claim_email_batch`) |
| `email-dispatch` (interna) | Chamada pelo `pg_cron` (via `private.dispatch_tick` e `pg_net`, `apikey` do Vault), que já enfileirou os follow-ups: `claim_email_batch` → envia pela API da Brevo → `mark_email_result` |

## 7. Arquivos do B2 (somente metadados)

- **O banco guarda:** `files` (tipo, versão, nome de exibição, `size_bytes`, `sha256`, estado) e `file_objects` (`bucket`, `object_key`, `b2_file_id` opcional). **Nunca:** URL pública ou assinada, token, chave de aplicação, parâmetro de assinatura. O token do link de entrega **não** é guardado: o despachante o gera no envio. Teste T08 garante que nenhuma coluna se chama `*url*`.
- **Chave do objeto:** `{access}/{codigo}/{versao}/{codigo}-v{versao}.{kind}`, por exemplo `paid/TESTE-J01/1.0/TESTE-J01-v1.0.pdf`. Só `[A-Za-z0-9._/-]`. O nome mostrado ao usuário fica em `files.filename` (pode ter espaços e acentos; deve coincidir com o `Content-Disposition` gravado no upload).
- **Prefixo = acesso** permite chaves de aplicação do B2 por prefixo (`free/` x `paid/`). Bucket privado.
- **Integridade:** `sha256` e `size_bytes` calculados por quem publica a partir do arquivo enviado. A API pode comparar `size_bytes` com o `HEAD` do B2 antes de assinar.
- **Ciclo de publicação (dados):**
  1. Enviar o objeto ao B2 (com `Content-Disposition`), calcular `sha256` e tamanho.
  2. Em uma transação: `insert into files` (`draft`) + `insert into file_objects`.
  3. Conferir o objeto (`HEAD`).
  4. Em uma transação: `update files set status='retired'` no publicado anterior do mesmo (jogo, tipo, acesso) e `update files set status='published'` no novo. O índice único parcial garante que nunca existam dois publicados.
  - Conteúdo diferente = **versão nova**; `sha256`, tamanho, versão e nome não mudam depois de `draft`.
  - Quem executa o passo 4 (RPC administrativa `publish_file` ou SQL do operador) é decisão P-4; recomendo a RPC no I4.
- **Remoção:** só rascunho se apaga. Arquivo com `download_events` não pode ser apagado (FK). Retira-se (`retired`). A chave do B2 não é reutilizada para conteúdo diferente.
- **Versão servida a quem comprou:** a publicada vigente do jogo (D-6, P-2), tanto em `resolve_download` quanto no link do e-mail. `download_events.file_id` registra qual versão cada pessoa baixou.
- **Anexo em vez de link (D4):** o despachante pode baixar o PDF com `resolve_delivery` (`bucket`, `object_key`, `size_bytes`) e anexar se o total couber no limite da Brevo (cerca de 4 MB por anexo e 20 MB por mensagem, segundo a ajuda da Brevo; tamanho dos PDFs ainda não medido). O banco não muda.

## 8. Seed de teste

`supabase/seed.sql` (dono: Lastro; `[db.seed] sql_paths` no `config.toml` é do Ferrolho). Roda no `supabase start` e no `supabase db reset` **locais**. **Não é aplicado em remoto** sem autorização do orquestrador. Tudo é fictício e rotulado `TESTE`; nada do que está aqui é decisão comercial. Avulsos existem **só como dados TESTE**: o catálogo real começa no P001.

| Dado | Conteúdo |
| --- | --- |
| Usuários (`auth.users` + identidade `email`, sem senha) | **A** `teste-a@keytotwo.test`, **B** `teste-b@keytotwo.test`, **D** `teste-d@keytotwo.test`, **E** `teste-e@keytotwo.test`: confirmados. **C** `teste-c@keytotwo.test`: **não confirmado** (testa `KT009`). A trigger cria os perfis e o `account_confirmed`. O GoTrue local aceita o domínio `.test` (verificado). **Formato do GoTrue:** o INSERT direto em `auth.users` grava `''` (nunca `NULL`) em `confirmation_token`, `recovery_token`, `email_change_token_new` e `email_change` (o GoTrue lê essas colunas como texto: com `NULL`, `GET /auth/v1/admin/users` responde 500 e o login por código desses usuários falha); as identidades `email` têm `provider_id = id` e `email_verified` coerente com a confirmação. O `11_seed_smoke` e o `trigger-senha.mjs` guardam essa regra. |
| Produtos | `P001` (`bundle`, 5 jogos, nome `[PENDENTE] Nome comercial do P001 [TESTE]`, `status='active'`, `stripe_price_id='price_TESTE_P001'`, `games_expected=5`); `TESTE-AV1` (`single`, jogo `TESTE-J01`) e `TESTE-AV2` (`single`, jogo `TESTE-J02`), nomes `[TESTE] Avulso …`. Sem preço. **Price real de TESTE do P001:** o seed versionado usa o Price fictício; o checkout real no ambiente local precisa do Price da conta Stripe de teste (`STRIPE_PRICE_ID_P001`, em `.env` ignorado pelo git). O passo local `node supabase/local/aplicar-price-teste.mjs` (depois de cada `supabase db reset`) lê só essa linha, valida o formato `price_…` e faz `update products set stripe_price_id = … where code = 'P001'` no banco local; o valor nunca vai para arquivo versionado. Os testes aceitam as duas formas (fictício ou real) no P001. |
| Jogos | `TESTE-J01` Rabisque e Adivinhe [TESTE], `TESTE-J02` Hora dos Artistas [TESTE], `TESTE-J03` Boardgame (nome provisório) [TESTE], `TESTE-J04` Vaga 4 PENDENTE [TESTE], `TESTE-J05` Vaga 5 PENDENTE [TESTE], todos `published`, `paid`. Os códigos são de teste (a base ainda não atribuiu J002 em diante). |
| Jogo gratuito | `TESTE-GRATIS`, `access='free'`, **`draft`** (estado padrão = sem jogo gratuito). |
| Arquivos | Um PDF `paid` `published` v1.0 por jogo (`TESTE-J0N-v1.0.pdf`, bucket `bucket-teste-pendente`, chave `paid/TESTE-J0N/1.0/TESTE-J0N-v1.0.pdf`), um PDF `free` `draft`, um ZIP do pacote `draft` (estes dois sem arquivo no bucket: `sha256` = 64 zeros e tamanho 1024 como placeholder). **Os 5 PDFs pagos são os arquivos fictícios de TESTE já enviados ao bucket de teste do B2**, lidos de volta e conferidos pelo Ferrolho: tamanho 699 bytes e sha256 `TESTE-J01` `35454cce…fd7da`, `TESTE-J02` `1f3251b5…5a95f`, `TESTE-J03` `d8165f72…dc0d`, `TESTE-J04` `98dd7189…ed64` e `TESTE-J05` `40207c15…2bcf372` (valores inteiros no `seed.sql`; conteúdo fictício, sem segredo). O bucket do seed segue o nome fictício: a API assina sempre no bucket configurado no ambiente. |
| Pedidos (ids fixos; valor `0` = fictício) | **A:** `paid` do `P001` (5 direitos... 1 direito, 5 jogos) → A possui os 5 jogos. **B:** `paid` do `TESTE-AV1`. **D:** `pending_payment` do `P001`; `refunded` do `TESTE-AV2` (direito revogado `refund`); `disputed` do `TESTE-AV1` (revogado `dispute`). **E:** `dispute_lost` do `TESTE-AV2`; `expired`; e um `open` abandonado. |
| Carrinho | **B:** `P001` (sobreposição parcial: já possui o J01). **A:** vazio (testar `already_owned` chamando `cart_add`). |
| Consentimento | **A:** `granted` (`signup_prompt`, texto `v1-TESTE`) e convite já exibido (`marketing_prompted_at`); os demais sem consentimento e sem convite exibido. |
| Fila | `delivery` `queued` para os pedidos pagos de A e B (payload por jogo, sem token). |
| Ids Stripe | `cs_test_TESTE_…`, `pi_TESTE_…`, `evt_TESTE_…`, `cus_TESTE_…`. Nunca valores reais. |

O seed grava os pedidos direto, como dono, com ids fixos (`subtotal` e `desconto` = 0 nos estados com valor); as invariantes (CHECKs e triggers) validam a coerência. O `11_seed_smoke` (T110) exercita as RPCs do I3 sobre o seed, dentro de uma transação que dá rollback: o carrinho de B vira pedido, é liberado com cupom e entrega, e `get_order_status` mostra a relação `owner`/`other`.

## 9. Plano de testes pgTAP

**Onde e como.** `supabase/tests/database/*.test.sql` (dono: Lastro). Rodam com `supabase test db` sobre o banco local já migrado e semeado. Cada arquivo: `begin; create extension if not exists pgtap with schema extensions; select plan(n); ...; select * from finish(); rollback;`, exceto o de concorrência. Papéis simulados com `set local role anon|authenticated|service_role`; como nenhum tem acesso a tabela, não dependemos de `request.jwt.claims`. Dados criados dentro do teste (usuários por função em `pg_temp`, códigos próprios como `P9xx`), nunca dependendo do seed, exceto o arquivo 11. **Os triggers de restrição são diferidos:** em transação com `rollback` eles não disparam; os testes de I-5 usam `set constraints all immediate`. Não usar `tables_are('public', ...)` (o schema `public` do remoto contém `public.test`, fora do contrato).

| Arquivo | Casos principais |
| --- | --- |
| `01_schema` | **T01** as 19 tabelas existem. **T02** colunas, tipos e `NOT NULL`. **T03** PK, FK e `unique`, inclusive as FKs compostas. **T04** toda FK tem índice. **T05** `CHECK`s rejeitam (23514): status/`kind` inválidos, `sha256` curto, e-mail fora do padrão, `paid` sem `paid_at`, pedido sem `terms_accepted_at` (`NOT NULL`), `currency` maiúscula, `product_games`/`files` fora da regra, `consent` concedido sem versão, origem × ação do consentimento, `email_outbox` (`kind`×`category`, `delivery` sem pedido, `sending` sem `locked_at`, `skipped` sem motivo), `funnel_events` sem os campos do tipo. **T06** FKs compostas (23503): arquivo `free` em jogo `paid`; jogo `free` em produto; `entitlements` com `user_id` diferente do dono do pedido ou item inexistente; `file_objects.access ≠ files.access`. **T07** unicidade (23505): sessão, intent, cliente Stripe, `evt_`, direito por item, `dedupe_key`, 2º publicado por (jogo, tipo, acesso), 2º jogo grátis, `(bucket, object_key)`, `account_confirmed` e `order_paid` repetidos. **T08** nenhuma coluna `*url*` e nenhuma `ip`/`user_agent`. **T09** só inserção (`KT008`): `order_events`, `stripe_events`, `entitlement_games`, `marketing_consents`, `email_suppressions`, `download_events`, `funnel_events` (exceto `user_id→NULL`). |
| `02_privileges_rls` | **T10** RLS ligada nas 19 tabelas. **T11** `deny_client_access` é a única policy de cada tabela. **T12** `anon`/`authenticated`/`service_role` sem **nenhum** privilégio de tabela, coluna ou sequência (`has_table_privilege`, `has_any_column_privilege`, `has_sequence_privilege`). **T14** as RPCs (no I2b: as 10 implementadas, sem stub das demais): `EXECUTE` só para `service_role`; `private.*` para ninguém. **T15** comportamento: `SELECT`/`INSERT` em qualquer tabela como `anon`, `authenticated` e `service_role` → `42501`; chamar RPC como `anon`/`authenticated` → `42501`. **T16** as RPCs são `SECURITY DEFINER` com `search_path` vazio (`proconfig @> array['search_path=""']`) e `proacl` exatamente `{postgres=X/postgres,service_role=X/postgres}`. |
| `03_state_machine` | **T20** matriz completa: dos 64 pares (de, para) entre os 8 estados, `UPDATE` direto só passa nas 11 arestas da seção 4.1 e nos 8 "mesmo estado"; o resto levanta `KT006`. **T21** imutáveis (`livemode`, `created_at`, `cart_version`, `terms_version`); `user_id` não muda para outro valor (muda com `keytotwo.allow_reassign`); ids Stripe preenchidos não mudam. **T22** `order_items` imutáveis depois de `open`, exceto o valor cobrado (uma vez). **T23** I-5, com `set constraints all immediate`: `paid` sem direito em algum item, `refunded`/`disputed`/`dispute_lost` com direito ativo, direito em pedido `open`, e o par que passa (revogação `manual` em `paid`; pedido de 2 itens com os 2 direitos). **T24** `files`: `draft→published→retired` passa; retornos e pulos falham; conteúdo imutável após `draft`; só rascunho se apaga. |
| `04_cart` | **T30** carrinho isolado por usuário (A não vê nem altera o de B). **T31** `cart_add`: `added`, `noop` (repetido), `version` sobe só quando muda, funil `cart_item_added`. **T32** `cart_remove`: `removed`/`noop`, `version`, funil. **T33** `already_owned`: produto cujos jogos o usuário já tem todos é recusado; avulso dentro de um pacote possuído também. **T34** sobreposição parcial: aceita, com `owned_games` preenchido; `shared_with` entre itens do carrinho. **T35** `product_unavailable`: produto `draft`, sem preço, composição incompleta, jogo não publicado ou sem PDF publicado. **T36** `KT009` com usuário não confirmado, removido ou inexistente (em `cart_add`, `get_cart`, `create_order_from_cart`). **T37** `get_cart`: `status` `ok`/`unavailable`/`already_owned`, ordem por `added_at`, carrinho vazio `{"version": 0, "items": []}`. **T38** `get_catalog` só devolve ativos e vendáveis, com jogos e `stripe_price_id`. |
| `05_checkout_fulfill` | **T40** `create_order_from_cart`: `cart_empty`, `cart_changed`, `product_unavailable` (antes de `already_owned`), `already_owned` (com `detail`); recusas não gravam nada; `KT009`/`KT001`/`KT007`. **T41** caminho feliz: pedido `open` com e-mail da conta, `cart_version`, `terms_version` e `terms_accepted_at` gravados na criação, itens com `position` por `added_at` e o `stripe_price_id`, trilha `null → open` e funil `checkout_started`; **reaproveita** o pedido da mesma versão, do mesmo ambiente e dos mesmos termos, e **não** reaproveita com sessão vencida, Price que mudou ou carrinho novo; `stripe_customer_id` volta no resultado. **T43** `attach_checkout_session`: `applied`/`noop`/`KT004`/`23505`/`KT005`/`ignored`/`not_found`/`KT001`. **T44** `fulfill_order` com **2 itens** (um pacote de 3 jogos + um avulso): `applied`, 2 direitos e 4 fotografias, valores e preço cheio por item, `terms_accepted_at` herdado, carrinho sem os itens pagos (o que entrou depois fica) e com `version` maior, lembrete cancelado, 1 entrega `queued` com `payload` por jogo sem token, trilha, funil e livro-razão com o tipo do evento, cliente no perfil. **T45** replay do mesmo evento: `duplicate_event`; outro evento/`return_page`: `noop` (o evento `noop` entra no livro-razão); contagens iguais. **T46** `KT002` (`unpaid`, `no_payment_required` sem cupom de 100%), `KT001` (14 formatos), `KT005`, `KT004` (sessão, intent, cliente), `p_payment_intent_id` NULL; **T46b** `KT012` (subtotal ≠ soma dos itens, total ≠ subtotal − desconto, desconto > subtotal, quantidade, moeda, item a mais/a menos/repetido/de outro Price, item que não é objeto, `unit_amount` nulo/negativo) sem nenhum rastro. **T47** pedido inexistente: `not_found` e evento sem pedido. **T49** fotografia imutável (mudar `product_games` depois da compra não muda o direito); `KT003` sem rastro. **T50** contestação aberta (todos os direitos revogados por `dispute`, entrega cancelada, funil `dispute_opened`, I-5), vencida (`disputed→paid` reativa e não reenvia a entrega, `dispute_closed`), perdida (revogados, terminal: pagar, reembolsar, falhar e liberar viram `ignored`); contestação sobre revogação manual (o `manual` fica); reembolso manual (`refund`, `refunded_at`, entrega cancelada, terminal) e reembolso depois da contestação (o motivo passa a `refund`). **T51** `deferred`: contestação/reembolso/perda com o pedido `open`/`pending_payment` (e `dispute_lost` com `paid`) não grava evento nem altera; depois da liberação o mesmo evento é `applied`. **T52** validações de `set_order_status` (`KT001`, `KT007`, `KT012`), `open→failed`, `open→expired` com `checkout_expired`, `pending_payment→failed`, `ignored` nos terminais. **T53 (cupom)** desconto gravado (subtotal, desconto, total, código) e itens com preço cheio; `get_account` com o desconto; código em branco vira NULL; desconto sem código; **cupom de 100%** (D-25) libera como pago, sem intent; `pending_payment` com cupom e depois a liberação (valores e código mantidos; valores ou código diferentes: `KT012`); valores imutáveis (`KT010`). **T130 (papel da API)** `create_order_from_cart`, `attach_checkout_session`, `fulfill_order` (com cupom), `set_order_status` (contestação aberta, vencida e perdida, `pending_payment` e reembolso) e as RPCs de escrita do I2b terminam sem erro no COMMIT quando rodam como `service_role` (I-5 dispara como `service_role`). Controle negativo: o I-5 enxerga um pedido `paid` sem direito, inclusive disparando como `service_role` (`KT011`). |

| `06_account_consent` | **T60** trigger de `auth.users`: INSERT cria o perfil; INSERT já confirmado grava `account_confirmed` uma vez. **T61** primeira confirmação (`NULL→valor`) **zera a senha**, cria o perfil se faltar e grava `account_confirmed`; segunda atualização do `email_confirmed_at`, troca de e-mail e nova senha **não** zeram; senha trocada **no mesmo UPDATE** da confirmação é preservada. **T62** `set_marketing_consent`: conceder exige versão; `applied` insere no histórico e atualiza `profiles`; mesmo estado = `noop` sem linha nova; revogar zera `marketing_opt_in_at`. **T63** histórico só por inserção; `profiles.marketing_opt_in` sempre igual à última ação. **T64** `unsubscribe` revoga na hora, cancela marketing `queued`, funciona sem e-mail confirmado. **T65** `record_email_event`: `hard_bounce`/`complaint`/`unsubscribe` suprimem; idempotente; `complaint` e `unsubscribe` revogam o consentimento; `hard_bounce` não. **T66** `marketing_allowed`: só com opt-in, e-mail confirmado, sem supressão e sem `unsubscribe_all` posterior ao opt-in. **T67** `get_account`: e-mail, `marketing`, pedidos do usuário sem `open`/`expired`, do mais recente ao mais antigo, `ref` de 8 caracteres, `items` com `unit_amount`; usuário removido ou não confirmado → `KT009`; sem vazar pedido de outro. **T68** `mark_marketing_prompt`: grava uma vez e devolve o mesmo valor depois; não cria linha em `marketing_consents` nem muda `marketing_opt_in`; `set_marketing_consent` com `signup_prompt` preenche o marcador (inclusive em `noop`) sem sobrescrever; `get_account` devolve `marketing.prompted_at`. |
| `07_library_status` | **T70** `get_library` por jogo: só direitos ativos do usuário; revogado some; outro usuário não vê; jogo repetido por dois produtos vira **um** item com os dois em `products`; `acquired_at` = o mais antigo. **T71** só arquivos `published`; jogo sem arquivo publicado aparece com `files=[]`; `pending` lista só `pending_payment` do usuário, mais recente primeiro; sem chave do B2, e-mail nem ids de pedido ou de direito; sem compra `{"games": [], "pending": []}`. **T72** `get_order_status`: `owner`, `other`, `not_found`; só `outcome`, `status`, `items`, `relation` (sem e-mail, valores nem ids de usuário); `KT009` sem e-mail confirmado. |
| `08_b2_metadata` | **T80** `object_key` rejeita `https://…`, `..`, barra inicial, `?`, espaço e prefixo diferente de `access`; `bucket` fora do formato. **T81** `unique (bucket, object_key)`; `sha256`, `size_bytes`, extensão × `kind`. **T82** publicar novo exige aposentar o anterior (sequência na mesma transação passa). **T83** apagar arquivo publicado → `KT010`; rascunho com `download_events` → 23503. **T84** `bucket`/`object_key` imutáveis depois de `draft`. |
| `09_email_queue` | O arquivo é dono da fila (tira da fila, só dentro da transação, o que já existia). **T85** `delivery` nunca duplica (`dedupe_key` repetida: 23505). **T86** `claim_email_batch`: `KT001` (`p_limit`, `p_now`); pega só o vencido, respeita `p_limit`, a ordem e o `p_outbox_id`; não pega `sent`/`failed`/`canceled`; `sending` fresco não volta e parado há mais de 10 min volta contando tentativa (na 5ª falha de vez); **entrega**: paga com direitos ativos segue, contestada/perdida/reembolsada ou com direito revogado à mão → `canceled` (`entitlement_revoked`), em outro estado → `canceled` (`order_not_paid`); **marketing**: sem opt-in → `no_opt_in`, bounce/queixa/descadastro geral depois do opt-in → `suppressed` (antes do opt-in não bloqueia), e-mail não confirmado → `email_not_confirmed`; lembrete com `version` diferente, sem `cart_version`, carrinho vazio ou inexistente → `cart_changed`/`cart_empty`; pós-compra com o pedido fora de `paid` → `order_not_paid`; **limite de 1 marketing por 24 h** adia sem pular (no mesmo lote, quem recebeu há 2 h, quem recebeu há 25 h passa, a entrega não conta). **T87** `mark_email_result`: `KT001`, `not_found`, `noop` em linha que não está em envio; `sent` (mensagem do provedor, `sent_at`, funil `delivery_sent` uma vez na entrega e nenhum no marketing; repetir é `noop`); `failed` volta à fila com 5, 20, 45 e 80 min e a 5ª falha é final; `rejected` vai a `failed`; erro de 900 caracteres cortado em 500; só sai de novo quando a data vence. De ponta a ponta: `fulfill_order` → `claim` por `p_outbox_id` → `mark sent` → a fila não envia duas vezes, nem pelo lote nem pelo reenvio da página de retorno. Papel da API: `service_role` executa, `anon` e `authenticated` não (`42501`). |

| `10_downloads` | **T100** `resolve_download`: `ok` com bucket, chave, nome, tipo e tamanho e grava `download_events` (pago, usuário e arquivo; cada download um evento); `not_entitled` (quem não comprou, dono de outro jogo, **direito revogado por reembolso ou por contestação**); `not_found` (id inexistente, arquivo grátis mesmo com direito, **`retired` com sucessor publicado**, rascunho e aposentado sem direito); `unavailable` (direito ok com `draft` ou com `retired` sem sucessor); o dono de **outro produto que contém o jogo** também baixa; ZIP do pacote pelo direito do produto; localização nula e nenhum evento quando `outcome ≠ ok`; `KT009`/`KT001`. **`download_events` sem IP**: só `id`, `user_id`, `file_id`, `kind` e `created_at`, e só inserção. A chave do B2 não aparece em `get_library`, `get_account` nem `get_catalog`. **T101** `resolve_delivery`: `ok` (grava o evento do dono do direito, serve a versão vigente 1.1 e devolve o tamanho), `not_found` (direito inexistente, jogo fora da fotografia, que vem antes de `revoked`), `revoked` (reembolso e contestação), `unavailable` (sem PDF pago publicado); as recusas não gravam evento. **T102** `get_free_game`/`resolve_free_download`: `false` com jogo ou arquivo em rascunho; `true` só com os dois publicados (sem bucket nem chave na resposta); `ok` sem login e evento `free` com `user_id` nulo; id de arquivo pago, rascunho ou inexistente → `not_found`. Só o `service_role` executa. |

| `11_seed_smoke` | **T110** após `db reset`: contagens da seção 8; todo nome, arquivo e e-mail com `TESTE`/`.test`; ids Stripe com `TESTE`; pedidos nos estados esperados; perfis criados pela trigger; A possui os 5 jogos; `cart_add(A, TESTE-AV1)` → `already_owned`; carrinho de B mostra a sobreposição parcial; C (não confirmado) → `KT009`. |
| `12_followups` | O arquivo é dono da fila e das supressões (o que já existia sai de toda elegibilidade, só dentro da transação). **T65** `record_email_event`: `KT001`; `hard_bounce` suprime sem mexer no consentimento nem na fila (barrado no envio); `complaint` e `unsubscribe` revogam o consentimento (origem `brevo_webhook`) e cancelam o marketing na fila sem tocar a entrega; idempotente por e-mail e motivo (noop devolve o usuário; e-mail com maiúsculas e espaços); e-mail sem conta e conta removida (`user_id` nulo); horário do evento (futuro vira agora; descadastro anterior ao opt-in não revoga nem bloqueia; reenvio de evento velho é noop; opt-in de novo e novo descadastro revoga); mensagem do provedor em branco ou longa; só inserção; só `service_role`. **T88** `enqueue_followups`: lembrete só 3 h depois da última mudança (limite inclusivo), um por `version`, só itens vendáveis e não possuídos, nunca sem opt-in, com bounce, com descadastro depois do opt-in, com e-mail não confirmado, carrinho vazio, jogos já possuídos ou pagamento assíncrono em curso; a compra cancela o lembrete da fila e nenhum novo nasce; pós-compra só entre D+3 (inclusivo) e D+14 (exclusivo), um por pedido, com direito ativo (não com reembolso, contestação, direito revogado, sem opt-in, com queixa nem pedido não pago); payloads; `scheduled_at`; a contagem devolvida; o claim refaz as checagens (descadastro e carrinho que mudou). **T89** agenda: job `email-dispatch-tick` a cada 5 min e ativo; ninguém de API executa `dispatch_tick` nem `enqueue_followups`; sem os segredos no Vault só enfileira; com só um dos dois não chama; com os dois chama o despacho por `pg_net` (POST, JSON, `apikey` e `{"limit": 20}`); erro no enfileiramento vira aviso e o despacho ainda é chamado. |
| `90_concurrency` | Sem `begin/rollback` (precisa de commits visíveis a outras sessões); usa `dblink` em N conexões, com a trava da linha (pedido ou carrinho) segura numa conexão à parte até que **todas** as chamadas estejam bloqueadas, e só então a solta: a disputa é real. Dados com prefixo `conc`/`CONC`, removidos no fim e no começo da próxima execução (os logs só-inserção são liberados dentro de uma transação de limpeza). Pula (`skip`) se o `dblink` não conectar. **T120** N=10 `fulfill_order` simultâneos, mesmo pedido e evento: 1 `applied` + 9 `duplicate_event`; contagens 1/1/1; um único `send_delivery=true`. **T121** webhook ∥ retorno (eventos distintos e sem evento): 1 `applied`, o resto `noop`/`duplicate_event`. **T122** `fulfill_order` ∥ `set_order_status(disputed)` em 6 rodadas (a ordem das chamadas alterna): a contestação que ganha a trava antes da liberação devolve `deferred` e, reenviada, `applied`; o estado final cumpre a I-5, sem duplicata. **T123** 8 `create_order_from_cart` simultâneos do mesmo usuário e versão: **um** pedido `open` (os outros `reused`). **T124** `cart_add` ∥ `create_order_from_cart` em 4 rodadas: ou `ok` com o carrinho visto, ou `cart_changed` sem pedido; o `cart_add` nunca se perde. **T127** `fulfill_order` ∥ `create_order_from_cart` ∥ `cart_add` ∥ `cart_remove`: sem deadlock (prova a ordem pedido → carrinho). **T125** 24 entregas vencidas: um despachante pega 8 e **segura sem confirmar**, outros dois pegam ao mesmo tempo: o primeiro fica com 8 e os outros dois com 16, 24 ids distintos, nenhuma linha duas vezes e nenhuma linha de outros dados (`SKIP LOCKED`); e 6 `mark_email_result` simultâneos do mesmo envio: 1 `applied`, 5 `noop` e um único funil `delivery_sent`. |

Observações do plano:

- O `dblink` com a trava de `FOR UPDATE` prova concorrência sem script externo. **Spike do P-12 (feito no I3):** `dblink` instala em `extensions` e funciona no contêiner local, mas o `postgres` não é superusuário e o `pg_hba` confia em `127.0.0.1`; por isso o `dblink` recusa a conexão ("password is required"). A corrida conecta pelo **IP do próprio servidor** (`inet_server_addr()`, que cai na regra `scram-sha-256`) com a senha padrão do banco local (`postgres`). Se a conexão falhar (IP nulo ou senha diferente), o arquivo faz `skip` em vez de falhar. Mutação verificada: sem o `FOR UPDATE` do pedido em `fulfill_order`, o T120 quebra.
- `get_advisors` (MCP) ou `supabase db advisors`: **zero ERROR** após as migrações. Avisos preexistentes e que não são nossos: `public.test` sem policy e `rls_auto_enable()` executável (seção 10).
- Testes de API e E2E (Lupa) que contam linhas leem o banco como dono (`psql`/`supabase db query`), não com a chave secreta (D-12).
- `supabase test db` roda no CI (Costura) com a CLI de versão fixa.
- **Papel da API (T130):** os testes de escrita rodam também com `set local role service_role` e antecipam o COMMIT com `set constraints all immediate` ainda como `service_role` (o `pg_temp.as_api`), e a corrida do `90_concurrency` abre as conexões com `SET ROLE service_role`. Rodar só como dono (`postgres`) esconde defeitos de privilégio nos gatilhos diferidos: foi assim que o `SECURITY INVOKER` da I-5 passou despercebido até a integração do I3. **Estado no I3:** implementados `01`, `02`, `03`, `04`, `05`, `06`, `07`, `08`, `11` e `90`. Os rótulos dos testes são descritivos e agrupam os casos T01–T16, T20–T24, T30–T38, T40–T53, T60–T68, T70–T72, T80–T84, T110 e T120–T127. **Estado no I4:** implementados também `09` (fila) e `10` (downloads) e o T125. **Estado no I5:** implementado também o `12_followups` (T65, T88 e T89): com isso **todos os testes do plano existem**. O pg_cron do banco local também roda o job fora dos testes: os testes que dependem da fila (`09`, `12`, o `11`) se isolam dele.
- O teste da trigger com o GoTrue real é `supabase/tests/gotrue/trigger-senha.mjs` (`node supabase/tests/gotrue/trigger-senha.mjs`, com a stack no ar): 4 cenários (cadastro legítimo, ataque de cadastro prévio com código, ataque de cadastro prévio com "esqueci a senha", só por código). Leva cerca de 70 s por causa do intervalo de 60 s do Auth entre e-mails ao mesmo endereço, e apaga os usuários que cria.

**Cobertura dos aceites do P2**

| Aceite | Testes |
| --- | --- |
| I2b: senha definida antes da confirmação não vale | T61 |
| I2b: carrinho persiste entre aparelhos; isolado entre contas | T30, T37 |
| I2b: `anon` e outra conta sem acesso; zero ERROR nos advisors | T12, T15, T70 |
| I2b: ledger de consentimento só por inserção | T09, T62, T63 |
| I2b: `ALREADY_OWNED` e sobreposição parcial | T33, T34 |
| I3: 2 itens geram 2 direitos e 2 fotografias; carrinho esvaziado só dos itens pagos | T44, T48 |
| I3: idempotência, webhook concorrente com retorno | T45, T120, T121 |
| I3: `terms_accepted_at` gravado na criação e funil até `order_paid` | T41, T44 |
| I3: contestação aberta revoga, vencida devolve, perdida mantém | T50, T51, T122 |
| I3: cupom gravado (subtotal, desconto, total, código; preço cheio nos itens) e cupom de 100% | T53 |
| I3: expiração gera `checkout_expired` | T52 |
| I4: entrega 1 vez por pedido; link de pedido contestado não baixa; sem direito 403 | T85, T101, T100 |
| I5: sem opt-in nada sai; opt-out bloqueia na hora; compra cancela o lembrete; dedupe por versão; bounce e queixa suprimem | T86, T88, T64, T65 |

## 10. Proteção da `public.test` (keep-alive externo)

**Fato (inventário D1):** `public.test` existe só no remoto `keytotwo-print-db`, criada fora das migrações (`id bigint identity`, `created_at timestamptz`, `text`; RLS ligada; sem policies; 1 linha). Não existe no banco local. Uma automação externa a usa; **não sabemos como ela acessa** (REST com `anon`, SQL, outra). Este contrato nunca toca a tabela, as colunas, a RLS, as policies nem os grants.

**Regras para todas as migrações:**

1. Não mencionam `public.test`, `rls_auto_enable` nem `alter default privileges`.
2. Sem `grant|revoke ... on all (tables|sequences|functions) in schema public`: eles atingiriam `public.test`. Sempre lista nomeada.
3. Sem `drop schema public`, `drop table public.test` ou `create table public.test`. Não recriar a tabela localmente.
4. Nunca `supabase db reset --linked`. `supabase db pull` contra o remoto importaria `public.test` e `rls_auto_enable()`: usar `db pull --local` e revisar o diff. `supabase db push --dry-run` antes de qualquer push (que exige autorização do orquestrador).
5. Antes de mexer em `rls_auto_enable()` ou em privilégios padrão: confirmar que a automação não é afetada; na dúvida, perguntar. Nada neste contrato precisa disso.
6. **Checagem de integridade** antes e depois de qualquer aplicação remota (somente leitura): colunas, `RLS` ligada, número de policies (0) e grants de `public.test` idênticos aos de antes; contagem de linhas ≥ 1.
7. **Lint no CI** (proposta, `supabase/tests/lint-migrations.*`): falha se `supabase/migrations/**` casar `public\.test\b`, `rls_auto_enable`, `alter\s+default\s+privileges` ou `in\s+schema\s+public` em `grant|revoke ... on all`.
8. As **triggers em `auth.users`** (seção 2.10) são o único objeto fora de `public`/`private`. Usam nomes próprios (`on_auth_user_created`, `on_auth_user_confirmed`) e não tocam dados de `public.test`.

Os avisos de segurança atuais (INFO `public.test` sem policy; WARN `rls_auto_enable()` executável por `anon`/`authenticated`) pertencem a esses objetos e **não são corrigidos por este trabalho**. Tratar a função só após o item 5.

## 11. Pontos em aberto

Os pontos que dependem do responsável usam a numeração D da nota Plano do site P2 (seção 7). Fechados pelo I2b: **P-11** (o GoTrue local aceita `.test`) e **P-15** (senha vazia, verificada no GoTrue real). Decididos nesta versão: **P-1** (sem reembolso; contestação aberta revoga, vencida devolve, manual excepcional revoga) e **P-3** (acesso sem expiração), ambos em D-15.

| # | Ponto | Decisor | Efeito se mudar |
| --- | --- | --- | --- |
| P-2 | Atualizações: servir a versão publicada vigente (proposto; o link do e-mail e `resolve_download` já fazem isso) ou congelar a versão comprada? | Responsável (ficha do P001: "direito a futuras versões") | Congelar exige tabela `entitlement_files` e ajuste em `resolve_download`/`resolve_delivery`/`get_library` |
| P-4 | **Decidido no I4 (D-26):** quem publica arquivo é o **SQL do operador**, no ciclo da seção 7; não há RPC `publish_file` na API. Reversão manual de acesso (`manual`) também é SQL de atendimento. Reabrir só se surgir painel administrativo. | Lastro (D-26) | Nova RPC, só com painel |
| P-5 | Origem do `stripe_price_id`: coluna preenchida por script do ambiente (proposto) ou variável de ambiente da função. | Orquestrador / Ferrolho | Coluna fica NULL e o gate muda |
| P-6 | Leitura direta pelo cliente (catálogo/pedidos pela Data API). Não adotada; reabrir só se surgir necessidade. | Orquestrador | Seção 5.3 |
| P-7 / D5 | Reembolso parcial e por item: proposta de que o reembolso excepcional seja sempre do pedido inteiro e o parcial só pelo suporte (fora das RPCs). | Responsável (I3) | Novo estado ou `amount_refunded` |
| P-8 | LGPD: exclusão de conta é **anonimização** (FK `RESTRICT` de pedidos, consentimentos e fila; confirmado em D-23). A RPC de anonimização (suporte) é futura. Rotina e retenção de `orders.email`, do e-mail no histórico de consentimento, funil e `download_events` seguem **pendentes** do responsável (D6, P-19); política de privacidade pendente. | Responsável / jurídico (D6, D11) | Rotina de anonimização |
| P-10 | Jogo gratuito: no máximo um publicado (índice); conteúdo e condições (e se passa a exigir login) pendentes. O contrato não captura contato. | Responsável (D12) | Remover o índice se houver mais de um |
| P-12 | **Fechado no I3:** o `dblink` funciona no contêiner local pelo IP do servidor com a senha padrão (seção 9). Se a senha local mudar, o `90_concurrency` faz `skip`. | Lastro | — |
| P-22 | **Cupom de 100%** (D-25): o banco libera o acesso como pago (total 0). Se o responsável não quiser cupom de 100%, basta não criá-lo na Stripe; para o banco recusar, `fulfill_order` passa a tratar `no_payment_required` como `KT002`. Imposto: o total é subtotal − desconto porque `automatic_tax` está desligado; se um dia ligar, o pedido precisa de `amount_tax` (v0.4). | Responsável (cupons) / Lastro | Uma condição em `fulfill_order`; coluna nova |
| P-13 | Nome comercial, preço, moeda, composição de avulsos e textos legais: **PENDENTES**. O banco não os decide. | Responsável (D1, D11) | — |
| P-15 | Falta verificar, só com credenciais reais: o login com Google e a troca de e-mail (`double_confirm_changes`) com a trigger. Os demais fluxos estão verificados no GoTrue real. | Lastro / Ferrolho (I6, jornada integrada) | Ajuste fino da trigger |
| P-16 | **D2:** posse sobreposta. Padrão provisório: recusar produto possuído por inteiro, aceitar sobreposição parcial com aviso, sem desconto (D-16). | Responsável | `owned_game_ids` e as RPCs de carrinho |
| P-17 | **D4:** entrega por link (D-17) ou por anexo; validade do link (proposta de 30 dias, no token, fora do banco). PDFs medidos decidem o anexo. | Responsável | Só o despachante |
| P-18 | **D3:** fluxos, prazos e limites dos follow-ups (proposta: lembrete 3 h após a última mudança; pós-compra em D+3; no máximo 1 marketing por dia). Constantes de `enqueue_followups` e `claim_email_batch`. | Responsável | Constantes |
| P-19 | **D6:** texto e versão do consentimento, onde perguntar, guardar IP ou não (proposta: não), retenção do funil e do histórico. | Responsável | Coluna de IP, rotina de retenção |
| P-20 | **D7/D8:** remetentes e plano da Brevo; se a API transacional aceita conteúdo promocional. Se não aceitar, só o despachante dos kinds de marketing muda (`trackEvent`). | Responsável | Só o despachante |
| P-21 | **Fechado no I5:** `pg_cron`, `pg_net` e `supabase_vault` são criados pela migração do I5 (disponíveis no Supabase). Na nuvem, o Vault precisa dos segredos do despacho gravados à mão (I6), e a chave `dispatch` criada no painel. Backfill de `profiles` já feito no I2b. | Lastro / Ferrolho (I6) | Passo manual |

## 12. Entregas derivadas deste contrato

| Incremento | Arquivos do Lastro |
| --- | --- |
| I2b | Reescrita das migrações (`supabase/migrations`): `<ts>_commerce_schema.sql` (seções 2 e 3), `<ts>_auth_triggers.sql` (2.10), `<ts>_rls_grants.sql` (2.10 e 5), RPCs de conta, carrinho, catálogo e biblioteca (`get_catalog`, `get_cart`, `cart_add`, `cart_remove`, `get_library`, `get_account`, `set_marketing_consent`, `unsubscribe`, `set_stripe_customer`); `supabase/seed.sql`; pgTAP `01`–`04`, `06`, `07`, `08`, `11` |
| I3 (v0.3.3, implementado) | `<ts>_i3_checkout_fulfillment.sql`: `create_order_from_cart`, `attach_checkout_session`, `fulfill_order` (com cupom), `set_order_status` (contestações e reembolso), `get_order_status`, `get_account` com o desconto; pgTAP `05` e `90_concurrency`; `supabase/local/aplicar-price-teste.mjs` |
| I4 (v0.3.4, implementado) | `<ts>_i4_delivery_downloads_queue.sql`: `resolve_download`, `resolve_delivery`, `get_free_game`, `resolve_free_download`, `claim_email_batch`, `mark_email_result`; metadados reais dos 5 PDFs de TESTE no seed (D-26); sem `publish_file` (P-4); pgTAP `09` (fila), `10` (downloads) e o T125 |
| I5 (v0.3.5, implementado) | `<ts>_i5_followups_suppressions_agenda.sql`: `record_email_event`, `private.enqueue_followups`, `private.dispatch_tick` e o job do `pg_cron`; `supabase/local/aplicar-dispatch-vault.mjs`; pgTAP `12_followups` |

Criar cada migração com `supabase migration new <nome>` (nunca inventar o nome do arquivo). Sem stub: RPC que ainda não existe fica fora da migração. **Estado:** o I2b está implementado (linha "Implementado" do cabeçalho). As RPCs do I2b são `get_catalog`, `get_cart`, `cart_add`, `cart_remove`, `get_library`, `get_account`, `set_marketing_consent`, `mark_marketing_prompt`, `unsubscribe` e `set_stripe_customer` (10); I3 a I5 seguem pendentes.

## 13. O que mudou em relação à v0.2.2

| Área | v0.2.2 | v0.3 |
| --- | --- | --- |
| Modelo de venda | Compra avulsa do P001, anônima, vínculo por e-mail verificado | Carrinho multi-item no Stripe Checkout; venda **só para usuário cadastrado e com e-mail confirmado** (D-13, D-14) |
| `products` | `code` só `P###`; um produto por pedido | `kind` (`bundle`/`single`); `code` geral; catálogo genérico; `games_expected` (avulso = 1); gate por produto |
| Carrinho | — | **Novas:** `carts` (1 por usuário, `version`) e `cart_items` (quantidade 1) |
| `orders` | `user_id` nulo; `product_id`; `email` do checkout; índice de e-mail sem dono | `user_id NOT NULL` (FK `RESTRICT`); **sai** `product_id`; `email` = fotografia da conta; **novos** `cart_version`, `terms_version`, `terms_accepted_at` (`NOT NULL`: aceite na página do site, gravado na criação); **sai** `orders_unclaimed_email_idx` |
| Itens | — | **Nova:** `order_items` (PK `(order_id, product_id)`, `position`, `stripe_price_id`, `unit_amount`, `currency` preenchidos na liberação) |
| Estados do pedido | `open`, `pending_payment`, `paid`, `failed`, `expired`, `refunded`, `disputed` (10 arestas) | + **`dispute_lost`**; `disputed` → `paid`/`dispute_lost`/`refunded`; `refunded` só manual excepcional; **11 arestas**; pedido inteiro |
| `entitlements` | Um por pedido (`order_id, product_id` com `orders.product_id`); `expires_at` | **Um por item** (FK composta para `order_items`); **`user_id`** com FK composta para `orders`; **sai `expires_at`** (sem expiração) |
| I-5 | Direito ativo ⇔ pedido `paid` (exceção `manual`) | **Por item:** `paid` ⇔ todos os itens com direito ativo; `disputed`/`dispute_lost`/`refunded` todos revogados; demais estados sem direito |
| Perfil e consentimento | — | **Novas:** `profiles` (cliente Stripe, opt-in vigente), `marketing_consents` (só inserção, sem IP), `email_suppressions` |
| Funil | — | **Nova:** `funnel_events` (só inserção, 9 tipos, sem dado pessoal) |
| Fila de e-mail | `email_outbox` só para o e-mail de acesso do pedido (`product_name`, `to_email`); colunas de envio atualizáveis pelo `service_role` | **Generalizada:** `kind` (`delivery`, `cart_reminder`, `post_purchase`), `category`, `user_id`, `payload` jsonb, `scheduled_at`, `dedupe_key` único, `skipped`/`canceled` com `skip_reason`; envio só por RPC |
| `auth.users` | Sem trigger | **Triggers:** zera a senha na primeira confirmação, cria o perfil, registra `account_confirmed` (D-18, I-17) |
| `private` | `claimable_email`, `product_is_sellable`, `access_effect`... | **Sai** `claimable_email`; **entram** `confirmed_email`, `require_confirmed_email`, `owned_game_ids`, `marketing_allowed`, `sync_profile_consent`, `guard_user_nulling`, `enqueue_followups`; `product_is_sellable` passa a valer por produto e entra no DDL |
| Grants (D-12) | `service_role` com `SELECT`/`UPDATE` por coluna em `email_outbox` | **`service_role` sem privilégio de tabela algum** (19 tabelas, nenhuma exceção) |
| RPCs | 11 (`claim_orders`, `create_order`, `fulfill_order`, `set_order_status`, ...) | **22.** **Saem** `claim_orders`, `create_order`. **Mudam** `fulfill_order` (vários itens, cliente, carrinho, entrega), `set_order_status` (contestações, `dispute_lost`), `get_order_status` (`owner`/`other`, `items`), `get_library` (por jogo), `get_account` (itens e consentimento), `resolve_download` (sem expiração). **Entram** `get_catalog`, `get_cart`, `cart_add`, `cart_remove`, `create_order_from_cart`, `set_stripe_customer`, `set_marketing_consent`, `unsubscribe`, `record_email_event`, `resolve_delivery`, `claim_email_batch`, `mark_email_result`, `mark_marketing_prompt`. `attach_checkout_session`, `get_free_game`, `resolve_free_download` seguem |
| `fulfill_order` | `p_email`, 1 produto, devolve `send_access_email` | `p_items` (line_items), `p_customer_id`; sem `p_email` e sem aceite dos termos (já está no pedido); limpa os itens pagos do carrinho e sobe a `version`; enfileira a entrega; devolve `entitlement_count`, `outbox_id`, `send_delivery` |
| Códigos `KT` | `KT001`–`KT008` | **+** `KT009` `email_not_confirmed`, `KT010` `immutable_column`, `KT011` `access_inconsistent`, `KT012` `items_mismatch` |
| Decisões | P-1 (reembolso) e P-3 (prazo) propostas | **P-1 e P-3 decididos** (D-15); D2 e D4 em padrão provisório (D-16, D-17); P-2 e P-10 seguem como propostas |
| Seed | P001 e 5 jogos; pedidos O1–O6 de um produto | P001 + avulsos **só TESTE**; 5 usuários (um não confirmado); pedidos em todos os estados novos; carrinhos; consentimento; entrega na fila |
| Aceite dos termos (v0.3.1) | Previsto no `consent_collection` do Checkout hospedado | Checkout **embutido**: aceite colhido na nossa página; `create_order_from_cart(..., p_terms_accepted)` grava `terms_accepted_at` e `terms_version`; `fulfill_order` e `set_order_status` não recebem o aceite |
| Follow-ups, supressões e agenda (v0.3.5) | Só contrato | `record_email_event` (horário do evento, revogação só para evento posterior ao opt-in), `private.enqueue_followups` (3 h, D+3 até D+14, `scheduled_at = least(p_now, now())`) e `private.dispatch_tick` com o job do `pg_cron` (D-27); segredos do despacho no Vault; as 22 RPCs do contrato existem |
| Downloads, entrega e fila (v0.3.4) | Só contrato | `resolve_download`, `resolve_delivery`, `get_free_game`, `resolve_free_download`, `claim_email_batch` e `mark_email_result` implementados; a chave do B2 sai só delas (D-26); a fila rechecada no claim (marketing, carrinho, pedido, limite de 1 por 24 h); `sending` parado conta tentativa; seed com os metadados reais dos 5 PDFs de TESTE |
| Cupons (v0.3.3) | Sem cupom | `orders` ganha `amount_subtotal`, `amount_discount` e `promotion_code` (valores gravados uma vez, `KT010`); `order_items.unit_amount` passa a ser o preço cheio; `fulfill_order` e `set_order_status` recebem subtotal, desconto, código e `p_event_type`; `no_payment_required` com total 0 e desconto > 0 libera como pago (D-25); `get_account` mostra o desconto; `get_order_status` só traz itens ao dono |
| Convite de marketing (v0.3.2) | — | `profiles.marketing_prompted_at` e `mark_marketing_prompt(uuid)`; `set_marketing_consent` com `signup_prompt` preenche o marcador; `get_account` devolve `marketing.prompted_at`. Ver ou dispensar o convite não é consentimento |
| Testes | T01–T104 (12 tabelas, 11 RPCs) | Reorganizados em 11 arquivos + concorrência, T01–T125 (19 tabelas, 22 RPCs); novos: carrinho, checkout multi-item, contestações, consentimento, fila de e-mail, follow-ups, trigger de senha |

Histórico anterior (v0.1 a v0.2.2, mesmo dia): revisão do Ferrolho nas seções 5 e 6; `get_account` e `get_order_status`; `deferred`; aresta `open → failed`; `create_order` com `p_livemode` obrigatório; `service_role` sem `SELECT` (D-12); `product_name` na fila.
