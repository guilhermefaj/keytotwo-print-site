-- J004 (A Rota da Fornalha) e J005 (Retrospectiva a Dois) no keytotwo-print-db (Supabase hospedado).
-- Decisões do responsável (2026-10-23): os dois são pagos, se vendem sozinhos (J004 a R$ 12,90 e J005 a R$ 9,90) e
-- entram no P001 (essa parte é fundadores-cinco-jogos.sql, que roda na publicação do site).
-- Não é migração nem seed: roda uma vez no remoto, com autorização do responsável. O banco local continua com o seed de TESTE.
-- Os PDFs já estão no B2 (supabase/functions/tests/upload-game-files.ts, 2026-10-23): tamanho, sha256 e fileId são os
-- conferidos na releitura com a chave só leitura.
-- Os produtos nascem draft e sem preço: o stripe_price_id é por ambiente e não fica em arquivo versionado (P-5). Depois
-- deste arquivo, um update à parte grava o stripe_price_id e passa os produtos para active.
-- Um único bloco (uma transação). Recusa rodar de novo se algum código já existir.
do $j004_j005$
declare
  v_bucket constant text := 'keytotwo-print-attachments';
  v_product bigint;
  v_game bigint;
  v_file uuid;
  r record;
begin
  if exists (select 1 from public.games where code in ('J004', 'J005'))
     or exists (select 1 from public.products where code in ('J004', 'J005')) then
    raise exception 'catálogo: J004 ou J005 já cadastrados; nada foi alterado';
  end if;

  for r in select * from (values
    ('J004', 'a-rota-da-fornalha',   'A Rota da Fornalha',   'A Rota da Fornalha.pdf',   'paid/J004-a-rota-da-fornalha.pdf',   7527609::bigint,
        '2bf1ff33e390bd238d5a26baa62a08a22e70f9684c5cdd5683417603c437f556',
        '4_z5ec9b03d120d18b7ac120319_f1082597858690528_d20261023_m233040_c005_v0501042_t0013_u01792798240443',
        timestamptz '2026-10-23 23:30:40+00'),
    ('J005', 'retrospectiva-a-dois', 'Retrospectiva a Dois', 'Retrospectiva a Dois.pdf', 'paid/J005-retrospectiva-a-dois.pdf', 3914665,
        '640acd26094aaedf7981f50826de5295afb465f4e82984e8402cd4e344fac1b9',
        '4_z5ec9b03d120d18b7ac120319_f10361008375acfa9_d20261023_m233043_c005_v0501011_t0038_u01792798243548',
        timestamptz '2026-10-23 23:30:43+00')
  ) as t(code, slug, name, filename, object_key, size_bytes, sha256, b2_file_id, uploaded_at)
  loop
    insert into public.games (code, slug, name, access, status)
    values (r.code, r.slug, r.name, 'paid', 'published')
    returning id into v_game;
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_game, 'pdf', 'paid', '1.0', r.filename, r.size_bytes, r.sha256, 'published', now())
    returning id into v_file;
    insert into public.file_objects (file_id, access, bucket, object_key, b2_file_id, uploaded_at)
    values (v_file, 'paid', v_bucket, r.object_key, r.b2_file_id, r.uploaded_at);
    -- Avulso (o slug do produto segue o padrão dos outros: o código em minúsculas).
    insert into public.products (code, slug, kind, name, games_expected)
    values (r.code, lower(r.code), 'single', r.name, 1)
    returning id into v_product;
    insert into public.product_games (product_id, game_id, position) values (v_product, v_game, 1);
  end loop;
end
$j004_j005$;
