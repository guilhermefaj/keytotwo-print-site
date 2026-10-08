# Entrega 3B + 3C — caminhada oficial, revisão 2

2026-10-08. Aquarela, autor único, branch `feat/hero-kito`. Revisão 2 integrada, sem commit/push. O Servidor em 127.0.0.1:5173 foi preservado. O QA final abaixo usa exclusivamente os quadros corrigidos às 09:33.

## Alterações e execução

- `src/components/HeroScene.tsx`, `src/styles.css`, `src/App.tsx`: camadas CSS separadas para deslocamento e poses (`steps(4)`), pausa acessível, suspensão fora de vista, em aba oculta e com menu/painel aberto. Sem atualização React a cada quadro. Texto, CTAs e controle permanecem fora da cena decorativa.
- `scripts/prepare-walk-assets.mjs`, `scripts/prepare-hero-assets.mjs`, `src/kito-motion.ts`: preparo reproduzível, registro, hashes e parâmetros de movimento gerados a partir da revisão 2.
- `scripts/verify-hero.mjs`, `scripts/verify-tab-visibility.mjs`: matriz responsiva, teclado, contraste, movimento, loop completo e troca real de abas.
- Quatro RIGHT em `art-source/hero`; folhas em `public/media/hero`; inventários `docs/hero-assets.*`, `docs/kito-walk-assets.*`, notas e README atualizados.
- Removidos `scripts/prepare-kito-rig.mjs`, `art-source/kito-rig` e `kito-static.webp` servido. Nenhum LEFT copiado/servido. `kito.png` permanece só como referência original de identidade, fora do bundle. `.gitignore`, `.maestri` e vault preservados.

Usar o Servidor existente: **http://127.0.0.1:5173/preview/hero**. Em instalação nova: `npm ci` e `npm run dev` (127.0.0.1, porta 5173, strictPort). Preparo: `npm run assets:prepare`. Produção: `npm run build` e `npm run preview` (porta 4173). Não iniciar outro dev na mesma porta.

## Arte e pesos

Origem da caminhada: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art`. Os quatro arquivos foram recopiados; SHA-256 completo comparado entre original e cópia. O script também recusa prefixos diferentes da revisão 2:

| Quadro | SHA-256, primeiros 16 hex | Bytes |
| --- | --- | ---: |
| 01 | 8f4ff15f23801c1c | 742824 |
| 02 | 7523cc2f7b8bc453 | 747061 |
| 03 | aaf48ef989d61133 | 732143 |
| 04 | 70e7462ab067d6a3 | 740464 |

Corpo do step03 aplicado a 01/02/04 pelo responsável; step03 sem mudança. Todos 1254×1254 RGBA. Âncora do olho: variação máxima **0,0318 pixel nativo**; sem translação necessária. Amostragem no centro das células de 20 px para canvas comum 64×64, alfa binário, nearest-neighbor inteiro, sem recorte individual nem poses inventadas. Topo y6, último pixel inferior y57, chão na borda y58 nos quatro quadros. Altura visível **156 px desktop / 104 px mobile**.

| Derivado servido | Dimensões | Bytes |
| --- | --- | ---: |
| kito-walk-3x.webp | 768×192, quatro células | 15078 |
| kito-walk-2x.webp | 512×128, quatro células | 13322 |
| keytotwo-logo.webp | 420×97 | 40044 |
| cloud-a.webp | 280×117 | 21996 |
| cloud-b.webp | 208×88 | 14480 |
| foliage-right.webp | 720×298 | 134618 |
| foliage-left.webp | 360×119 | 40694 |

Todos WebP lossless. Logo, nuvens e paisagem mantêm as fontes anteriores do vault de marca. Total em disco **280232 bytes**, incluindo ambas as folhas; o navegador carrega uma escala por viewport. Fontes WOFF2 efetivas: Bricolage 700, 22384 bytes; DM Sans 400, 14200; DM Sans 600, 14144. Manifestos completos: [hero-assets](hero-assets.json), [caminhada](kito-walk-assets.json).

## Ordem, fps e velocidade

**01 → 02 → 03 → 04**, **8 fps**, 125 ms por pose, ciclo de **0,5 s**. Quatro poses oficiais em perfil substituem os 6–8 quadros em três quartos do briefing inicial, conforme a nova instrução. Nenhuma interpolação.

Medição da sola: centro x da última linha de pixels quentes do pé plano, na grade nativa. Valores: 01=21; 02=44; 03=20; 04=39,333333. Recuos 01→03 = 1 px e 02→04 = 4,666667 px; média **2,833333 px em 2/8 = 0,25 s**.

- Desktop: `2,833333 × 3 / 0,25 = 34 px/s`.
- Celular: `2,833333 × 2 / 0,25 = 22,666667 px/s`.

A revisão 2 mudou a medida; a calibração anterior foi descartada. Velocidades abaixo das faixas desejadas de 40–56/24–32 px/s, seguindo a prioridade autorizada para acompanhar a passada. A aplicação consome os parâmetros gerados em `src/kito-motion.ts`.

**Limitação:** as solas mudam de forma e têm recuos diferentes. A velocidade uniforme é um ajuste médio, com resíduo entre as amostras de apoio de ±5,5 px desktop / ±3,67 px mobile. Não se afirma deslizamento zero. Não foram alterados os pés oficiais para compensar; a leitura da passada precisa de QA visual independente.

O offset inicial é metade do percurso, já visível. Loop apenas depois de a célula inteira sair à direita, reentrando pela esquerda. Pausa e movimento reduzido usam a própria folha: pausa congela a pose atual; reduced-motion inicia centralizado no quadro 01 e exige ação explícita. Retorno à vista/aba não desfaz pausa manual.

## Verificações executadas

Produção em `http://127.0.0.1:4173/preview/hero`, Chromium **156.0.8078.4**. Comando completo:

