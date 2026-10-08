# Quadros oficiais RIGHT: preparação reproduzível — revisão 2

Revisão oficial 2 (2026-10-08 09:33). Tarefa 3C: corpo do step03 aplicado a 01, 02 e 04; step03 preservado. Gerado por `npm run assets:prepare` (ou `node scripts/prepare-walk-assets.mjs`).

Origem: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art`. Quatro RIGHT preservados em `art-source/hero`; nenhum LEFT copiado ou servido. O script recusa hashes diferentes dos prefixos informados para a revisão 2. Valores completos no [manifesto](kito-walk-assets.json).

| Original | Dimensões | Bytes | SHA-256 (16 hex) |
| --- | --- | ---: | --- |
| kito_walking_right_step01.png | 1254×1254 | 742824 | 8f4ff15f23801c1c |
| kito_walking_right_step02.png | 1254×1254 | 747061 | 7523cc2f7b8bc453 |
| kito_walking_right_step03.png | 1254×1254 | 732143 | aaf48ef989d61133 |
| kito_walking_right_step04.png | 1254×1254 | 740464 | 70e7462ab067d6a3 |

Amostragem no centro das células de 20×20 pixels, na mesma origem de canvas, para 64×64 pixels. Alfa <128 é transparente; o restante fica opaco. Sem recorte individual, mudança de pose, interpolação ou quadros inventados. Ampliação inteira nearest-neighbor e WebP lossless.

Âncora: centro dos pixels escuros do olho na região x710–850/y350–520. Variação máxima: **0.0318 pixel nativo**. Nenhuma translação necessária. Topo nativo y6 e linha inferior dos pés y57 nos quatro quadros; borda do chão y58. Altura visível 52 pixels: **156 px desktop (x3)** e **104 px mobile (x2)**, próxima aos 152/116 px do fallback anterior. Inclinação e elevação das solas preservadas da arte oficial.

| Folha | Dimensões | Células | Bytes |
| --- | --- | --- | ---: |
| kito-walk-2x.webp | 512×128 | 4 de 128×128 | 13322 |
| kito-walk-3x.webp | 768×192 | 4 de 192×192 | 15078 |

Sequência **01→02→03→04**, **8 fps**, ciclo **0.5 s**. Desvio autorizado: quatro quadros oficiais em perfil, no lugar dos 6–8 em três quartos previstos no briefing inicial. Oito fps mantém cada pose por 125 ms, sem intermediários. A prévia animada usa o mesmo ritmo.

Sola por quadro: centro x da última linha de pixels quentes do pé plano; região y≥48; lados separados em x33. Coordenadas nativas: 01: x=21, y=56; 02: x=44, y=57; 03: x=20, y=57; 04: x=39.333333, y=56.

Recuos 01→03 = **1 px**, 02→04 = **4.666667 px**. Média **2.833333 px** em **2/8 = 0.25 s**. Velocidade = recuo × escala / duração: desktop **2.833333 × 3 / 0.25 = 34 px/s**; mobile **2.833333 × 2 / 0.25 = 22.666667 px/s**.

A revisão 2 mudou a medida da sola. A velocidade foi reduzida para acompanhar essa passada, abaixo das faixas desejadas de 40–56/24–32 px/s, conforme a prioridade autorizada. Não se conserva a calibração da revisão 1. Os parâmetros usados pela aplicação são gerados em `src/kito-motion.ts`.

Limite da calibração: ajuste médio das solas de quatro poses discretas, que também mudam de forma. Os dois recuos são diferentes; a velocidade uniforme não produz contato fisicamente imóvel em ambos. Resíduo entre as duas amostras de apoio: ±5.5 px desktop / ±3.666667 px mobile. Não se afirma deslizamento zero. Não foram alterados os pés oficiais para compensar.

Recursos de revisão em `art-source/hero/walk-review`, não servidos:

| Arquivo | Dimensões por quadro | Quadros | Bytes |
| --- | --- | ---: | ---: |
| step01-3x.png | 192×192 | 1 | 5174 |
| step02-3x.png | 192×192 | 1 | 5289 |
| step03-3x.png | 192×192 | 1 | 5217 |
| step04-3x.png | 192×192 | 1 | 5005 |
| official-walk-preview.webp | 192×192 | 4 | 15746 |
| official-contact-sheet.png | 768×224 | 1 | 24467 |
