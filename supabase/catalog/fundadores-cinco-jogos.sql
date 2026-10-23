-- P001 (Coleção KeyToTwo: Fundadores) passa de 3 para 5 jogos: J001, J003, J002, J004 e J005 (responsável, 2026-10-23).
-- Roda na publicação do site que mostra o pacote com 5 jogos, depois de fundadores-j004-j005.sql e da ativação dos
-- avulsos J004 e J005 com preço. O preço do P001 não muda (R$ 29,90, promoção de lançamento; o site risca R$ 39,90).
-- Quem já tem o P001 ganha os jogos novos que ainda não tem (responsável, 2026-10-23), como presente de cortesia
-- (admin_gift_products): pedido de R$ 0, direito por produto e a ação no histórico do admin, com o motivo.
-- A composição de cada compra antiga não muda (entitlement_games é a fotografia da compra).
-- Não é migração nem seed: roda uma vez no remoto, com autorização do responsável. Antes, na mesma sessão:
--   set kt.admin_id = '<id da conta de admin que dá o presente>';
--   set kt.notify = 'true';   -- 'true' manda o e-mail de presente; 'false' só libera em Meus jogos
-- Um único bloco (uma transação). Recusa rodar de novo se o P001 já tiver mudado.
do $cinco_jogos$
declare
  v_admin  uuid    := nullif(current_setting('kt.admin_id', true), '')::uuid;
  v_notify boolean := nullif(current_setting('kt.notify', true), '')::boolean;
  v_reason constant text := 'Coleção Fundadores ganhou A Rota da Fornalha e Retrospectiva a Dois: jogos novos para quem já tem o pacote';
  v_p001 bigint;
  v_j004 bigint;
  v_j005 bigint;
  v_codes text[];
  v_gift record;
  v_count integer := 0;
  r record;
begin
  if v_admin is null or v_notify is null then
    raise exception 'pacote: defina kt.admin_id e kt.notify na sessão antes; nada foi alterado';
  end if;
  select id into strict v_p001 from public.products where code = 'P001';
  select id into strict v_j004 from public.games where code = 'J004' and access = 'paid' and status = 'published';
  select id into strict v_j005 from public.games where code = 'J005' and access = 'paid' and status = 'published';
  if (select games_expected from public.products where id = v_p001) <> 3
     or exists (select 1 from public.product_games pg where pg.product_id = v_p001 and pg.game_id in (v_j004, v_j005)) then
    raise exception 'pacote: o P001 já mudou; nada foi alterado';
  end if;
  if (select count(*) from public.products where code in ('J004', 'J005') and status = 'active') <> 2 then
    raise exception 'pacote: ative antes os avulsos J004 e J005, com preço; nada foi alterado';
  end if;

  update public.products set games_expected = 5 where id = v_p001;
  insert into public.product_games (product_id, game_id, position) values (v_p001, v_j004, 4), (v_p001, v_j005, 5);

  -- Quem tem o P001 ativo (compra ou presente) e conta viva ganha o que ainda não tem dos dois jogos novos.
  for r in select distinct e.user_id from public.entitlements e
             join auth.users u on u.id = e.user_id and u.deleted_at is null
            where e.product_id = v_p001 and e.status = 'active'
  loop
    select array_agg(t.code order by t.code) into v_codes
      from (values ('J004', v_j004), ('J005', v_j005)) as t(code, game_id)
     where not exists (select 1 from public.entitlements e
                         join public.entitlement_games eg on eg.entitlement_id = e.id
                        where e.user_id = r.user_id and e.status = 'active' and eg.game_id = t.game_id);
    continue when v_codes is null;
    select * into v_gift from public.admin_gift_products(v_admin, r.user_id, v_codes, v_reason, v_notify, true);
    if v_gift.outcome <> 'ok' then
      raise exception 'pacote: o presente de % para uma conta voltou %; nada foi alterado', v_codes, v_gift.outcome;
    end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'pacote: P001 com 5 jogos; % conta(s) ganharam os jogos novos', v_count;
end
$cinco_jogos$;
