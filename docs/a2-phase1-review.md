# A2 — fase 1 e revisão sênior da A1

2026-10-08, floor Redesign, sem commit. Nota Crítica de design lida por inteiro.

## Assets

- `node scripts/prepare-conversion-assets.mjs`: exit 0 em duas execuções; manifesto e hashes de todos os derivados idênticos entre elas. Fontes externas também conferidas antes/depois, sem alteração.
- Atlas WebP 2304 × 768, **492.982 bytes**, contra 1.124.099 do PNG: **56,1% menor**, com **zero bytes RGBA diferentes**, incluindo RGB totalmente transparente. Sem mudança de escala, corpo, pés ou quadros.
- Kito tabuleiro 240/480 px: 44.750 / 138.918 bytes; Kito hi 128/256 px: 10.382 / 33.164 bytes. Canvas completo, nearest-neighbor, WebP lossless.
- PDF real do J001, localizado pela ficha: páginas 1, 2 e 3, 720 × 1019, respectivamente 59.576, 13.834 e 14.420 bytes. As três somam **87.830 bytes**. Nenhuma capa fictícia, jogo adicional ou geração de imagem.
- Origens, processos, hashes e opções em [conversion-assets.md](conversion-assets.md) e [conversion-assets.json](conversion-assets.json). Uso do PDF como prévia, não como arquivo público de impressão.
- Inspeção visual: originais, três renders do PDF, primeira página WebP e prancha dos Kitos sobre o céu da marca. Prancha fora do versionamento: `D:/Maestri/qa/keytotwo-a2/assets/kito-derivatives-review.png`; renders de revisão: `j001-review-1.png` a `3.png` na mesma pasta.
- `npx eslint scripts/prepare-conversion-assets.mjs scripts/measure-conversion-media.mjs`: exit 0.

## Peso medido

`node scripts/measure-conversion-media.mjs`: exit 0, Chromium, sem cache nem rolagem, imagens/fontes recebidas por HTTP em 1440 × 900 e 390 × 844. Detalhes em [conversion-media.json](conversion-media.json).

| Cenário | Corpos das respostas | Transferência |
| --- | ---: | ---: |
| Home atual, PNG | 1.426.659 bytes | 1.430.259 bytes |
| Troca isolada por WebP no navegador de QA | 795.542 bytes | 799.142 bytes |

Valores iguais nos dois tamanhos. O segundo cenário altera somente a referência do atlas nas respostas HTML/CSS dentro do navegador de QA; as imagens e fontes são recebidas normalmente. **Não é integração no aplicativo.** O PNG permanece servido até a fase 2 para não quebrar a URL existente.

A meta de cerca de 500 KB **não foi atingida** só com a conversão: o atlas exato ocupa quase todo o limite. Não reduzir quadros, resolução ou qualidade sem autorização. Carregamento e composição finais serão medidos de novo na fase 2; estes números não incluem materiais reais que ainda serão integrados.

## Revisão sênior da A1 (Guache)

Parecer sobre o diff: CTAs coerentes, setas internas corrigidas e navegação da área de conta adequada. Sem regressão funcional identificada na leitura.

**Ajustes necessários encontrados e corrigidos:** quatro regras ainda abaixo de 14 px em `src/styles.css`: contador do carrinho (linha 229), Entrar mobile (279), botão de pausa (376) e métodos de login (458). Todas passaram para `.875rem`; mantidas as exceções de eyebrows em caixa alta. Correções feitas somente após o responsável liberar src e pedir revisão sênior.

Na leitura, `SiteHeader.tsx:13` ainda não incluía `/pedido/confirmacao`; o responsável informou que o Guache está finalizando essa inclusão, então não houve edição concorrente desse arquivo. A aprovação final desse ponto e o QA integrado ficam para a fase 2. Os comandos de QA informados pelo Guache não foram apresentados como execução nossa.

Fase 2: inclusão de `/pedido/confirmacao` conferida no header e aprovada; QA integrado concluído em [a2-phase2-review.md](a2-phase2-review.md).
