-- Catálogo REAL do keytotwo-print-db (Supabase hospedado), decisões do responsável de 2026-10-16.
-- Não é migração nem seed: roda uma vez no remoto, com autorização do responsável. O banco local continua com o seed de TESTE.
-- Jogos pagos (código J): J001 Rabisque e Adivinhe, J003 Tabuleiro da Sorte e J002 O Sumiço de Rapadura, nessa ordem no P001.
-- O P001 vende com 3 jogos (games_expected = 3); o avulso J001 tem 1. O F001 (Hora dos Artistas, grátis) entra quando o PDF chegar.
-- O nome de download é o do PDF no Drive, sem acento ("O Sumico de Rapadura.pdf"); o nome do jogo mantém o ç.
-- Os PDFs já estão no B2 (supabase/functions/tests/upload-game-files.ts): tamanho, sha256 e fileId são os conferidos na leitura.
-- Os produtos nascem draft e sem preço: o stripe_price_id é por ambiente e não fica em arquivo versionado (P-5). Depois deste
-- arquivo, um update à parte grava o stripe_price_id e passa os produtos para active.
-- Um único bloco (uma transação). Recusa rodar de novo se algum código já existir.

do $catalogo$
declare
  v_bucket constant text := 'keytotwo-print-attachments';
  v_p001 bigint;
  v_j001 bigint;
  v_game bigint;
  v_file uuid;
  r      record;
begin
  if exists (select 1 from public.games where code in ('J001', 'J002', 'J003'))
     or exists (select 1 from public.products where code in ('P001', 'J001')) then
    raise exception 'catálogo: códigos já cadastrados; nada foi alterado';
  end if;

  insert into public.products (code, slug, kind, name, games_expected) values
    ('P001', 'p001', 'bundle', 'Coleção KeyToTwo: Fundadores', 3),
    ('J001', 'j001', 'single', 'Rabisque e Adivinhe', 1);
  select id into v_p001 from public.products where code = 'P001';
  select id into v_j001 from public.products where code = 'J001';

  for r in select * from (values
    (1, 'J001', 'rabisque-e-adivinhe',   'Rabisque e Adivinhe',  'Rabisque e Adivinhe.pdf',  'paid/J001-rabisque-e-adivinhe.pdf',   4399761::bigint,
        '48f4622e5bd9c7a8632f8a3fd7bf0385c5c8a572aec79cc52291a2f0174ad782',
        '4_z5ec9b03d120d18b7ac120319_f104feb9550afbe30_d20261016_m114540_c005_v0501051_t0026_u01792151140848',
        timestamptz '2026-10-16 11:45:40+00'),
    (2, 'J003', 'tabuleiro-da-sorte',    'Tabuleiro da Sorte',   'Tabuleiro da Sorte.pdf',   'paid/J003-tabuleiro-da-sorte.pdf',    6837946,
        '132d67f8ac687e8e39c34ddc0fe82804301c2d8f342c14062fc37ef4ca92f1f6',
        '4_z5ec9b03d120d18b7ac120319_f10325f70366f7501_d20261016_m114555_c005_v0501001_t0052_u01792151155837',
        timestamptz '2026-10-16 11:45:55+00'),
    (3, 'J002', 'o-sumico-de-rapadura',  'O Sumiço de Rapadura', 'O Sumico de Rapadura.pdf', 'paid/J002-o-sumico-de-rapadura.pdf',  13195009,
        '42f84d4d0181a8a86c8569b6583ca478fe435b2eba149b215b7829dfd58146f2',
        '4_z5ec9b03d120d18b7ac120319_f1067a52207d15ddf_d20261016_m114546_c005_v0501036_t0045_u01792151146455',
        timestamptz '2026-10-16 11:45:46+00')
  ) as t(position, code, slug, name, filename, object_key, size_bytes, sha256, b2_file_id, uploaded_at)
  loop
    insert into public.games (code, slug, name, access, status)
    values (r.code, r.slug, r.name, 'paid', 'published')
    returning id into v_game;

    insert into public.product_games (product_id, game_id, position) values (v_p001, v_game, r.position);
    if r.code = 'J001' then
      insert into public.product_games (product_id, game_id, position) values (v_j001, v_game, 1);
    end if;

    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_game, 'pdf', 'paid', '1.0', r.filename, r.size_bytes, r.sha256, 'published', now())
    returning id into v_file;
    insert into public.file_objects (file_id, access, bucket, object_key, b2_file_id, uploaded_at)
    values (v_file, 'paid', v_bucket, r.object_key, r.b2_file_id, r.uploaded_at);
  end loop;
end
$catalogo$;
