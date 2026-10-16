-- Avulsos J003 (Tabuleiro da Sorte) e J002 (O Sumiço de Rapadura) no keytotwo-print-db (Supabase hospedado).
-- Decisão do responsável (2026-10-16): todo jogo pago também se vende sozinho; J003 a R$ 9,90 e J002 a R$ 12,90.
-- Não é migração nem seed: roda uma vez no remoto, com autorização do responsável, depois de catalogo-inicial.sql.
-- Os jogos e PDFs já existem (catalogo-inicial.sql); aqui só nascem os produtos avulsos e o vínculo com o jogo.
-- Os produtos nascem draft e sem preço: o stripe_price_id é por ambiente e não fica em arquivo versionado (P-5).
-- Depois deste arquivo, um update à parte grava o stripe_price_id e passa os produtos para active.
-- Um único bloco (uma transação). Recusa rodar de novo se algum código já existir.

do $avulsos$
declare
  r record;
  v_product bigint;
  v_game bigint;
begin
  if exists (select 1 from public.products where code in ('J002', 'J003')) then
    raise exception 'avulsos: J002 ou J003 já cadastrados; nada foi alterado';
  end if;

  for r in select * from (values
    ('J003', 'j003', 'Tabuleiro da Sorte'),
    ('J002', 'j002', 'O Sumiço de Rapadura')
  ) as t(code, slug, name)
  loop
    select id into strict v_game from public.games where code = r.code and access = 'paid' and status = 'published';
    insert into public.products (code, slug, kind, name, games_expected)
    values (r.code, r.slug, 'single', r.name, 1)
    returning id into v_product;
    insert into public.product_games (product_id, game_id, position) values (v_product, v_game, 1);
  end loop;
end
$avulsos$;
