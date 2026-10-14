⚠️ DEGRADED: single-context (critique em contexto único por regra da equipe; avaliação A feita antes de ler o detector, sem subagentes)

# Auditoria de design — site KeyToTwo (2026-10)

- **Auditor:** Prumo · **Data:** 2026-10-10 · **Site:** http://127.0.0.1:5178/ (stage `test`) · **Código:** branch `design/refacao-2026-10`, commit `dacf7cd`
- **Escopo coberto:** `/`, `/ajuda`, `/entrar`, `/carrinho`, `/pagamento`, `/pedido/confirmacao`, `/meus-jogos`, `/pedidos`, `/conta`, `/blog`, `/blog/exemplo-como-publicar`, `/jogo-gratuito`, `/email/preferencias`, `/termos`, `/privacidade`, `/reembolsos` (→ `/termos#reembolso`) e uma URL inexistente; larguras 375, 768, 1280 e 1440; logado como a conta de teste. Nada foi pago.
- **Método:** Playwright do projeto (capturas, foco por Tab, `prefers-reduced-motion`, estados simulados interceptando a API no navegador, sem escrita no banco), axe-core (WCAG 2.2 AA) a 1280 px em todas as rotas, detector `impeccable detect` (código e URL), leitura do código e da base de conhecimento. Skills: impeccable `critique` + `audit`, design-critique, improve-animations, frontend-design. Detalhes em [Notas de execução](#anexo-e--notas-de-execução).
- **Escala de severidade deste relatório:** **P0** = bloqueia o lançamento público (quebra uma regra registrada da base ou impede a tarefa); **P1** = corrigir antes do lançamento (confusão, perda de confiança, falha de consistência visível); **P2** = próximo passe. Pela escala estrita da impeccable ("impede a tarefa"), nenhum achado seria P0: o fluxo de compra funciona.

---

## 1. Resumo

1. **Diagnóstico: REFINAMENTO.** A identidade funciona onde ela existe — a hero com o Kito caminhando no cenário pixel art é o melhor trecho do site, cumpre o prompt da hero e é decisão de marca registrada.
2. O problema começa logo abaixo da dobra: o mundo do Kito desaparece e a página vira um template de landing (11 rótulos em caixa alta, três seções seguidas de "título centralizado + três colunas", pílulas com seta, lista de ✓).
3. **2 P0:** depoimentos-fantasma ("Espaço reservado") publicados na página de venda; e a arte do Kito usada como "capa" de jogos ainda indefinidos (Boardgame aparece como Kito sobre um tabuleiro).
4. **10 P1**, com destaque para: a primeira dobra não diz "5 jogos" nem "pacote"; cinco rótulos diferentes para a mesma ação de compra; reveal que apaga seções inteiras ao rolar; preço indisponível tipografado como se fosse o preço; botões "Tentar novamente" sem estilo; conflitos de cascata que mudam a home depois de visitar o carrinho.
5. **11 P2** de acabamento, tokens e movimento.
6. Acessibilidade está boa: axe sem violações nas 17 rotas, contraste de texto ≥ 4,95:1, foco visível, drawer e menu prendem e devolvem o foco, movimento reduzido começa pausado.
7. Notas: critique 26/40 (Aceitável) e audit 13/20 (Aceitável). O teto baixo vem de consistência, estética e recuperação de erro, não de função.
8. Duas direções propostas: **A "Fase contínua"** (refinamento: o chão do Kito vira a régua da página) e **B "Folha de recorte"** (redesign abaixo da hero: a página vira a folha impressa do jogo). Recomendo A.
9. `Marca/Site - Direção visual.md` **não existe** na base (nem o inventário da hero e a nota da animação v3). Nada aqui supõe o conteúdo dessas notas.
10. Mudanças de copy, preço, promessa ou navegação abaixo são **propostas** para o responsável aprovar.

## 2. O que preservar

| O quê | Por quê | Evidência |
| --- | --- | --- |
| **Hero com o Kito caminhando** (céu, faixa de paisagem, chão até as bordas, um único personagem, pausa acessível) | Decisão registrada (`02-Decisões e pendências.md`, "A hero terá direção de Kito andando em cenário pixel art, com poucos elementos"). É o elemento mais memorável e específico do site. A implementação respeita as regras de coreografia do prompt: duas camadas, 12 poses, 10 FPS, deslocamento por passada, volta fora da tela, pausa fora de vista/aba oculta/menu aberto | `capturas/home-1280-hero.webp`, `home-768-hero.webp`, `home-1440-hero.webp`, `home-375-hero.webp`; `src/components/HeroScene.tsx:19-89`; `src/styles.css:58-94` |
| **Movimento reduzido de verdade** | Começa pausado, com "Retomar animação"; reveal e entradas desligados; carrossel instantâneo | `capturas/home-375-movimento-reduzido.webp`; `HeroScene.tsx:22-25`; `navigation.css:135-138`; `SnapCarousel.tsx:28` |
| **Paleta de base e contraste** | Tinta `#123A3D`, Céu `#ECFAF7`, Turquesa profundo `#006970`, Damasco `#FFB866`: todos os pares de texto medidos passam AA (menor: 4,95:1) | `src/styles.css:4-13`; Anexo F |
| **Bricolage Grotesque 700 + DM Sans 400/600, só os pesos usados (50 KB)** | Combinação pedida no prompt da hero; carregamento enxuto | `src/root.tsx:9-11` |
| **Prévia real do J001** (três páginas reais em leque sobre o arco damasco) | Mostra o produto de verdade, sem capa inventada; é o que mais "vende" abaixo da hero | `capturas/home-1280-jogos-capas-kito.webp` (topo); `ProductPreview.tsx:1-9` |
| **Acessibilidade estrutural** | Skip link, foco de 3 px com afastamento, drawer/menu Radix com Escape e retorno de foco, rótulos de carrinho com contagem, alvos ≥ 44 px | `capturas/home-1280-foco-navbar.webp`, `menu-375-aberto.webp`; `src/styles.css:22-25`; `ui/sheet.tsx` |
| **Área logada** (Minha área com abas, biblioteca, pedidos, conta) | Limpa, legível, menos estímulo comercial; o CTA do header muda para "Meus jogos" quando a pessoa já comprou | `capturas/conta-1280.webp`, `pedidos-375.webp`; `SiteHeader.tsx:34-35` |
| **Celebração da compra paga** | Momento raro com o Kito acenando e confete curto; uso certo do nível 3 de voz | `capturas/pedido-confirmacao-1280-pago.webp`; `purchase.css:62-67` |
| **Fluxo de compra guiado** (etapas, modo foco no pagamento, "Compra segura", voltar ao carrinho) | Reduz ansiedade no momento crítico | `capturas/pedido-confirmacao-375-falha.webp` (etapas); `SiteHeader.tsx:91` |

## 3. Problemas

Cada item traz a classificação **[MARCA]** (há decisão ou regra registrada na base; cito nota e trecho) ou **[GENÉRICO]** (padrão de mercado/heurística, sem decisão de marca envolvida). Quando um padrão genérico contraria uma regra da base, indico os dois.

### P0 — bloqueia o lançamento público

#### P0-1 · Depoimentos-fantasma na página de venda
- **Classificação:** [GENÉRICO] padrão de prova social de template, em conflito com regra **[MARCA]**: `AGENTS.md` — "Não invente preço, disponibilidade, duração, quantidade, depoimento, evidência…"; `Marketing/Site - Estrutura e taxonomia.md` (rascunho) — "Depoimentos podem complementar essa seção quando existirem relatos autênticos autorizados; a seção funciona sem eles" e critério "Não há conteúdo fictício herdado do Stitch".
- **O que acontece:** a seção "Cada dupla, uma história." mostra três cartões idênticos "Espaço reservado / Em breve, histórias de quem levou os jogos para a mesa. / Relato ainda não publicado", com linhas cinzas imitando texto. No celular vira um carrossel "1 de 3" de placeholders. Está fixo no conteúdo, não depende do ambiente: vai para produção assim.
- **Evidência:** `capturas/home-1280-historias-espaco-reservado.webp`, `capturas/home-375-historias-espaco-reservado.webp`; `src/content/experience.ts:18-29`; `src/components/sections/ExperienceSections.tsx:26-31`; `src/styles.css:409-415`. Detector: `tight-leading` ×3 nos `.placeholder-quote`.
- **Por que importa:** numa página que pede pagamento, uma vitrine vazia de depoimentos diz "ninguém comprou ainda" e parece site inacabado. O casal desconfiado (Riley) para aqui.
- **Correção proposta:** não renderizar a seção enquanto não houver ao menos um relato autorizado (`testimonials.some(t => t.quote && t.author)`); remover `.placeholder-lines`. Nenhuma copy nova. Quando houver relatos, a seção volta com o componente atual.

#### P0-2 · Arte do Kito no lugar da capa de jogos não documentados
- **Classificação:** [MARCA] — `Desenvolvimento/Prompt - Hero Kito em pixel art.md`: "`kito_tabuleiro.png` não é uma foto nem uma demonstração fiel do produto"; `Marketing/Site - Estrutura e taxonomia.md`: "Não gerar capas finais fictícias para os jogos ainda indefinidos" e critério "As cinco experiências existem e correspondem à oferta anunciada".
- **O que acontece:** no carrossel da home e em Meus jogos, "Hora dos Artistas" e "Jogo 4" usam o mesmo Kito acenando; "Boardgame" e "Jogo 5" usam o Kito sobre um tabuleiro colorido. Quem lê "Boardgame" ao lado de um tabuleiro entende que aquele é o jogo. O comentário do código diz que é "arte de marca, nunca capa fictícia", mas o efeito visual é de capa.
- **Evidência:** `capturas/home-1280-jogos-capas-kito.webp`, `capturas/meus-jogos-1280-capas.webp`; `src/components/account/GameCover.tsx:4-11`; `src/components/sections/PackageGames.tsx:10`.
- **Por que importa:** representa o produto de forma que ele ainda não é, na página de compra; em Meus jogos, dois jogos diferentes têm a mesma imagem e não se distinguem.
- **Correção proposta:** capa tipográfica neutra para todo jogo sem prévia aprovada: nome do jogo em Bricolage sobre um tom da paleta, sem personagem (ver esboços das direções A e B). O J001 continua com a página real. Sem copy nova.

### P1 — corrigir antes do lançamento

#### P1-1 · A primeira dobra não diz "pacote" nem "5 jogos"
- **Classificação:** [MARCA] — critério de `Site - Estrutura e taxonomia.md`: "Na primeira tela, o visitante entende produto, quantidade de jogos, formato digital e proposta"; o prompt da hero (rascunho) previa "Jogos para casais · para imprimir", apoio "Um pacote com 5 jogos…", "Ver pacote" e "Conhecer os jogos". A copy atual diverge e não foi aprovada como substituta (o próprio arquivo diz "Redesign: proposed brand copy", `experience.ts:1`). Elementos [GENÉRICO]: lista de três ✓ ("Uma pausa para vocês" etc.) e rótulo em caixa alta com tracking (detector: `hero-eyebrow-chip`).
- **Evidência:** `capturas/home-1280-hero.webp`, `home-375-hero.webp`; `src/routes/home.tsx:29-33`; `src/content/experience.ts:4-7`; `src/styles.css:367,370-372`. A frase do prompt já existe no código e não é usada: `src/content/site.ts:10` (`heroDescription`).
- **Por que importa:** a hero é bonita, mas vende "um encontro", não o produto. Jordan (primeira visita) só descobre que são cinco jogos a ~1 600 px e quanto custa a ~4 300 px.
- **Correção proposta (aprovação do responsável):** usar `site.heroDescription` como apoio ("Um pacote com 5 jogos para imprimir, preparar e jogar juntos em casa. O Kito traz a ideia. Vocês fazem a noite acontecer."), trocar o CTA para o vocabulário da base ("Ver pacote" ou "Quero o pacote", que já existe no header) e acrescentar um link secundário para a prévia. Remover a lista de ✓ e a caixa alta do rótulo.

#### P1-2 · Cinco nomes para a mesma ação de compra
- **Classificação:** [MARCA] — `Site - Estrutura e taxonomia.md`, Taxonomia: "Pacote … Uso na interface: Ver pacote; Comprar pacote" e "Usar 'pacote' de forma consistente". [GENÉRICO] — uma ação mantém o mesmo nome em todo o fluxo.
- **O que acontece:** "Quero o pacote" (header), "Escolher nosso encontro" (hero, prévia, fechamento e rodapé), "Adicionar ao carrinho" (oferta e barra móvel), "Conhecer o pacote" (drawer vazio), "Conhecer o pacote de jogos" (blog). O item de navegação "O pacote" leva à prévia (`/#experiencia`), não à oferta.
- **Evidência:** `src/components/layout/SiteHeader.tsx:35`; `src/content/experience.ts:7`; `src/components/sections/ExperienceSections.tsx:15`; `ClosingCta.tsx:2`; `SiteFooter.tsx:12`; `CartDrawer.tsx:42`; `src/content/site.ts:3`; capturas `home-1280-hero.webp`, `home-1280-oferta.webp`.
- **Correção proposta (aprovação):** um rótulo de navegação para a oferta (ex.: "Ver pacote") e um transacional ("Adicionar ao carrinho"). Avaliar com o responsável se "O pacote" no menu deve apontar para `/#comprar` ou se o item deveria ser "Os 5 jogos" → seção de jogos, como na estrutura.

#### P1-3 · Abaixo da hero, a página vira template
- **Classificação:** [GENÉRICO] — lista de sinais da frontend-design ("structure is information": rótulos, numeração e divisores precisam codificar algo verdadeiro). Em conflito leve com [MARCA]: `60-Personalidade e Tom de Voz.md`, checklist — "Uma marca genérica de relacionamento poderia dizer exatamente a mesma coisa?".
- **O que acontece:** 11 rótulos em caixa alta com tracking acima de títulos (detector: `kicker-above-heading` ×8 + `hero-eyebrow-chip`); três seções seguidas com o mesmo esqueleto "rótulo + título centralizado + três colunas" (Como funciona, Pilares, Histórias); botões em pílula com "→" (8 na home); a seção "Estar ali. De verdade." repete a promessa da hero sem informação de produto. O cenário pixel art some depois do chão da hero e só volta como sprites usados de ícone.
- **Evidência:** `capturas/home-1280-grades-3-colunas.webp`, `home-1280-pagina-inteira.webp`, `home-375-pagina-inteira.webp`; `src/styles.css:358,367,380-392`; `HowItWorks.tsx:5-6`; `ExperienceSections.tsx:22-24`.
- **Correção proposta:** escolher uma das direções da seção 5. Em qualquer delas: tirar os rótulos que não informam nada, alinhar títulos à esquerda, dar a cada seção um objeto dominante diferente (páginas reais, preço, passos), fundir ou retirar "Pilares". "Como funciona" pode manter 01/02/03, que é uma sequência real.

#### P1-4 · O reveal apaga seções inteiras durante a rolagem
- **Classificação:** [GENÉRICO]. O prompt da hero ([MARCA], rascunho) só pede "texto já legível no primeiro paint" na hero; não trata as demais seções.
- **O que acontece:** a animação de entrada está aplicada às 8 `.page-section`, inclusive aos fundos. Ao rolar rápido ou pular por âncora aparecem faixas vazias ou semitransparentes (opacidade 0,72–0,90 medida 120 ms após rolar; seções puladas ficam com opacidade 0). É a observação do responsável ("faixas grandes de fundo vazio", "blocos quase transparentes").
- **Evidência:** `capturas/home-1280-reveal-meio-da-rolagem.webp`; `src/routes/home.tsx:25`; `src/lib/use-scroll-reveal.ts:4`; `src/navigation.css:93-95`.
- **Correção proposta:** plano [`animacoes/001`](animacoes/001-reveal-no-conteudo-nao-na-secao.md): revelar só `.page-section > .content-width`, 320 ms, 8 px.

#### P1-5 · "Preço indisponível" aparece tipografado como preço
- **Classificação:** [MARCA] — `60-Personalidade e Tom de Voz.md`: nível 1 (neutro amigável) para "checkout, suporte, instruções críticas, pagamento… mensagens de erro importantes". [GENÉRICO] — mensagem de erro clara, junto da causa, com uma saída.
- **O que acontece:** se o catálogo falha, "Não conseguimos carregar o preço." ocupa o lugar do preço em Bricolage 34 px; abaixo, botão desabilitado, uma segunda mensagem genérica ("Não foi possível carregar ou salvar os dados. Tente novamente.") e "Consultar novamente".
- **Evidência:** `capturas/home-1280-preco-indisponivel.webp`, `home-375-preco-indisponivel.webp` (falha simulada no navegador); `src/components/sections/OfferSection.tsx:22`; `src/styles.css:425`; `src/components/sections/ProductPurchaseAction.tsx:22`.
- **Correção proposta:** manter o espaço do preço com um texto pequeno e neutro (estilo de corpo, não de display); uma única mensagem com o botão de nova tentativa como botão secundário real. Copy final para aprovação.

#### P1-6 · Botões de nova tentativa sem estilo (`.button-secondary` não existe)
- **Classificação:** [GENÉRICO].
- **O que acontece:** `.button-secondary` é usada em 8 pontos (retry do drawer, carrinho, conta, confirmação, cupom, falha do Stripe) e não tem regra CSS. O botão herda `.button` puro: sem fundo, sem borda. "Tentar novamente" parece texto solto exatamente no momento de erro.
- **Evidência:** `capturas/drawer-375-erro.webp` (falha simulada); `src/components/layout/CartDrawer.tsx:34`; `grep -rn "button-secondary" src` sem ocorrência em CSS. Achado também no mapa do Nanquim; conferido aqui.
- **Correção proposta:** definir `.button-secondary` (fundo Papel, borda 1,5 px Tinta, mesmo raio e altura do primário; hover Céu) e conferir os 8 usos.

#### P1-7 · Conflitos de cascata que mudam telas sem ninguém editar
- **Classificação:** [GENÉRICO] (integridade de implementação).
- **O que acontece:**
  - **Passos da home mudam depois do carrinho:** `.step-number` existe em `styles.css` (Como funciona, 38 px) e em `purchase.css` (etapas do checkout, 28 px). `purchase.css` só carrega ao visitar `/carrinho`; voltando à home pela navegação do site, os números de "Como funciona" encolhem para 28 px e trocam a cor da borda. Reproduzido: 38×38 → 28×28.
  - **Título da newsletter com 14 px no rodapé:** `.site-footer h2` (`styles.css:212`) vence `.newsletter h2` (`newsletter.css:2`) por ordem de carga; o título "Ideias de encontro no seu e-mail" sai menor que o próprio parágrafo.
- **Evidência:** `capturas/home-1280-passos-apos-carrinho.webp`, `capturas/home-1280-rodape-newsletter.webp`; `src/styles.css:177,385` × `src/purchase.css:5`; `src/styles.css:212` × `src/newsletter.css:2`.
- **Correção proposta:** escopar (`.checkout-steps .step-number`, `.steps-list .step-number`; `.site-footer .newsletter h2` ou `.footer-grid h2`) e, na fatia de tokens, consolidar as gerações do CSS (P2-9).

#### P1-8 · Newsletter antes do título no post do blog
- **Classificação:** [MARCA] — `Site - Estrutura e taxonomia.md`, Taxonomia do blog: "Não interromper a leitura com pop-ups de captura. Comentários, newsletter e busca podem esperar."
- **O que acontece:** o bloco de newsletter é o primeiro elemento do post, antes de "Voltar ao blog" e do título.
- **Evidência:** `capturas/blog-post-1280-newsletter-antes-do-titulo.webp`; `src/routes/blog.post.tsx:18`. A regra `.blog-post > .newsletter { margin-block: 48px }` (`newsletter.css:18`) sugere que o lugar previsto era depois do artigo.
- **Correção proposta:** mover para depois do artigo (ou retirar do post enquanto a inscrição de visitantes não existir).

#### P1-9 · Kito usado como ícone decorativo, repetido
- **Classificação:** [MARCA] — `70-Kito - Persona da Marca.md`: "Kito não é … mascote passivo"; "Se Kito estiver mais interessante do que a experiência que ele apresenta, provavelmente passou do ponto"; `02-Decisões e pendências.md`: "isso não exige sua presença em toda peça".
- **O que acontece:** só na home, o Kito aparece 8 vezes fora da hero; a mesma arte "Kito acenando" 3 vezes e "Kito com tabuleiro" 4 vezes, como ícone de pilar, capa de jogo e enfeite da prévia. A composição das páginas do J001 também se repete 3 vezes (prévia, carrossel, oferta).
- **Evidência:** `capturas/home-1280-pagina-inteira.webp`, `home-1280-grades-3-colunas.webp`, `home-1280-oferta.webp`; `ExperienceSections.tsx:6-10`; `GameCover.tsx:6-11`; `ProductPreview.tsx:6`; `OfferSection.tsx:20`.
- **Correção proposta:** o Kito aparece onde age — anfitrião na hero, celebração, estados vazios — e no máximo uma participação na página (direção A: em pé ao lado dos jogos). Retirar os ícones dos pilares; a oferta usa outro recorte ou nenhuma imagem.

#### P1-10 · No celular, preço e botão ficam ~860 px abaixo do título da oferta
- **Classificação:** [MARCA] — `Site - Estrutura e taxonomia.md`: "O preço deve ser fácil de encontrar e estar junto da ação de compra".
- **O que acontece:** em 375 px a oferta empilha rótulo, título, rótulo, "Pacote KeyToTwo", a prévia grande e o card; o preço aparece a ~860 px e o botão a ~1 140 px do início da seção. A barra fixa de compra some justamente quando a oferta está visível.
- **Evidência:** `capturas/home-375-oferta.webp`, `home-375-barra-de-compra.webp`; `OfferSection.tsx:11-21`; `src/styles.css:554-557`; `MobilePurchaseBar.tsx:25`.
- **Correção proposta:** no celular, card de preço e botão primeiro; prévia compacta depois (ou nenhuma, já que a prévia aparece duas seções acima).

### P2 — próximo passe

| # | Achado | Classe | Evidência | Correção proposta |
| --- | --- | --- | --- | --- |
| P2-1 | Numeração 01–05 nos cards de jogos, que não são sequência | [MARCA] "A ordem de apresentação indica destaque editorial, não nível, dificuldade ou sequência obrigatória" (Estrutura) | `home-1280-jogos-capas-kito.webp`; `PackageGames.tsx:10` | Remover `.game-number` |
| P2-2 | Carrossel esconde 2 dos 5 jogos no desktop; contador `aria-live` anuncia a cada rolagem | [MARCA] "cinco entradas em uma sequência fácil de comparar" (Estrutura) + [GENÉRICO] | `home-1280-jogos-capas-kito.webp`; `carousels.css:1`; `SnapCarousel.tsx:36` | Desktop: os 5 lado a lado (ver direção A/B); carrossel só ≤ 767 px; anunciar posição só após as setas |
| P2-3 | Botões em cápsula com sombra dura de 3 px e "→" em todo CTA | [MARCA] prompt da hero (rascunho): "raio moderado… Evite sombras pesadas de arcade… e formas de cápsula em tudo" | `home-1280-hero.webp`; `styles.css:358-359`; navegação e seções (14 arquivos com "→") | Raio 8–10 px, sem sombra dura; seta só onde indica deslocamento (ex.: "Ver como é") |
| P2-4 | Cards de jogo sobem e giram no hover sem serem clicáveis | [GENÉRICO] | `carousels.css:36-39` | Plano [`animacoes/002`](animacoes/002-hover-sem-lift-em-cards-nao-clicaveis.md) |
| P2-5 | Kito chorando em vazio e erro (carrinho, drawer de visitante, 404, pagamento falhou) | [MARCA] Tom de voz: pagamento e erros no nível 1, humor mínimo; Kito: "Erro — Isso não funcionou. Excelente oportunidade para fingirmos que fazia parte do plano." (bem-humorado, sem culpa) | `carrinho-1280-vazio.webp`, `drawer-375-vazio-visitante.webp`, `pedido-confirmacao-375-falha.webp`, `404-375.webp`; `KitoEmpty.tsx` | Pose neutra (Kito parado) em pagamento e erro; caixa sem lágrima para vazio. Decisão de arte do responsável |
| P2-6 | Header: "Ajuda" menor e acinzentada; área privada com o header comercial completo | [MARCA] Estrutura: "Na área privada, o header simplifica para logo, Meus jogos, Minha conta e Ajuda" | `home-1280-hero.webp`, `conta-1280.webp`; `navigation.css:23`; `SiteHeader.tsx:92-100` | Ajuda no mesmo peso dos links; header simplificado em Minha área (proposta de navegação, aprovação) |
| P2-7 | Barra lateral de 3 px em avisos (`side-tab`) | [GENÉRICO] (detector) | `termos-1280-borda-lateral.webp`; `styles.css:224,479,502` (a 195 é sobrescrita na 427) | Fundo tonal sem barra, ou borda completa fina |
| P2-8 | Mídia da hero ~727 KB transferidos (atlas 481 KB) contra a meta de ~500 KB | [MARCA] prompt: "Meta inicial de mídia da hero: até cerca de 500 KB… informe o peso medido e qualquer exceção" | medição Playwright (Anexo F) | Registrar a exceção do atlas na base ou servir atlas em 1× para telas 1× via `image-set()`, escalando o atlas inteiro (nunca poses isoladas) |
| P2-9 | CSS em 4 gerações sobrepostas, ~45 hex soltos (173 ocorrências), `--color-bright-teal` declarado e nunca usado, `GamesSection.tsx` morto e ~20 classes órfãs | [GENÉRICO] | `styles.css` (seções "I1", "Redesign", "Actual printable pages"); `.site-header` definido ao menos 4× (`styles.css:29,115,352,519` + `navigation.css:15`) | Fatia de tokens: `DESIGN.md`, tokens únicos, apagar o que não renderiza |
| P2-10 | Lista do pacote sem marcador e recuada; "Download após a confirmação" + "✓ Acesso após a confirmação" repetem a mesma informação | [GENÉRICO] | `home-1280-oferta.webp`; `styles.css:594`; `OfferSection.tsx:23`; `TrustLine.tsx:3` | Marcador ou alinhamento à margem; uma frase só (copy para aprovação) |
| P2-11 | Menu móvel lento (último link em ~610 ms) e seta do botão que fica deslocada após toque | [GENÉRICO] | `menu-375-aberto.webp`; `navigation.css:92,100,105` | Plano [`animacoes/003`](animacoes/003-menu-movel-e-hover-de-seta.md) |

Notas menores, sem severidade: o formulário de newsletter para visitantes aparece desabilitado ("Inscrições em breve") no rodapé de todas as páginas públicas, só no stage `test` (`Newsletter.tsx:13,21-25`); o 404 do servidor de desenvolvimento responde 200, mas o `nginx.conf:26-35` de produção devolve 404 corretamente; "o encontro continua aqui." em `/entrar` começa com minúscula (`styles.css:454`, copy).

## 4. Diagnóstico: REFINAMENTO

**Recomendação: refinamento** — manter a identidade atual (Kito pixel art, céu, Tinta/Turquesa/Damasco, Bricolage + DM Sans) e reconstruir a composição abaixo da hero com a linguagem que a hero já inventou.

Por quê:

1. **O que funciona é decisão de marca e é bom.** A hero é a única parte que "não poderia ser de outro produto"; foi pedida pelo responsável e está bem executada (seção 2). Um redesign trocaria o melhor ativo por uma aposta.
2. **O que falha não é a identidade, é a ausência dela.** Os problemas P1-3, P1-9 e P2-1/2/3 são padrões de template colocados onde a identidade deveria continuar. A cura é estender o mundo do Kito para as seções, não substituí-lo.
3. **A base técnica aguenta.** Paleta e tipografia passam AA com folga, os componentes de conta e compra são sólidos e acessíveis. O trabalho é de sistema (tokens, cascata, um botão secundário que falta) e de composição.
4. **Custo e risco.** Refinamento cabe nas fatias já previstas no prompt da refação (tokens → header/footer → hero → seções → secundárias → estados) sem mexer em rotas, dados ou pagamento.

O que pesaria a favor de um redesign: se o responsável quiser que o site fale mais com o objeto impresso do que com o videogame. Essa alternativa está desenhada como **direção B**, para comparação.

## 5. Duas direções visuais

Ambas usam **só a copy que já existe no site** (inclusive `site.heroDescription`, já presente em `src/content/site.ts:10` mas não usada) e os assets reais de `public/media`. Os esboços são HTML estático, não código de produção. Bricolage Grotesque 700 e DM Sans 400/600 já estão instaladas; nenhuma das duas exige fonte nova.

### Direção A — "Fase contínua" (refinamento, recomendada)

**Ideia:** o chão do Kito vira a régua da página. A hero continua como está; o solo termina em degraus pixel e, a partir daí, cada seção "pousa" num chão fino: os cinco jogos são folhas A4 em pé sobre a grama, o preço fica sobre o chão, os passos andam por ele. O Kito aparece na hero e, no máximo, uma vez mais, em pé ao lado dos jogos, como anfitrião.

**Paleta (6)** — verdes da grama ficam só na paisagem e no "chão-régua":

| Nome | Hex | Uso |
| --- | --- | --- |
| Céu | `#ECFAF7` | Hero, faixas alternadas, capas tipográficas |
| Papel | `#FFFFFF` | Seções de conteúdo, folhas |
| Tinta | `#123A3D` | Texto, títulos, linhas de ficha |
| Turquesa profundo | `#006970` | CTA, links, destaque do H1 |
| Damasco | `#FFB866` | Acento de fundo (nunca texto sobre branco) |
| Terra | `#684839` | Solo, degraus pixel, chão-régua |

| Par de texto | Contraste | AA |
| --- | --- | --- |
| Tinta sobre Papel | 12,37:1 | ✓ |
| Tinta sobre Céu | 11,53:1 | ✓ |
| Turquesa profundo sobre Papel (links) | 6,45:1 | ✓ |
| Turquesa profundo sobre Céu | 6,02:1 | ✓ |
| Papel sobre Turquesa profundo (botão) | 6,45:1 | ✓ |
| Tinta sobre Damasco | 7,24:1 | ✓ |
| Papel sobre Terra (texto em faixa de solo, se usado) | 8,16:1 | ✓ |
| Texto secundário `#345B5D` sobre Papel | 7,50:1 | ✓ |

**Tipografia:** Bricolage Grotesque 700 para H1 (64–88 px, entrelinha 1,02, tracking −0,05em) e H2 (40–52 px, à esquerda); DM Sans 400/600 para corpo (18 px na hero, 16–18 px nas seções), rótulos em caixa normal, preço com algarismos tabulares. Sem caixa alta com tracking; sem fonte pixel em texto.

**Princípio de layout:** faixas de largura total com transição em degraus pixel; conteúdo em grade de 12 colunas com títulos à esquerda e divisões assimétricas (7/5, 5/7); cada seção tem um objeto dominante (folhas, preço, passos), nunca "título centralizado + três cards". Botões com raio de 10 px, sem sombra dura, sem seta.

**Esboço (hero + "Cinco jogos"):** [`direcoes/a/esboco-1280.png`](direcoes/a/esboco-1280.png) · [`direcoes/a/esboco-375.png`](direcoes/a/esboco-375.png) · fonte [`direcoes/a/index.html`](direcoes/a/index.html)

**Riscos:** os degraus podem virar enfeite se aparecerem em toda borda — usar só na transição hero → conteúdo e no chão-régua das seções de produto.

### Direção B — "Folha de recorte" (redesign abaixo da hero)

**Ideia:** o que o casal compra é papel. Abaixo da hero, a página vira a própria folha impressa: branco dominante, linhas turquesa como nas cartas do J001, linhas tracejadas de recorte com tesoura separando as seções, marcas de corte nos cantos, os cinco jogos como uma folha de cartas para recortar e a ficha do J001 com pontilhado de índice. A hero mantém o Kito e o cenário (decisão de marca), mas o texto vai para a esquerda, como uma folha de rosto, e "encontro." ganha um traço de marca-texto. Isso revisa a composição centralizada do prompt da hero (rascunho) e precisa de aprovação.

**Paleta (6):**

| Nome | Hex | Uso |
| --- | --- | --- |
| Papel | `#FFFFFF` | Fundo dominante abaixo da hero |
| Tinta | `#123A3D` | Texto, marcas de corte |
| Turquesa profundo | `#006970` | CTA, links, tesoura |
| Turquesa J001 | `#1BB8C4` | Linhas de carta e de recorte; **só decorativo**, nunca texto nem borda única de controle |
| Marca-texto | `#FFB866` | Traço atrás de palavras em Tinta |
| Céu | `#ECFAF7` | Só a hero |

| Par de texto | Contraste | AA |
| --- | --- | --- |
| Tinta sobre Papel | 12,37:1 | ✓ |
| Turquesa profundo sobre Papel | 6,45:1 | ✓ |
| Papel sobre Turquesa profundo (botão) | 6,45:1 | ✓ |
| Tinta sobre Marca-texto | 7,24:1 | ✓ |
| Tinta sobre Céu | 11,53:1 | ✓ |
| Turquesa J001 sobre Papel | 2,41:1 | ✗ texto — por isso só linhas decorativas |

**Tipografia:** as mesmas famílias instaladas, com outro papel: Bricolage 700 nos títulos e nos nomes dos jogos dentro das cartas; DM Sans 400/600 no corpo e na ficha com pontilhado. Opcional, para aprovação: a fonte pixel dos títulos do PDF do J001 só nos nomes dos jogos (identificar a fonte e a licença no arquivo-fonte do J001 antes; se não houver licença web, ficar sem ela).

**Princípio de layout:** uma folha por seção, separadas por linha de recorte; grades com calhas tracejadas (como a folha de cartas do J001); texto à esquerda; cards com raio de 14 px e borda turquesa, sem sombra.

**Esboço (hero + "Cinco jogos"):** [`direcoes/b/esboco-1280.png`](direcoes/b/esboco-1280.png) · [`direcoes/b/esboco-375.png`](direcoes/b/esboco-375.png) · fonte [`direcoes/b/index.html`](direcoes/b/index.html)

**Riscos:** muitas linhas tracejadas cansam; usar a tesoura só nas divisões de seção e o tracejado só onde há "cartas". Afasta-se da leitura de videogame da hero, então a transição hero → papel precisa ser deliberada (a tesoura logo abaixo do chão faz essa ponte).

### Comparação rápida

| | A — Fase contínua | B — Folha de recorte |
| --- | --- | --- |
| Tipo | Refinamento | Redesign abaixo da hero |
| Fala com | O videogame da hero | O papel impresso do produto |
| Assinatura | Degraus pixel + chão-régua | Linha de recorte com tesoura + folha de cartas |
| Fundo dominante | Céu/Papel alternados | Papel |
| Muda o prompt da hero? | Não (só rótulo, ✓ e CTA, P1-1) | Sim, alinhamento do texto (aprovação) |
| Esforço estimado | Menor | Maior |

## 6. Planos de animação

Índice completo, ordem e dependências: [`animacoes/README.md`](animacoes/README.md).

| # | Plano | Severidade | Liga-se a |
| --- | --- | --- | --- |
| 001 | [Revelar o conteúdo da seção, nunca a seção inteira](animacoes/001-reveal-no-conteudo-nao-na-secao.md) | HIGH | P1-4 |
| 002 | [Tirar o lift de hover dos cards não clicáveis](animacoes/002-hover-sem-lift-em-cards-nao-clicaveis.md) | MEDIUM | P2-4 |
| 003 | [Menu móvel mais curto e hover de seta só com ponteiro fino](animacoes/003-menu-movel-e-hover-de-seta.md) | LOW | P2-11 |
| 004 | [Caminhada do Kito sem teleporte no resize + QA das regras](animacoes/004-caminhada-do-kito-sem-teleporte-no-resize.md) | LOW | Seção 2 (preservar) |
| 005 | [Entradas de UI mais curtas, com tokens de duração](animacoes/005-entradas-de-ui-mais-curtas-e-tokens.md) | LOW | P2-9 |

---

## Anexo A — Critique (impeccable)

### Pontuação heurística (Nielsen)

| # | Heurística | Nota | Ponto-chave |
| --- | --- | --- | --- |
| 1 | Visibilidade do estado do sistema | 3 | Etapas da compra, contagem do carrinho, "Consultando preço…", skeletons. Reveal esconde conteúdo ao rolar (P1-4) |
| 2 | Correspondência com o mundo real | 3 | Português natural, "Meus jogos", "Pedidos". A metáfora "encontro" no lugar de "pacote" esconde o que se compra (P1-1, P1-2) |
| 3 | Controle e liberdade | 3 | Escape e retorno de foco, voltar ao carrinho, remover item |
| 4 | Consistência e padrões | 2 | Cinco rótulos para a mesma ação, `.step-number` muda conforme a rota visitada, botões secundários sem estilo |
| 5 | Prevenção de erros | 3 | Botões desabilitados com motivo, `type=email`, login antes de comprar |
| 6 | Reconhecer em vez de lembrar | 3 | Capas iguais para jogos diferentes em Meus jogos (P0-2) |
| 7 | Flexibilidade e eficiência | 3 | Carrossel por teclado, CTA do header vira "Meus jogos" para quem comprou, links diretos de download |
| 8 | Estética e minimalismo | 2 | Hero forte; abaixo, template repetido, placeholders e Kito em excesso |
| 9 | Recuperação de erros | 2 | Mensagem genérica "carregar ou salvar os dados", retry sem estilo, erro de preço como título; a página de pagamento falho é clara |
| 10 | Ajuda e documentação | 2 | `/ajuda` e FAQ existem, mas o canal de atendimento está pendente (`help.ts:9`) |
| **Total** | | **26/40** | **Aceitável** |

### Veredito de especificidade
**Avaliação própria (antes do detector):** a hero é autoral; o resto da home poderia vender qualquer produto digital para casais com outra paleta. Coerência visual sim, identidade não. Oportunidade perdida mais clara: o cenário pixel art e o objeto impresso, os dois elementos que só a KeyToTwo tem, não estruturam nada abaixo da dobra.
**Detector:** 13 achados na home por URL (`kicker-above-heading` ×8, `hero-eyebrow-chip` ×1, `tight-leading` ×3 nos placeholders, `repeating-stripes-gradient` ×1 — falso positivo: é a textura do chão pixel), 1 `hero-eyebrow-chip` em `/ajuda`, `/termos`, `/entrar`; no código, `side-tab` ×4 (`styles.css:195,224,479,502`; a 195 é morta) e `broken-image` ×1 em `src/lib/blog.server.ts:89` (falso positivo: é uma expressão regular, não uma tag). O detector concordou com a leitura de template e acrescentou as bordas laterais, que eu não tinha anotado.
**Sobreposição visual no navegador:** não injetada (ver Anexo E).

### Carga cognitiva
Falhas no checklist: hierarquia visual (abaixo da hero tudo pesa igual), escolhas mínimas (rótulos de CTA diferentes para a mesma decisão) e divulgação progressiva (oferta no celular). **3 de 8 → moderada.** Ponto de decisão com mais de 4 opções: header logado no desktop (O pacote, Como funciona, Blog, Ajuda, conta, carrinho, Meus jogos = 7).

### Jornada emocional
Pico na hero (o Kito andando é um bom "oi"), vale no meio (placeholders e repetição), fim fraco na página (o fechamento repete a hero) e forte depois da compra (celebração). Momento de maior ansiedade — preço indisponível ou pagamento falho — recebe Kito chorando ou título enorme, quando pedia calma.

### Personas
- **Jordan (primeira visita):** lê "A rotina pode esperar. Vocês têm um encontro." e um botão "Escolher nosso encontro"; só lê "Cinco jogos" a ~1 600 px e o preço a ~4 300 px. Clica em "O pacote" no menu e cai na prévia, não no preço.
- **Riley (testa os limites, desconfia):** vê "Espaço reservado" três vezes onde esperava depoimentos; vê um Kito sobre um tabuleiro como "Boardgame" e depois descobre "Detalhes e prévia em breve". Com o catálogo fora do ar, lê um título "Não conseguimos carregar o preço." e um botão desabilitado.
- **Casey (celular, distraída):** a barra fixa de compra ajuda, mas some quando ela chega à oferta; o preço está a ~860 px do título. No drawer com erro, "Tentar novamente" não parece botão.

### Perguntas para o responsável
- A página deve falar mais com o videogame da hero (A) ou com o papel do produto (B)?
- O "encontro" é o conceito da marca a manter na copy, ou "pacote" volta a ser a palavra principal, como na estrutura?
- O Kito deve aparecer em estados de erro e de pagamento, ou só na hero, nos vazios e na celebração?

## Anexo B — Audit (impeccable)

| # | Dimensão | Nota | Achado principal |
| --- | --- | --- | --- |
| 1 | Acessibilidade | 3 | axe 0 violações em 17 rotas; contraste ≥ 4,95:1; foco visível. Lacunas: `aria-live` do carrossel a cada rolagem, botões secundários sem affordance |
| 2 | Desempenho | 3 | Animações só em `transform`/`opacity`, sprites por `steps()`, imagens dimensionadas e `lazy`, fontes 50 KB. Hero ~727 KB acima da meta (P2-8). Scripts medidos no servidor de dev (8,4 MB, não representativo) |
| 3 | Tema e tokens | 2 | `@theme` com 6 cores, mas ~45 hex soltos (173 ocorrências), tokens divididos entre `styles.css` e `navigation.css`, um token nunca usado. Sem tema escuro (não pedido) |
| 4 | Responsivo | 3 | Sem rolagem horizontal de 375 a 1440; alvos ≥ 44 px; barra fixa no celular. Oferta longa no celular (P1-10) |
| 5 | Integridade de implementação | 2 | Cascata em 4 gerações, `.step-number` e newsletter em conflito, `.button-secondary` inexistente, código morto, `side-tab` |
| **Total** | | **13/20** | **Aceitável** |

## Anexo C — Fontes da base consultadas e ausências

- Lidas: `AGENTS.md`, `00-KeyToTwo-Print.md`, `01-Regras da base.md`, `02-Decisões e pendências.md` (trechos de design), `Marca/00-Marca.md`, `Marca/60-Personalidade e Tom de Voz.md`, `Marca/70-Kito - Persona da Marca.md`, `Desenvolvimento/Prompt - Hero Kito em pixel art.md`, `Marketing/Site - Estrutura e taxonomia.md`, `Desenvolvimento/Prompt - Revisão e refação de design.md`.
- **Ausentes na pasta `Marca/`** (citadas pelo índice e pelo prompt da hero, conferido com `ls` em 2026-10-10): `Site - Direção visual.md`, `Site - Referências e arquivos da hero.md`, `Kito - Animação de caminhada v3.md`. Nenhum achado depende do conteúdo delas.
- **Estado das fontes:** Tom de voz, Kito e Marca estão `ativo`; o prompt da hero e a estrutura do site estão em `rascunho`. Por isso os itens apoiados só nessas duas notas aparecem como "proposta registrada", e a recomendação de revisá-los não é tratada como erro.
- Divergência registrada: a estrutura (rascunho) diz "Sem necessidade inicial: carrinho" e "Não acrescentar ícones de carrinho"; o site tem carrinho por decisão posterior do responsável (modelo de vendas P2, 2026-10-08, registrado fora desta base). Não tratei o carrinho como achado.

## Anexo D — Insumo externo conferido

O mapa da camada visual do Nanquim (scratchpad do Nanquim, 2026-10-10) foi usado como pista. Conferi por conta própria e cito apenas o que reproduzi: `.step-number` em conflito (reproduzido no navegador), `.button-secondary` sem regra (grep + captura), `GamesSection.tsx` sem import (grep), quantidade de hex soltos (contei 45 únicos e 173 ocorrências em CSS; o mapa diz 46) e as gerações sobrepostas de `styles.css` (leitura do arquivo).

## Anexo E — Notas de execução

- **Critique:** contexto único por regra da equipe (banner no topo). Avaliação A (leitura de código e capturas) feita antes de rodar o detector.
- **Detector:** `impeccable detect --json src` (código, 5 achados) e `impeccable detect --json <url>` em `/`, `/meus-jogos`, `/carrinho`, `/ajuda`, `/termos` (as duas rotas privadas foram lidas sem sessão e redirecionaram para `/entrar`).
- **Sobreposição no navegador:** não usada. O fluxo de overlay exige o `live-server` da impeccable, cujo modo live injeta script no HTML do projeto; como o papel é somente leitura no código, usei o detector por URL no lugar. `git status` limpo após os testes.
- **web-design-guidelines:** a skill global não está instalada nesta máquina (`~/.claude/skills` e `~/.agents/skills` só têm frontend-design). Apliquei as regras publicadas das Web Interface Guidelines da Vercel que conheço (alvos de toque, `touch-action`, reticências "…", dimensões de imagem, foco visível, `aria-live` em estados assíncronos, algarismos tabulares); nenhuma violação nova além das listadas.
- **Estados de erro** (preço indisponível, falha do carrinho, pagamento falho/pago) foram simulados interceptando respostas da API no navegador do teste; nenhuma escrita no banco, nenhum pagamento.
- **Snapshot da critique:** gravado em `.impeccable/critique/` pela ferramenta da skill.
- **Scripts de captura:** ficaram no scratchpad do Prumo, fora do repositório.

## Anexo F — Medidas

- **Contraste do site atual** (WCAG): Tinta/Céu 11,53; Turquesa/Céu 6,02; Turquesa/Papel 6,45; Papel/Turquesa 6,45; `#345B5D`/`#F2F8F7` 6,98; `#52716E`/`#F2F8F7` 4,95; Damasco/Tinta 7,24; `#D1E9E5`/Tinta 9,71; Turquesa/`#FFDCAF` 4,95; Tinta/`#FFDCAF` 9,48; erro `#993518`/Papel 7,30.
- **Home a 1280 px, carga inicial (servidor de dev):** imagens 899 KB em 12 arquivos (atlas 481, folhagem direita 131, logo 39, folhagem esquerda 40, nuvens 35, J001 86, Kito 86); fontes 50 KB em 3 arquivos; CSS 77 KB; LCP medido no dev: `img.landscape-right`.
- **Caminhada:** ~66 px/s a 192 px (73 px medidos em ~1,1 s com passos de 100 ms), pista de 223 tiques (22,3 s) a 1280 px, atraso inicial −10,8 s (9 ciclos inteiros → pose 01).
- **Altura da home:** 6 700 px (1280), 7 954 px (375).
- **Capturas:** 32 arquivos WebP em `capturas/` (~1,1 MB); esboços em PNG (~280 KB).