```powershell
$env:HERO_URL = 'http://127.0.0.1:4173/preview/hero'
$env:HERO_QA_DIR = 'D:/Maestri/hero-kito-qa/task-3c-revision-2'
npm run verify:hero
```

| Verificação | Resultado real |
| --- | --- |
| `npm run assets:prepare` | Exit 0; hashes/registro válidos. Regeneração seguida de comparação SHA-256: 13 derivados idênticos. |
| `npm run lint` | Exit 0, sem ocorrências. |
| `npm run typecheck` | Exit 0, sem erros. |
| `npm run build` | Exit 0; 77 módulos. JS 268,68 KB / gzip 84,65 KB; CSS 18,05 KB / gzip 4,94 KB. |
| `npm run verify:hero` | Exit 0, relatório PASS, zero erros de execução capturados na matriz. |
| Responsividade | 320×800, 390×844, 768×1024, 1280×720, 1440×900; todos a 100%/200% de texto. Dez layouts sem overflow horizontal, caixas textuais cortadas ou cabeça cortada; pés alinhados ao chão, delta 0. |
| Texto ampliado | Duplicação de todos os tamanhos computados de fonte. Menu/painéis também em 320/390; controle final alcançável por rolagem. Não foi zoom nativo do navegador. |
| Teclado | Menu: Tab/Enter, foco contido, Escape/retorno. CTAs/painéis: Enter/Space e retorno. Pausa: Tab, contorno de foco 3 px, Enter pausa e Space retoma nas duas escalas. |
| Axe | Zero violações nos oito estados verificados: cinco viewports, menu e dois painéis. |
| Contraste | Normal/hover/active/focus de cinco famílias, 20 amostras, todas ≥4,5:1. Mínimo geral 6,02:1. Pausa: 11,53 / 10,67 / 9,57 / 11,53:1. |
| Pausa/fora de vista | Duas animações congeladas juntas; retomada verificada. Rolagem real suspende/retoma; pausa manual preservada. |
| Movimento reduzido | Inicia imóvel no quadro 01 da mesma folha; Enter permite andar; mudança posterior para reduce volta a pausar. |
| Aba oculta | Troca real de abas em Chromium headless isolado via CDP, sem sobrescrever visibilityState nem evento sintético. Suspensão/retorno e preservação de pausa manual passaram. |
| Loop desktop | 48,208 s observados, período 48 s, 2894 amostras, velocidade medida 34,005 px/s. |
| Loop mobile | 23,054 s observados, período 22,853 s, 1385 amostras, velocidade medida 22,679 px/s. |
| Bordas/poses | Offset inicial visível; quatro posições da folha em ambas as escalas; wrap com célula fora à direita e reentrada pela esquerda. |
| Mídia HTTP | Desktop **320338 bytes**, mobile **318582 bytes transferidos**, seis imagens + três WOFF2. Corpos: 317638 / 315882 bytes. Uma folha por viewport; nenhum static/LEFT carregado. JS/CSS fora desta meta de mídia. |
| Dev preservado | SHA-256 das duas folhas servidas em 5173 = arquivos públicos = build testado. |

A primeira rodada, ainda com revisão 1, expôs uma corrida no teste que alternava preferências de movimento antes de o evento chegar. O teste agora aguarda dois frames entre alterações. A rodada completa da revisão 2 passou. A página cresce verticalmente quando necessário; 320 px e 1280×720 podem exigir rolagem vertical.

## Capturas e arte de revisão

**Fora do versionamento:** `D:/Maestri/hero-kito-qa/task-3c-revision-2/` contém 19 PNGs e `report.json`. Log: `D:/Maestri/hero-kito-qa/task-3c-verify.log`.

- Desktop: `hero-1440x900.png`, `hero-1280x720.png`.
- Mobile: `hero-390x844.png`, `hero-320x800.png`.
- Tablet: `hero-768x1024.png`.
- Cada tamanho tem versão `-text200.png`; há também menu/painéis em 320/390.

As capturas da matriz usam movimento reduzido para composição estável; movimento foi verificado separadamente em tempo real. Desktop, tablet, mobile e 320 com texto ampliado foram inspecionados visualmente.

Arte de revisão reproduzível em `art-source/hero/walk-review`, não servida: `official-contact-sheet.png` (768×224; 24467 bytes); `step01-3x.png` até `step04-3x.png` (192×192; 5174/5289/5217/5005 bytes); `official-walk-preview.webp` (192×192, quatro poses a 8 fps; 15746 bytes).

Pendências: QA visual independente da passada e integração pelo Costura. Safari/Firefox, leitor de tela e zoom nativo não testados. Oferta final P001, preço, arquivos, condições e destinos comerciais continuam pendentes no protótipo. Rascunhos antigos fora do repositório não participam da entrega.
