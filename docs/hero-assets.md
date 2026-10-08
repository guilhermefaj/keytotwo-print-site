# Hero: origem e preparação dos assets — caminhada revisão 2

Gerado por `npm run assets:prepare`. Originais preservados em `art-source/hero`, fora de `public` e do bundle. Não é necessário acessar o vault para reproduzir. SHA-256, recortes e caixas alfa no [manifesto](hero-assets.json).

Logo, nuvens e paisagem: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Marca/Pixel Art`. Transformação: recorte especificado (quando presente), recorte útil por alfa >12, redução nearest-neighbor e WebP lossless. Os originais não são modificados. A paisagem fornece dois recortes distintos nas extremidades; não é usada como tile. Chão e silhueta distante em CSS/SVG próprios.

Caminhada oficial RIGHT, **revisão 2 (2026-10-08 09:33)**: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art`. Steps 01, 02 e 04 atualizados com o corpo do step03, que não mudou. Os quatro hashes desta revisão são conferidos pelo script. Amostragem central na grade de 20 px, alfa binário, ampliação inteira x2/x3 nearest-neighbor e folhas lossless de quatro células. Registro, hashes, cálculo da passada e recursos de revisão: [kito-walk-assets.md](kito-walk-assets.md). Nenhum LEFT é servido. `kito-static.webp` foi removido da mídia pública; a pausa usa a própria folha. `kito.png` permanece apenas como referência original de identidade, fora do bundle.

| Derivado | Origem | Dimensões | Bytes | KiB |
| --- | --- | --- | ---: | ---: |
| keytotwo-logo.webp | keytotwo_logo.png | 420 × 97 | 40044 | 39.11 |
| cloud-a.webp | nuvens_2.png | 280 × 117 | 21996 | 21.48 |
| cloud-b.webp | nuvens_2.png | 208 × 88 | 14480 | 14.14 |
| foliage-right.webp | paisagem_direita.png | 720 × 298 | 134618 | 131.46 |
| foliage-left.webp | paisagem_direita.png | 360 × 119 | 40694 | 39.74 |
| kito-walk-2x.webp | kito_walking_right_step01.png … step04.png | 512 × 128 | 13322 | 13.01 |
| kito-walk-3x.webp | kito_walking_right_step01.png … step04.png | 768 × 192 | 15078 | 14.72 |

Total em disco: **280232 bytes (273.66 KiB)**. Inclui ambas as escalas; o navegador carrega uma folha por viewport. O relatório de QA mede o peso HTTP das seis imagens e três fontes realmente transferidas.
