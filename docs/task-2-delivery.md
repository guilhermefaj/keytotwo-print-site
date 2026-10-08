# Tarefa 2 — entrega da Aquarela para Claude Code

Hero pronta para QA independente em `feat/hero-kito`, com Kito ESTÁTICO apoiado no chão. Sem commit ou push. `.gitignore`, `.maestri` e o vault não foram editados. O servidor do terminal Servidor permanece ativo em 127.0.0.1:5173.

## Implementação e execução

Principais arquivos: `src/App.tsx`, `src/styles.css`, `src/components/HeroScene.tsx`, `src/components/PreviewPanel.tsx`, `src/components/ui/sheet.tsx`, `src/main.tsx`, `vite.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `scripts/prepare-hero-assets.mjs`, `scripts/verify-hero.mjs` e `scripts/inspect-sprite.mjs`.

Documentação em README e docs: inventário e manifesto dos assets, decisões de implementação, revisão da caminhada, aviso de licença do shadcn e este relatório.

Para instalar: `npm ci`. Para desenvolver: `npm run dev`. Abrir http://127.0.0.1:5173/preview/hero. A raiz também exibe o protótipo para o portal. Vite usa host 127.0.0.1, porta 5173 e strictPort. Não iniciar outro dev sobre o terminal Servidor. Produção: `npm run build` e `npm run preview`, porta 4173 estrita.

Decisões: header opaco, copy exata do briefing, tokens ainda propostos, Bricolage Grotesque 700 e DM Sans 400/600 auto-hospedadas. Menu mobile com Sheet shadcn/Radix; painéis com dialog nativo. Ações identificadas como demonstração. Como funciona, Entrar, jogo gratuito e blog omitidos por falta de destino. Sem href vazio, preço inventado, checkout ou conteúdo comercial final.

## Arte e peso

Somente quatro originais copiados para `art-source/hero`, sem serem servidos. SHA-256 das quatro cópias comparado ao vault: todos iguais. Origem: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Marca/Pixel Art`.

| Original | Bytes |
| --- | ---: |
| kito.png | 627677 |
| keytotwo_logo.png | 953418 |
| nuvens_2.png | 560255 |
| paisagem_direita.png | 723643 |

`npm run assets:prepare` gera seis WebP lossless, com recorte alfa e nearest-neighbor. A vegetação esquerda usa recorte e espelhamento horizontal; a direita conserva a direção original. O piso contínuo e a silhueta distante são CSS/SVG próprios. Transformações, dimensões, pesos e hashes registrados em `docs/hero-assets.md` e `docs/hero-assets.json`.

| Derivado | Dimensões | Bytes |
| --- | --- | ---: |
| kito-static.webp | 320×316 | 65918 |
| keytotwo-logo.webp | 420×97 | 40044 |
| cloud-a.webp | 280×117 | 21996 |
| cloud-b.webp | 208×88 | 14480 |
| foliage-right.webp | 720×298 | 134618 |
| foliage-left.webp | 360×119 | 40694 |

Imagens: **317750 bytes**. Fontes WOFF2 carregadas: **50728 bytes**. Resource Timing numa página nova: **368478 bytes de corpo / 371178 bytes transferidos**, incluindo overhead HTTP observado. Abaixo de 500 KB. CSS e JS não estão nessa meta de mídia; build informou CSS 4,47 kB gzip e JS 83,96 kB gzip.

## Caminhada: tentativa e pendência

Usei a ferramenta integrada imagegen, após a hero estática, com kito.png como referência e o briefing dos oito frames. O candidato tem alfa, 2172×724 px e **720118 bytes**. Não entrega grade de oito células 128×128; a largura nem é divisível por oito. A revisão visual também não aprovou a coerência da sequência para integrar o ciclo. Inspeção com `node scripts/inspect-sprite.mjs D:/Maestri/hero-kito-qa/kito-walk-rejected.png` confirmou dimensões e limites por segmento. Não foi integrado; não fiz PNG rígido deslizar.

