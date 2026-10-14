# Revisão da fatia 3 — hero, e dos ajustes das fatias 1 e 2 (Prumo, 2026-10-10)

**Veredito: fatia 3 APROVADA COM AJUSTES.** A hero cumpre o Portão 1 e a direção B, e o plano 004 está resolvido. Os seis ajustes obrigatórios das fatias 1 e 2 estão resolvidos. Faltam três coisas: capturas "depois" que não correspondem ao commit, a linha de recorte sob o chão da hero e o filtro de console do `verify:hero`.

| | |
| --- | --- |
| Commits revisados | `3979931` (ajustes das fatias 1 e 2) e `7a5e926` (hero) |
| Antes | http://127.0.0.1:5178 |
| Depois | **Build da 4174.** O 5180 não serviu de base estável: durante a revisão o Nanquim começou a fatia 4 no mesmo checkout (`GameCover`, `ExperienceSections`, `PackageGames`, `ProductPreview`, `experience.ts`), e o recarregamento derrubou a home no meio do `verify:hero` ("Não foi possível abrir esta página"; `TypeError` em `ExperienceSections`). O build da 4174 é de 19:45 e contém as regras dos dois commits: conferi no CSS servido `footer-brand .brand img`, `hero-secondary`, `d1-link var(--duration-ui)`, `site-footer-rule` e `text-display-mobile` |
| (a) Ajustes das fatias 1 e 2 | **6 de 6 RESOLVIDOS** |
| (b) Hero, critérios F3 | **RESOLVIDO 9 · PARCIAL 1 · ABERTO 1** |
| (c) Caminhada e plano 004 | **RESOLVIDO**; `verify:hero` passa no build; nenhuma regra da caminhada foi afrouxada; um filtro de console ficou largo demais (ajuste 3) |
| (d) Logo do rodapé | **178×41 px** de 768 a 1440 e **150×35 px** a 375, no 5180 e na 4174. A captura `depois/home-1280.webp` é anterior à correção e mostra o logo com cerca de **420 px** (ajuste 1) |

## Ajustes obrigatórios

1. **Capturas da fatia 3 desatualizadas.** As quatro capturas de `design-review/fatias/3-hero/depois/` foram geradas às 19:25 (`verificacao.json`: `22:24:58Z`), antes do commit de ajustes (19:51). Por isso o rodapé delas ainda tem o logo quebrado: medi de x = 70 a x ≈ 490 px na captura de 1280, ou seja, cerca de 420 px. Era o que o orquestrador viu. O código commitado está certo (178 px).
   - **Correção:** refazer as capturas a partir do commit e registrar o hash servido (critério G9).
   - **Evidência:** [`fatia-3/captura-depois-home-1280-rodape-desatualizada.webp`](fatia-3/captura-depois-home-1280-rodape-desatualizada.webp).
2. **Linha de recorte sob o chão da hero (F3.8) ausente.** `main .cut-line` = 0 em todas as larguras, e a hero passa direto para a seção da prévia. A tesoura logo abaixo do chão é a ponte hero → papel da direção B ("a tesoura logo abaixo do chão faz essa ponte"). Aceito que entre na fatia 4, junto da primeira folha, mas tem de entrar: transferi o critério para F4.16.
3. **`verify:hero`: filtro de console largo demais.** O script passou a descartar qualquer erro de console que contenha `caret-color` (linhas 89–91), descrito como aviso de hidratação causado pela captura do Playwright. É um afrouxamento: um erro real de hidratação cujo diff mencione `caret-color` também some.
   - **Teste:** rodei uma cópia sem o filtro contra o build (4174). Rotas, janelas, axe, teclado e contraste passaram com **zero** erros de console. Ela só parou depois, por tempo esgotado ao carregar a 4174, que ficou lenta; a versão com filtro tinha passado inteira.
   - **Conclusão:** no build, que é o alvo oficial, o filtro não é necessário.
   - **Correção:** remover o filtro, ou limitá-lo a execuções contra o dev e à mensagem exata de hidratação, nunca a qualquer erro que contenha a palavra. Uma alternativa é fazer as capturas com `caret: 'initial'` depois da hidratação.

