-- Gratuitos REAIS do keytotwo-print-db (Supabase hospedado), decisões do responsável de 2026-10-20.
-- Não é migração nem seed: roda uma vez no remoto, com autorização do responsável, DEPOIS da migração
-- 20261020150000_gratuitos.sql (antes dela, o índice games_one_published_free recusa o segundo gratuito publicado).
-- F001 Hora dos Artistas e F002 Pote de Planos: jogos access='free', fora de qualquer produto, publicados com o PDF.
-- Os PDFs já estão no B2 (supabase/functions/tests/upload-game-files.ts, 2026-10-20): tamanho, sha256 e fileId são os
-- conferidos na leitura. O nome de download é o do PDF no Drive, sem o código.
-- Um único bloco (uma transação). Recusa rodar de novo se algum código já existir.
do $gratuitos$
declare
  v_bucket constant text := 'keytotwo-print-attachments';
  v_game bigint;
  v_file uuid;
  r      record;
begin
  if exists (select 1 from public.games where code in ('F001', 'F002')) then
    raise exception 'gratuitos: códigos já cadastrados; nada foi alterado';
  end if;
  for r in select * from (values
    ('F001', 'hora-dos-artistas', 'Hora dos Artistas', 'Hora dos Artistas.pdf', 'free/F001-hora-dos-artistas.pdf', 4759660::bigint,
        '7da69bc72ad63b0724781f32f6572901008044ef9acc6b7cfb268378a987b573',
        '4_z5ec9b03d120d18b7ac120319_f108e7b9e267f76d4_d20261020_m193308_c005_v0501048_t0049_u01792524788439',
        timestamptz '2026-10-20 19:33:08+00'),
    ('F002', 'pote-de-planos',    'Pote de Planos',    'Pote de Planos.pdf',    'free/F002-pote-de-planos.pdf',    2674891,
        '86257239b7fd10e5703d9976c166c40f7c501b044b20660930825bf06886b963',
        '4_z5ec9b03d120d18b7ac120319_f118b465754e1c30d_d20261020_m193311_c005_v0501001_t0032_u01792524791379',
        timestamptz '2026-10-20 19:33:11+00')
  ) as t(code, slug, name, filename, object_key, size_bytes, sha256, b2_file_id, uploaded_at)
  loop
    insert into public.games (code, slug, name, access, status)
    values (r.code, r.slug, r.name, 'free', 'published')
    returning id into v_game;
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_game, 'pdf', 'free', '1.0', r.filename, r.size_bytes, r.sha256, 'published', now())
    returning id into v_file;
    insert into public.file_objects (file_id, access, bucket, object_key, b2_file_id, uploaded_at)
    values (v_file, 'free', v_bucket, r.object_key, r.b2_file_id, r.uploaded_at);
  end loop;
end
$gratuitos$;
