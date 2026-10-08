# A2 — assets reais para conversão

Gerado por `node scripts/prepare-conversion-assets.mjs`. Fontes lidas, sem alterações, do vault/Drive; nenhum original novo foi copiado para o repositório nesta fase. Somente `scripts/`, `public/media/` e `docs/` são alterados. Variáveis opcionais: `KTT_VAULT_ROOT`, `KTT_WALK_SOURCE`, `PDFTOPPM`. Requer Sharp do projeto e Poppler no PATH.

## Origem e fidelidade

- atlas: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/Kito Walking v3/kito_walk_right_atlas.png` (1124099 bytes), SHA-256 `f4ec908e31d0a4038822fe65cc28d140ed4c958b2048a7c1656136b12d3d87bc`.
- board: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Marca/Pixel Art/kito_tabuleiro.png` (923639 bytes), SHA-256 `cdc4750090baa4b4c42ece8d762251c1312ba210523510bf4f2c49ee3488406f`.
- hi: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Marca/Pixel Art/kito_hi.png` (648224 bytes), SHA-256 `e7acb17fc6be5d3631bd19c9f4846fbd8b2c75cf2f423d21d4467842bf8c8982`.
- pdf: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Jogos/J001 - Rabisque e adivinhe.pdf` (1302077 bytes), SHA-256 `589d1797d5dad9184c6bb6a9a88192dbf981d242a241acdc3fb94c90b4297387`.

Atlas RIGHT v3.1: **2304 × 768**, 12 quadros, células 384 × 384, sem redimensionamento nem alteração de poses. WebP **492982 bytes**, redução de **56.1%** sobre o PNG. Comparação de todos os canais RGBA, inclusive RGB sob alfa zero: **0 bytes diferentes**. Hash RGBA de ambos: `a5f23cfe165944ab5fc7fc1bbfa13576c7a3ed0dbbe21a025f926f6dcc1b3e90`.

WebP usa `lossless: true, exact: true, quality: 100, effort: 6`. `exact` é necessário para preservar também RGB invisível. Nenhuma quantização, IA ou composição fictícia. O atlas PNG fica disponível até a troca da URL em src na fase 2; não removê-lo antes.

O PDF real foi localizado pela ficha do J001 em `95-Anexos/KeyToTwo/Jogos`. Páginas 1 (instruções e cartas), 2 e 3 (cartas), completas, renderizadas a 720 px de largura. São prévias do documento existente, não arquivos de impressão, novas capas nem jogos adicionais. `kito_tabuleiro` é ilustração de marca: o tabuleiro desenhado não representa um componente incluído no P001.

## Derivados preparados

| Arquivo em public/media | Dimensões | Bytes |
| --- | --- | ---: |
| hero/kito-walk-v31-right-atlas.webp | 2304 × 768 | 492982 |
| experience/kito-tabuleiro-240.webp | 240 × 240 | 44750 |
| experience/kito-tabuleiro-480.webp | 480 × 480 | 138918 |
| experience/kito-hi-128.webp | 128 × 128 | 10382 |
| experience/kito-hi-256.webp | 256 × 256 | 33164 |
| experience/j001-page-1-720.webp | 720 × 1019 | 59576 |
| experience/j001-page-2-720.webp | 720 × 1019 | 13834 |
| experience/j001-page-3-720.webp | 720 × 1019 | 14420 |

Os Kitos preservam o canvas completo e a proporção; resize nearest-neighbor, sem retoque. Cada WebP foi decodificado e comparado byte a byte ao raster de referência. Metadados completos e hashes em [conversion-assets.json](conversion-assets.json).

## Orientação para a fase 2

- Substituir a URL do atlas no CSS e atualizar verify-hero; só então retirar o PNG antigo servido. Ritmo, chão, escala e frames ficam idênticos.
- Usar materiais reais na composição e no card da oferta; reservar width/height, alt descritivo e carregamento lazy fora da primeira dobra.
- Kito tabuleiro: variantes 240/480; Kito hi: 128/256. Carregar somente a variante necessária, reutilizando a mesma URL nos pilares.
- As três páginas são do J001; não apresentá-las como três jogos do pacote. Rótulo sugerido: “Uma prévia de Rabisque e Adivinhe”.
- A mídia da primeira dobra deve ser medida após a integração. Somente o atlas exato já ocupa quase 500 KB; a troca de formato não garante atingir a meta total.

Guidelines consultadas: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), especialmente dimensões reservadas e lazy loading abaixo da dobra. Skills de direção: frontend-design, copywriting; inspeção do PDF: pdf.