## (a) Ajustes das fatias 1 e 2

| Ajuste | Status | Evidência |
| --- | --- | --- |
| F1: logo do rodapé | RESOLVIDO | `.footer-brand .brand img { width: 178px }`, com 150 px abaixo de 768. Medido 178×41 a 1440, 1280 e 768 e 150×35 a 375, no 5180 e na 4174, em `/`, `/ajuda`, `/termos` e nas rotas privadas |
| F1: capturas com dados reais | RESOLVIDO | As capturas da fatia 1 refeitas em `3979931` mostram a biblioteca com os 5 jogos e o carrinho vazio real, sem os estados de 403 |
| F1: escala tipográfica | RESOLVIDO | Nenhum `font-size` literal no CSS, exceto `.875em` do `code` no blog (relativo, aceitável). O DESIGN.md ganhou `display-mobile`, `display-xs`, `headline-sm`, `title-lg`, `small` e `micro`, cada um com uso descrito. Observação: o `micro` (11 px) ficou registrado como decisão do DS para o selo "No pacote", a contagem do carrinho e as etapas da compra no celular; atualizei a F5.10 para cobrar só o que estiver fora desses usos |
| F2: menu móvel (A003a) | RESOLVIDO | Build: links em **0,24 s**, com atrasos de 0,04, 0,08 e 0,12 s; o keyframe `d1-link` parte de `translate(8px)` |
| F2: linha de recorte fora das páginas privadas | RESOLVIDO | `data-public` no rodapé. Com `CutLine` (público): `/`, `/ajuda`, `/blog` e o 404. Com régua de 1 px em Tinta a 18 % (`.site-footer-rule`): `/entrar`, `/carrinho`, `/pagamento`, `/meus-jogos`, `/pedidos` e `/conta` |
| F2: gaveta vazia | RESOLVIDO | "Quero o pacote" → `/#comprar` (`CartDrawer.tsx:42`) |

## (b) Hero contra o Portão 1, a direção B e o checklist F3

Medidas no build da 4174 em 1440×900, 1366×768, 1280×720, 1280×800, 768×1024, 390×844, 375×812 e 320×640, comparadas com o 5178. Capturas: [`fatia-3/hero-1280x720-antes-depois.webp`](fatia-3/hero-1280x720-antes-depois.webp), [`fatia-3/hero-375-antes-depois.webp`](fatia-3/hero-375-antes-depois.webp), [`fatia-3/hero-1440x900-depois.webp`](fatia-3/hero-1440x900-depois.webp).