O candidato fica fora do repositório em `D:/Maestri/hero-kito-qa/kito-walk-rejected.png`. Prompt exato, evidências e ressalvas em `docs/kito-walk-review.md`. Pausar/Retomar, suspensão fora de vista/aba oculta e loop inteiro não foram implementados/testados: **não se aplicam à entrega estática** e permanecem pendentes da caminhada. Não há botão de pausa sem função.

## Verificações executadas

- `npm run assets:prepare`: saída 0; seis derivados e manifesto gerados, total 317750 bytes.
- `npm run build`: saída 0, TypeScript sem erros, Vite 8.3.3, 76 módulos, bundle em dist.
- `npm run lint`: saída 0, sem erros/avisos.
- `npm run typecheck`: saída 0, sem erros.
- `npm run verify:hero`: PASS no servidor de desenvolvimento. Repetido na build de produção com `HERO_URL=http://127.0.0.1:4173/preview/hero` e `HERO_QA_DIR=D:/Maestri/hero-kito-qa/production`: PASS, Chromium 156.0.8078.4.
- Matriz: 320×800, 390×844, 768×1024, 1280×720 e 1440×900, normal e texto 200%. Sem overflow horizontal e sem caixas de conteúdo cortadas. Separação entre nota e cena de pelo menos 24 px. Em 320 e 1280×720 a página cresce verticalmente (853 e 753 px respectivamente), conforme previsto. Zoom testado por multiplicação de TODOS os tamanhos computados de fonte; não foi zoom nativo manual do navegador.
- Menu e os dois painéis também verificados a 200% em 320/390: sem overflow horizontal; último controle alcançável e inteiro após rolagem.
- Teclado: Tab, Enter, Espaço, foco preso no menu, Escape e retorno de foco; ambos os destinos do menu, CTAs da hero e fechamento dos painéis passaram. Anel de foco de 3 px verificado.
- Axe com tags WCAG A/AA, 2.1 e 2.2: zero violações em cinco viewports, menu aberto e dois painéis. Isso não equivale a certificação WCAG ou teste com leitor de tela.
- Movimento reduzido e sem preferência: Kito estático conferido ao longo de 1,1 s em cada modo; document.getAnimations() igual a zero. Sem entrada animada ou scroll suave.
- Contraste computado por família, ordem normal/hover/active/focus: primário 6,45 / 8,44 / 10,75 / 6,45; secundário sobre céu 11,53 / 6,02 / 10,03 / 11,53; ícones 12,37 / 10,67 / 9,57 / 12,37; texto sobre branco 12,37 / 6,45 / 10,75 / 12,37. Todos acima de 4,5:1.
- Capturas inspecionadas visualmente em todos os tamanhos normais, desktop/mobile com texto ampliado, menu e painéis. Zero pageerrors registrados na matriz. `git diff --check`: saída 0; apenas aviso de conversão LF/CRLF do README no Windows.
- `Get-FileHash`: quatro originais copiados iguais aos do vault. `git branch --show-current`: feat/hero-kito. Nenhum commit/push executado.

## Evidências fora do versionamento

Pasta final: **D:/Maestri/hero-kito-qa/production/**.

- Desktop: `hero-1440x900.png` e `hero-1280x720.png`.
- Mobile: `hero-390x844.png` e `hero-320x800.png`.
- Tablet: `hero-768x1024.png`.
- Texto ampliado: os mesmos nomes com sufixo `-text200.png`.
- Interações: `menu-mobile.png`, `panel-games-mobile.png`, `panel-package-mobile.png`, além de `menu-320-text200.png`, `games-320-text200.png`, `package-320-text200.png` e equivalentes em 390.
- Resultado estruturado: `report.json`.

Pendências: QA independente da Lupa, aprovação da direção visual/copy e integração pelo Costura; caminhada aprovada; composição e oferta finais, arquivos, preço e destinos públicos. Não foram testados Safari, Firefox nem leitor de tela. A entrega mínima estática está concluída; a caminhada não é declarada concluída.
