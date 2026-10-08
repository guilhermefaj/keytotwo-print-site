# Kito v3.1 — atlas oficial preservado

Origem: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/Kito Walking v3/kito_walk_right_atlas.png`. Somente o atlas RIGHT usado foi convertido em WebP lossless exact, com RGBA idêntico, para `public/media/hero/kito-walk-v31-right-atlas.webp`. Sem recorte, geração, quantização, interpolação ou alteração de corpo/pés/asa. Nenhum LEFT servido. As folhas antigas de quatro poses foram removidas de public.

WebP RGBA: **2304 × 768**, 6 colunas × 2 linhas, células **384 × 384**, **492982 bytes**. SHA-256: `5642dc8f739afc4f1b3824f360df4327d0ec4e8d9cee5e46b3fc1bf790ec8ced`. Parâmetros oficiais copiados em [kito-walk-source-manifest.json](kito-walk-source-manifest.json).

O script `node scripts/prepare-walk-assets.mjs` apenas confere o hash e lê os pixels/manifesto já presentes no repositório, gera parâmetros e documentação. Não escreve imagens nem requer o Drive para reproduzir a conferência.

Sequência 01→02→…→12→01, **10 FPS**, ciclo **1,2 s**, sem pose adicional. Duas camadas CSS: posição em steps de 100 ms; poses em 12 intervalos de 100 ms, ordem row-major. Mesmo atraso inicial em ciclos inteiros; relógios pausam/retomam juntos. Nenhum estado React por frame.

| Tela | Canvas S | Distância/ciclo S×520/1254 | Velocidade ×10/12 | Chão S×1160/1254 |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 192px | 79.617225px | 66.347687px/s | 177.607656px |
| Celular | 128px | 53.078150px | 44.231792px/s | 118.405104px |

Escala uniforme 1/2 no desktop e 1/3 no celular, `image-rendering: pixelated`. O chão usa a âncora fornecida (1160/1254), não a borda inferior do canvas. Uma pose totalmente fora da borda precede a reentrada. Movimento reduzido inicia no quadro 01, já visível; pausa congela a pose e a posição atuais.

A2 autoriza WebP lossless exact: 492982 bytes, zero diferenças RGBA frente ao PNG de 1124099 bytes. Prepare-conversion-assets.mjs reproduz o derivado; este script valida o hash RGBA. O QA mede a meta de 500 KB separadamente; a aprovação visual é do responsável.