| Critério | Status | Evidência |
| --- | --- | --- |
| F3.1 Vende a marca, não o produto | RESOLVIDO | Headline e apoio sem mudança ("A rotina pode esperar. Vocês têm um encontro." e "Jogos para imprimir, puxar uma cadeira e descobrir o quanto vocês se divertem juntos."). Nenhum "5 jogos" ou "pacote com" no texto da hero, em todas as larguras |
| F3.2 Sem ✓ e sem caixa alta; etiqueta | RESOLVIDO | A lista de ✓ saiu (antes, 3 itens com ícone). A etiqueta virou `.tag` "KeyToTwo · jogos para casais", com `text-transform: none`, borda de 2 px tracejada `#1BB8C4` e contraste de 12,37:1 (antes, caixa alta com tracking, 6,02:1) |
| F3.3 Texto à esquerda; marca-texto | RESOLVIDO | O H1 está alinhado à esquerda, na mesma coluna do conteúdo (x = 70 px a 1280, igual a `.content-width`), em 2 linhas no desktop e no tablet e 4 linhas até 390 px. Há **um** `mark` na página inteira, em "encontro.", com Tinta sobre Marca-texto a 7,24:1. A segunda linha deixou de ser Turquesa, então o marca-texto é a única ênfase |
| F3.4 "Quero o pacote" + "Ver a prévia" | RESOLVIDO | O CTA "Quero o pacote" → `/#comprar`, com raio de 6 px e 6,45:1. O link "Ver a prévia" → `/#experiencia`, em Turquesa profundo sobre Céu a 6,02:1, com alvo de 46 px. No `verify:hero`, Enter no CTA chega a `#comprar` e Enter no link chega a `#experiencia` |
| F3.5 Coreografia e `verify:hero` | RESOLVIDO | **PASS no build:** pés no chão a 0,014 px (limite 0,1), folga da cena ≥ 44 px (limite 20) nas 10 janelas, axe sem violações em 8 estados. **Loop completo em 1440 e 390 px:** velocidade medida de 66,11 px/s contra 66,35 px/s esperados (44,28 contra 44,23 no celular); volta só fora da tela; nenhum deslocamento com pose retida; deriva de apoio menor que 0,001 px; fechamento 12→1; nenhuma pose pulada. **Movimento reduzido:** começa parado na pose 01, Enter retoma e voltar ao modo reduzido pausa de novo |
| F3.6 Plano 004: sem teleporte no resize | RESOLVIDO | Posição do Kito antes e 60–80 ms depois de cada mudança, descontado o avanço normal: ver a tabela "Plano 004" abaixo |
| F3.7 Texto legível no primeiro paint | RESOLVIDO | A hero não é `.page-section`, então não recebe `data-reveal` |
| F3.8 Linha de recorte sob o chão | ABERTO → F4.16 | Ajuste 2 |
| F3.9 Primeira dobra | RESOLVIDO | H1, apoio, CTA, link, Kito e chão visíveis em 1440×900, 1366×768, 1280×720, 1280×800, 768×1024, 390×844 e 375×812. **Antes, o Kito e o chão ficavam cortados a 1280×720 e a 1366×768.** Só a 320×640 o Kito fica abaixo da dobra, como antes |
| F3.10 Mídia medida e informada | PARCIAL | 976 KB transferidos na carga da home (1440 e 390), incluindo o atlas de 482 KB. O total inclui também imagens fora da hero (`j001-page-1-720` com 58 KB e `kito-tabuleiro-240` com 44 KB), então só a hero fica por volta de 780 KB. A meta de 500 KB não é atingida. O limite do script (transferência − atlas < 750 KB) continua o mesmo. **Falta registrar a exceção do atlas na base:** decisão do responsável (P2-8) |
| F3.11 Paleta da cena confinada | RESOLVIDO | Cores computadas em `.hero-copy`: Tinta, Papel, Turquesa J001 (só a borda da etiqueta) e Turquesa profundo (CTA e link), mais o Marca-texto no `mark`. axe sem violações em `.hero` |

### Plano 004: medida do resize

Velocidade de 66,35 px/s a 192 px. "Salto" é o deslocamento menos o avanço normal no intervalo; um passo vale cerca de 6,6 px.

| Mudança | Antes (5178) | Depois (4174) |
| --- | --- | --- |
| Largura 1280 → 900 | salto de **−158 px** | salto de **+2 px**; a pose avançou um quadro, em par com a posição |
| Altura 800 → 620 | +2 px | +2 px |
| Largura 900 → 1280 | salto de **+161 px** | salto de **−5 px**; mesma pose |
| Altura 620 → 800 | +1 px | +1 px |
| Largura 1280 → 1100 | salto de **−78 px** | salto de **−5 px**; mesma pose |
| Largura 1100 → 700 (passa para celular, sprite 192 → 128) | x 903 → 606 | x 969 → 704. O Kito estava além da nova borda direita (969 > 700); o código o leva ao último tique da nova pista, fora da tela, e não para dentro da área visível. Correto |

## (c) Regras da caminhada e o `verify:hero` atualizado

