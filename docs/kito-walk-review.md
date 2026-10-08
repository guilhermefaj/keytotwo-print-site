# K31 — caminhada Kito v3.1

2026-10-08. Floor `featkito-v31`, branch `feat/kito-v31`. Sem commit/push. Revisão visual final reservada ao responsável.

## Arte e movimento

Atlas oficial copiado intacto de `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/Kito Walking v3/kito_walk_right_atlas.png`: 2304×768, 6×2 células de 384 px, 1.124.099 bytes. SHA-256 `f4ec908e31d0a4038822fe65cc28d140ed4c958b2048a7c1656136b12d3d87bc`. Nenhuma imagem regenerada, recortada ou editada; folhas antigas de quatro quadros removidas do conteúdo servido. Manifesto oficial preservado em `kito-walk-source-manifest.json`.

12 poses, 01→12→01, 10 fps, ciclo 1,2 s. Canvas uniforme de 192 px no desktop e 128 px no celular, nearest-neighbor. Altura visível aproximada: 159,5–163 / 106,3–108,7 px.

- Distância por ciclo = `S × 520 / 1254`: 79,6172 / 53,0781 px.
- Velocidade = distância × `10 / 12`: **66,3477 / 44,2318 px/s**.
- Linha de chão = `S × 1160 / 1254`: 177,6077 / 118,4051 px desde o topo do canvas.
- Duas animações CSS sincronizadas, posição e pose avançam a cada 100 ms. Offset inicial visível, quadro 01. O loop de percurso só reinicia com todo o canvas fora da borda. Pausas preservam a pose da folha.

`node scripts/prepare-walk-assets.mjs` valida o hash e as dimensões, lê os pixels sem modificá-los e atualiza os manifestos e parâmetros. A cópia local permite executar sem acesso ao Drive. A leitura dos documentos e do HTML de origem foi concluída; a abertura de `preview.html` por file:// foi bloqueada pelo navegador da ferramenta. Atlas inspecionado diretamente e hero integrada observada na prévia. Não se declara aprovação visual.

## Verificações reais

- `npm ci`: exit 0; 245 pacotes, zero vulnerabilidades reportadas.
- `npm run lint`: exit 0.
- `npm run build` (inclui `npm run typecheck`): exit 0; 12 rotas pré-renderizadas.
- `npm run test:e2e -- --workers=2`: exit 0; **51 testes passaram**.
- `HERO_URL=http://127.0.0.1:4174/ HERO_QA_DIR=D:/Maestri/qa/keytotwo-k31 npm run verify:hero`: exit 0, **PASS** no build.
- Matriz 320×800, 390×844, 768×1024, 1280×720 e 1440×900, texto normal e fontes computadas a 200%: sem overflow ou caixas textuais cortadas. Não é zoom nativo. Delta do chão <0,015 px.
- Pausa/retomada por teclado, suspensão fora de vista, troca real de abas, preservação da pausa manual e movimento reduzido passaram. Zero erros de console/runtime no navegador isolado do teste.
- Percursos completos: desktop 24,7 s e celular 11,9 s. As 12 poses foram observadas, inclusive 12→01; nenhuma pose pulada. Diferença entre relógios: 0 ms. Deslocamento com pose retida: 0 px. Deriva máxima calculada da âncora de apoio do manifesto: <0,00012 px. Essa medição geométrica não substitui aprovação visual do contato dos pés.
- Mídia transferida: **1.429.359 bytes** em ambas as escalas (seis imagens e três fontes). A meta anterior de 500 KB não foi atingida: o atlas intacto exigido pesa 1.124.099 bytes. Exceção registrada explicitamente no verificador e nos manifestos; sem compressão não autorizada.

Relatório e capturas fora do versionamento: `D:/Maestri/qa/keytotwo-k31/report.json`, `hero-1440x900.png`, `hero-390x844.png` e versões da matriz com `-text200.png`. Logs `e2e.log` e `verify.log` na mesma pasta.

Prévia: **http://127.0.0.1:5177/preview/hero** (`npm run dev`, host 127.0.0.1, strictPort). Outros floors e servidores preservados. Pendente: avaliação visual do responsável e integração pelo Costura.