Comparei o `scripts/verify-hero.mjs` de `67c66c5` com o de `7a5e926`.

- **Intocadas, ou seja, nenhuma regra afrouxada:**
  - Limites de geometria: `sceneClearance ≥ 20`, `spriteTopClearance ≥ 0`, `|footGroundDelta| ≤ 0,1`.
  - Todas as asserções do loop: volta com `before.x ≥ width` e `after.right ≤ 0,1`; velocidade `toBeCloseTo`; as 12 poses; `maxClockDelta < 0,1`; `maxHeldPoseTravel < 0,02`; `maxSupportDrift < 0,02`; `closes12to1`; `skippedPoses = 0`.
  - Pausa fora de vista e pausa manual preservada; movimento reduzido.
  - Mídia: um atlas só, sem assets antigos, hash do atlas e limite de 750 KB além do atlas.
- **Atualizadas para a interface nova, sem perda de rigor:**
  - Ordem de Tab (o "Entrar" saiu do cabeçalho móvel na D1).
  - Nome do diálogo; itens do menu ("Como funciona" e "Quero o pacote").
  - O "secundário" agora é o link da hero, e o Tab até "Pausar animação" sai dele.
  - Espera o menu habilitar antes do Tab.
  - Grava a medida do loop antes das asserções (só acrescenta evidência).
- **Mudanças de método, aceitáveis:**
  - O axe espera as animações finitas terminarem. As animações infinitas, como a caminhada, não entram na espera. Assim os quadros intermediários do menu não são auditados, o que é razoável.
  - O contraste agora compõe fundos translúcidos, o que é mais correto. Ressalva: sem ancestral opaco, ele compõe sobre branco. Os controles do cabeçalho sobre a hero são medidos contra Papel (12,37:1) e não contra o Céu real (11,53:1); continua acima de AA, mas convém partir do fundo da hero.
- **Afrouxamento:** o filtro de `caret-color` nos erros de console (ajuste 3).

## Achados da auditoria tocados nesta rodada

| Achado | Status |
| --- | --- |
| P1-1 (parte visual que o Portão 1 aprovou) | RESOLVIDO: sem ✓, sem caixa alta, CTA unificado. O texto de produto ficou de fora por decisão do responsável |
| P1-2 Um nome por ação | PARCIAL. Hero, cabeçalho, menu, rodapé e gaveta usam "Quero o pacote". Ainda há "Escolher nosso encontro" na prévia, no fechamento e no post, e "Conhecer o pacote" no carrinho vazio, em Meus jogos e em Pedidos (fatias 4–6) |
| P2-8 Mídia da hero | PARCIAL (F3.10) |
| P2-11 / A003 Menu | RESOLVIDO (a: tempos; b: setas removidas na fatia 1) |
| A004 Resize da caminhada | RESOLVIDO |

## Recomendações (P2)

- **Viúva no apoio:** a 375 px, "juntos." fica sozinho na última linha do apoio. Aplicar `text-wrap: pretty` em `.hero-description`.
- **Fundo do contraste no `verify:hero`:** partir do fundo da hero, e não do branco, ao compor (ver c).
- **Erros de console no dev, em `/conta`:** "Encountered a script tag while rendering React component" e o `TypeError` da fatia 4 em andamento. Não pertencem à fatia 3; conferir quando a fatia 4 fechar.

## Ambiente e método

- **Medição:** Playwright com axe. Medi estilos computados, contraste, dobra, linhas do H1, contagem de `mark` e cores da hero em 8 janelas, além do resize com posição e pose do Kito, no 5178 e na 4174. Rodei o `verify:hero` do repositório na 4174 e no 5180, mais uma cópia sem o filtro de console, no meu scratchpad, contra a 4174. Os artefatos ficaram fora do repositório.
- **Segurança:** escritas na API bloqueadas; nada pago.
- **Sem e2e:** não rodei o e2e, que exige build no checkout compartilhado.
