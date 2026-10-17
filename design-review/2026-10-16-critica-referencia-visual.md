# Crítica de design e plano para referência visual

KeyToTwo, 2026-10-16. Base: `main` em `42c9702` (PR #24), stage `test`, dev em 5178.

**Método.** Skill `design:design-critique` (primeira impressão, usabilidade, hierarquia, consistência, acessibilidade), aplicada a 18 telas em 1440 px e 390 px: Início, Loja, produto P001 e J001, Blog, Ajuda, Entrar, 404, sacola vazia e com itens, gaveta, pagamento, erro da confirmação, Meus jogos, Pedidos, Conta e menu móvel. As páginas públicas usam o catálogo real (Supabase hospedado). A área privada usa sessão sintética, como em `d2-portal.spec.ts`. O axe (WCAG 2.2 AA) rodou em 16 telas e encontrou **0 violações**. A tela de celebração da compra não foi capturada, porque o mock de `order-status` não pegou, e por isso não entra na avaliação.

**Referência.** `DESIGN.md` (direção B, "Folha de recorte", Portão 1 de 2026-10-10) e as decisões do Portão 2. O plano evolui essa direção e não volta atrás em nada que já foi decidido: as marcas de corte continuam fora, os eyebrows também, o marca-texto aparece uma vez e a hero mantém a coreografia do Kito.

---

## 1. Impressão geral

O site é limpo, acessível e disciplinado. A hero é o melhor momento: o título com o marca-texto, o Kito andando no chão até a borda e a tesoura cortando a página formam uma abertura que é só da KeyToTwo. Daí para baixo, a página vira um template bem comportado: título à esquerda, texto, cards com borda turquesa, e a mesma receita repetida até o rodapé.

O problema central é que **a marca fala duas línguas que ainda não se encontram**:

- **Os ativos da marca** (logo, Kito e capas oficiais) são pixel art saturada e brincalhona, com letreiro grosso, rosa, amarelo e laranja.
- **A interface** é editorial e contida: papel branco, tinta verde-escura, uma linha turquesa e um único marca-texto.

Hoje as capas parecem figurinhas coladas numa folha de escritório. Para o site virar referência, a interface precisa absorver parte da energia das capas sem perder a calma da folha. A outra grande lacuna é que o site promete papel ("a próxima rodada sai da impressora"), mas **nunca mostra o jogo impresso no mundo real**.

## 2. O que já funciona (manter)

- **Hero.** Tem tipografia de impacto, um único marca-texto, a cena pixel até as bordas e o Kito com movimento real. Funciona como assinatura.
- **Acessibilidade.** Axe zerado em 16 telas, contorno de foco de 3 px, `prefers-reduced-motion` com o Kito parado e o botão "Retomar", e contraste documentado por token.
- **Disciplina de sistema.** `DESIGN.md` com tokens, um nome por ação, controles planos de 6 px, cards de borda única e ícones Tabler padronizados.
- **Capas oficiais.** Formam uma família coerente e tornam cada jogo reconhecível na hora. São o ativo visual mais forte do site.
- **Meus jogos.** Capa, "Baixar PDF" e "Como imprimir" em cards iguais. É a tela mais clara do site.
- **Ficha com pontilhado** (J001: Pessoas, Partida, Arquivo). É um detalhe de impresso genuíno, que poderia aparecer em mais lugares.
- **Estados com o Kito.** O vazio e o 404 acolhem sem pedir desculpa.
- **Gaveta da sacola.** É direta, com a miniatura da capa, o total e um único botão.

## 3. Diagnóstico pela estrutura da skill

### 3.1 Primeira impressão (2 segundos)

- **O que puxa o olho:** o título "A rotina pode esperar. Vocês têm um encontro." e o Kito. Está certo para a marca.
- **Reação:** simpatia e leveza. O propósito ("jogos para imprimir, para casais") aparece na etiqueta e no apoio. Ainda assim, nada na dobra mostra **o que se recebe** (papel, cartas). Quem chega frio entende o clima, mas não vê o objeto.
- **Logo do topo × resto:** o logo pixel ciano com contorno escuro é o único elemento "de jogo" no cabeçalho. O resto do cabeçalho é corporativo.

### 3.2 Usabilidade

| Achado | Severidade | Recomendação |
|---|---|---|
| Na Loja, no Início e na página do pacote, Tabuleiro da Sorte e O Sumiço de Rapadura aparecem com "Em breve" e "Detalhes e prévia em breve.", mas **já estão à venda dentro do pacote**. A pessoa lê "indisponível". | 🔴 Crítico | Criar o estado de card "No pacote Fundadores", com link para o P001, no lugar de "Em breve". Reservar "Em breve" para o que realmente não existe. |
| Na página do P001, a seção "Jogos do pacote" repete os cards da loja: J001 oferece "Adicionar à sacola" avulso, e J002/J003 dizem "Em breve" dentro do pacote que a pessoa está vendo. Isso contradiz a oferta. | 🔴 Crítico | Na página do pacote, usar uma variante "incluído": capa, nome, uma linha e "Ver detalhes", sem preço nem compra avulsa. |
| No pagamento, o formulário só aparece depois de marcar "Li e aceito os termos". Antes disso, metade da tela é um card vazio ("o formulário de pagamento aparece aqui"). | 🟡 Moderado | Mostrar o formulário de cara e pôr o aceite junto ao botão de pagar, ou usar o texto "Ao finalizar, você concorda com os termos", se o jurídico permitir. Isso mexe no fluxo da Stripe, então precisa de teste. |
| No Entrar, há duas manchetes na coluna esquerda: H1 "Entrar" e, abaixo, "o encontro continua **aqui**.", que começa com minúscula e parece um fragmento solto. São três caminhos (código, senha e "Criar conta com senha") mais o Google. | 🟡 Moderado | Um título só. O apoio vira uma frase. Agrupar as opções: código como padrão, depois Google, e "Usar senha" como link secundário. |
| Na área privada, "Meus jogos" aparece 3 vezes: no menu do cabeçalho, na aba ativa e no H1. O cabeçalho e as abas fazem o mesmo trabalho. | 🟡 Moderado | Escolher um dos dois. Sugestão: manter as abas e deixar o cabeçalho com logo, Ajuda e conta. A saudação "Olá, Marina!" com o Kito sobe para o lugar do H1 visual (o H1 continua para o leitor de tela). |
| A etapa "Entrar" aparece concluída enquanto a etapa 1 (Sacola) está ativa, inclusive na sacola vazia. | 🟢 Menor | Para quem já entrou, mostrar 3 etapas (Sacola, Pagamento, Pronto). Na sacola vazia, esconder as etapas. |
| O CTA "Ver os jogos" do cabeçalho aparece na sacola e na confirmação, puxando a pessoa para fora da compra. O rodapé completo aparece no pagamento, que deveria ser modo foco. | 🟢 Menor | Esconder o CTA em `/carrinho` e `/pedido/*`. No `/pagamento`, usar um rodapé mínimo (Termos, Privacidade, Ajuda). |
| No celular, a página do produto mostra o card de compra antes da capa. A primeira tela não tem imagem do produto. | 🟢 Menor | Capa primeiro (16:9, pequena), depois preço e botão. A regra "preço antes da prévia" vale para a prévia, e a capa não é prévia. |
| O "Ver os jogos" aparece 5 vezes no Início (cabeçalho, hero, prévia, vitrine e fechamento). | 🟢 Menor | Variar pelo contexto. Na prévia, por exemplo, "Ver Rabisque e Adivinhe". A copy é decisão sua. |

### 3.3 Hierarquia visual

- **O que puxa o olho primeiro:** o título da hero. Correto.
- **Fluxo de leitura:** a hero é forte. Da prévia para baixo, todas as seções têm o mesmo peso (H2 grande à esquerda, conteúdo abaixo, muito branco). O olho não sabe qual seção importa mais. A vitrine, que é onde se compra, tem o mesmo tratamento de "Como funciona".
- **Ênfase errada:**
  - A **prévia** ("A próxima rodada sai da impressora") é uma pilha de páginas em leque, pálidas e pequenas, com a legenda solta 90 px abaixo. É a prova do produto e é a imagem mais fraca da página.
  - **"Como funciona"** tem três colunas de texto pequeno com número em círculo, o padrão de landing que o próprio `DESIGN.md` lista como anti-referência.
  - **Grátis** usa H2 em `headline-sm` (28 px) enquanto as seções vizinhas usam `headline` (52 px). Parece subseção da vitrine.
  - Os **cards "Em breve"** herdam a altura do card do J001 e ficam com 60 % de vazio.
- **Respiro:** o espaço entre as seções é generoso (bom), mas dentro delas sobra espaço sem conteúdo: a coluna direita vazia no fechamento e em "Dúvidas", e o vazio sob a capa na página do produto.

### 3.4 Consistência

| Elemento | Inconsistência | Recomendação |
|---|---|---|
| Kito | Três Kitos diferentes: ciano claro na hero e no 404, verde-azulado escuro **chorando** na sacola vazia, e o das capas, com contorno e sombreado de ilustração. O que chora contraria o espírito da regra "sem expressão triste". | Uma folha de personagem com paleta, contorno e expressões aprovadas. Trocar o Kito da caixa por um sem lágrima (curioso ou dormindo). |
| `<details>` / `summary` | O FAQ, o "O que está incluído" da sacola e os "Detalhes do pedido" usam o triângulo nativo ▶ do navegador. É o único elemento sem desenho do sistema. | Chevron Tabler de 20 px com rotação de 240 ms, alvo de 44 px e a régua de Tinta como divisória. |
| Títulos de seção | `headline` em quase todas as seções, `headline-sm` em Grátis e na Newsletter. A regra não diz quando usar cada um. | Escrever no `DESIGN.md`: seção = `headline`, bloco dentro da seção = `headline-sm`. Grátis sobe para `headline`. |
| Navegação de volta | "Loja" (breadcrumb sublinhado) no produto, "Voltar ao início" na Ajuda, "Voltar à sacola" no pagamento. São três estilos. | Um componente só, `back-link` com chevron à esquerda, Label 600. |
| Cards de borda | A maioria tem borda de 2 px turquesa, mas "Sair neste dispositivo" (Conta) tem borda de 1 px cinza, e o botão "Receber ideias" desabilitado fica cinza-claro, perto de um input com borda de tinta. | Documentar a variante "aviso" (1,5 px Tinta suave) e usá-la. O botão desabilitado precisa da razão ao lado. A razão existe, mas está longe dele. |
| Repetição de copy | "encontro" aparece em quase toda tela (hero, newsletter, fechamento, entrar, sacola, pagamento x2, ajuda). Gasta a palavra-chave da marca. | Guardar "encontro" para a hero e o fechamento e variar no resto. A decisão é sua. |
| Vitrine × Loja | A vitrine do Início é uma cópia integral da Loja, com os mesmos cards e o mesmo "Em breve". | No Início, uma vitrine compacta: pacote em destaque + fileira de capas clicáveis. A Loja fica com os cards completos. |

### 3.5 Acessibilidade

- **Contraste:** passa. Tinta 12,37:1, Turquesa profundo 6,45:1, Tinta suave 7,50:1. A Turquesa J001 (2,41:1) aparece só como linha, conforme a regra.
- **Alvos de toque:** botões com 48 px, links do cabeçalho com 44 px. O controle "Pausar animação" no celular fica entre o CTA e a cena, longe do Kito. Vale aproximá-lo do canto da cena.
- **Legibilidade:** corpo com 16 px e entrelinha de 1,6. As legendas ("Valor de teste", "Uma prévia real…") estão no limite de 13 px. Tudo bem em legenda, mas evite ir além disso.
- **Movimento:** reduzido de verdade (Kito parado no quadro 01).
- **Ponto a acompanhar:** os placeholders do "Grátis" ("Em breve / Jogo a definir") e os relatos de exemplo só aparecem no stage test. No dia em que o stage mudar, conferir se nada vaza.

## 4. Crítica por área (componentes e seções)

| Área | Funciona | Problema | Direção |
|---|---|---|---|
| Cabeçalho | Leve, ativo sublinhado, sacola com contagem | Corporativo perto do logo; CTA em telas de compra | Ver Fase 0. Depois, permitir um detalhe pixel (contagem da sacola em selo pixel) |
| Hero | Assinatura da marca | Lado direito vazio acima da cena; "Pausar animação" solto | Não mexer na coreografia. Só aproximar o controle da cena |
| Prévia (experiência) | Usa página real do PDF | Leque pálido, plano, sem escala nem contexto | Foto/mockup do jogo impresso na mesa (Fase 1) |
| Como funciona | Copy curta | Três colunas de template, sem imagem | Três "cartas" ilustradas (escolher, imprimir, jogar) com ícone pixel ou foto, em fila tracejada de recorte |
| Relatos | Estrutura pronta | Placeholder; três cards iguais | Só publicar com relatos reais. Quando houver, foto do casal ou da mesa, sem estrelas |
| Vitrine / cards da Loja | Capas fortes, preço claro | "Em breve" enganoso; cards vazios; nenhuma cor por jogo | Estados de card + cor por jogo (Fases 0 e 1) |
| Grátis | Proposta clara | H2 menor; card "Jogo a definir" vazio | H2 `headline`; não mostrar vaga vazia, mostrar só o que existe |
| Dúvidas | Respostas curtas | `summary` nativo; coluna esquerda vazia | Chevron do sistema; Kito "convidando" ao lado ou link de Ajuda com destaque |
| Fechamento | Frase boa | Seção magra, metade direita vazia | Juntar com o rodapé: o chão pixel volta e o Kito se despede (Fase 1) |
| Newsletter | Copy simpática | Botão desabilitado parece quebrado | Enquanto não houver envio, esconder a seção em produção ou trocar por "em breve" sem input |
| Rodapé | Organizado | Genérico, sem marca | O chão da hero fecha a página (Fase 1) |
| Produto (P001/J001) | Ficha pontilhada, "O que está incluído" | Página magra: uma capa, vazio sob ela, sem galeria, sem "o que vocês precisam" | Template de produto completo (Fase 2) |
| Sacola / gaveta | Miniaturas, total claro | `summary` nativo; "Remover" solto; etapas confusas | Fase 0 |
| Pagamento | Resumo com capas | Card vazio antes do aceite; rodapé completo | Fase 0 e checkout |
| Confirmação (erro) | Kito neutro, saída clara | Etapa "Pagamento" ativa num erro; CTA comercial no cabeçalho | Esconder etapas no erro |
| Meus jogos | Melhor tela do site | Saudação fraca à esquerda, Kito isolado à direita | Saudação como cartão de boas-vindas com o Kito ao lado do nome |
| Pedidos / Conta | Claros | Triplo "Meus jogos"; cartão cinza destoante | Fase 0 |
| Entrar | Card de formulário limpo | Duas manchetes; minúscula; quatro caminhos | Fase 0 |
| Ajuda | Âncoras por tema | Parede de texto; copy desatualizada ("O pagamento estará disponível em breve"); sem canal de atendimento | Central de ajuda + guia de impressão visual (Fase 3) |
| Blog | Lista legível | Sem imagem; só rascunho no test | Capa por post quando houver conteúdo |
| 404 | Kito neutro | Copy burocrática ("O endereço solicitado não está disponível") | Copy com a voz da marca (decisão sua) |
| Menu móvel | Links grandes, ordem clara | Bem resolvido | Manter |

## 5. Plano de desenvolvimento em design

O objetivo é que alguém que abra o site lembre dele depois e queira mostrar para outra pessoa. Isso pede três coisas: **assinatura** (ninguém mais tem essa cara), **prova** (o produto real aparece) e **acabamento** (nenhum detalhe destoa). As fases vão do mais barato e seguro ao que pede decisão e produção de imagem.

Ritmo enxuto: um agente por fase, um PR por fase, QA só das telas afetadas e a suíte completa só na fase final.

### Fase 0 — Acerto de rota (sem decisão de direção, ~2 dias)

Corrige o que confunde ou destoa. Nada aqui muda a direção visual.

1. **Estados de card de jogo**: `à venda`, `no pacote` (novo), `grátis`, `em breve`. J002 e J003 passam a "No pacote Fundadores" com link. O card não estica para igualar a altura de cards com mais conteúdo; o rodapé alinha com `margin-top: auto`, mas o corpo não fica com vazio enorme.
2. **Página do pacote**: "Jogos do pacote" com a variante `incluído`, sem compra avulsa nem "Em breve".
3. **`summary` do sistema**: chevron Tabler em FAQ, sacola e pedidos.
4. **Títulos**: Grátis em `headline`, e a regra seção/bloco escrita no `DESIGN.md`.
5. **Entrar**: um título, apoio em uma frase e opções agrupadas.
6. **Área privada**: o cabeçalho deixa de repetir as abas; a saudação ganha o Kito ao lado.
7. **Compra em modo foco**: sem CTA comercial em sacola e confirmação, rodapé mínimo no pagamento, etapas para quem já entrou e nenhuma etapa na sacola vazia nem no erro.
8. **Produto no celular**: capa antes do card de compra.
9. **Componente `back-link`** único.
10. **Copy para você decidir** (lista pronta, sem aplicar): Ajuda desatualizada, 404, repetição de "encontro" e de "Ver os jogos".

Aceite: as telas afetadas recapturadas em 390/1440, axe 0 e as specs de `shop`, `public`, `d1`, `d2` e `i5` verdes.

### Fase 1 — Assinatura "Folha de recorte 2.0" (decisão no Portão A)

A folha continua sendo a base. Entram três movimentos que ligam a interface aos ativos da marca:

1. **Cor por jogo.** Cada jogo ganha um token de destaque tirado da própria capa: Rabisque em rosa, Tabuleiro em amarelo-ouro, Rapadura em laranja-areia, Hora dos Artistas em vermelho-tinta. O token vem de `games.ts`, como manda a regra do catálogo, e aparece numa faixa de 6 px no topo do card, no fundo da miniatura tipográfica e no cabeçalho da página do produto. Texto nunca usa essas cores (contraste); elas são cor de superfície e de linha. O resultado é um catálogo com energia, que cresce sozinho a cada jogo novo.
2. **A mesa.** Uma série de fotos ou mockups fotográficos do jogo impresso: cartas recortadas sobre a mesa, mãos, caneta, a tesoura. Elas substituem o leque pálido da prévia e ancoram as páginas de produto. São conteúdo, não sombra de interface, então a "Flat Sheet Rule" continua valendo para os controles. Esta é a prova do produto, que hoje não existe.
3. **O chão volta.** O rodapé fecha a página com a faixa de chão pixel da hero e o Kito parado acenando ou sentado (o Kito acolhe, conforme a regra). A página passa a ter começo e fim no mundo do Kito, e a folha de papel fica no meio.

Opcional, se você licenciar: **fonte pixel** (a do PDF do J001) só em números e etiquetas curtas (número da etapa, selo "Grátis", contagem da sacola). Ela aproxima a interface do logo e das capas sem tirar a legibilidade do corpo. O `DESIGN.md` já condiciona o uso à licença.

Entregáveis: atualização do `DESIGN.md` (tokens `--game-accent-*`, regra da foto e do rodapé), um protótipo da Loja e do Início no portal 5179 para o Portão A, e depois a implementação. A foto pede produção: você fotografa, ou fazemos mockups a partir dos PDFs e trocamos depois.

### Fase 2 — Páginas que vendem (produto, Loja e vitrine)

1. **Template de produto**: galeria (capa, 2 a 3 páginas reais e a foto da mesa), ficha no topo (pessoas, duração, páginas, o que imprimir), "O que vocês precisam" com ícones (impressora, tesoura, caneta, temporizador), "Como jogar" em 3 passos específicos do jogo, e o pacote como alternativa, com o argumento de valor só se ele for real.
2. **Loja**: cabeçalho com o pacote em banner (capa grande e cor do pacote), seguido da grade de jogos com cor por jogo.
3. **Vitrine do Início**: pacote em destaque + fileira de capas clicáveis (sem cards completos); no celular, carrossel com snap.
4. **"Como funciona"** reescrito como três cartas ilustradas na fila tracejada.

### Fase 3 — Depois da compra (o jogo chega à mesa)

1. **Central de ajuda** com cards por tema e um **Guia de impressão** visual: papel recomendado, escala 100 %, corte e o que fazer se a impressora cortar a margem, com ilustrações pixel ou fotos. O link "Como imprimir" de Meus jogos aponta para ele.
2. **Canal de atendimento** visível (e-mail), já que a Ajuda hoje diz "Estamos preparando".
3. **Meus jogos**: o cartão de boas-vindas e, por jogo, "Imprimir só as cartas" ou "Imprimir tudo", se o PDF permitir.
4. **E-mails** (Brevo) com o mesmo sistema: cor por jogo, capa e o chão no rodapé.

### Fase 4 — Polimento e prova de referência

1. **Movimento**: hover nas capas clicáveis (deslocamento de 2 px e brilho pixel curto, abaixo de 300 ms), entrada da fileira de capas com escalonamento. Tudo dentro dos tokens do plano 005.
2. **Desempenho**: a hero tem 976 KB, contra a meta de cerca de 500 KB (exceção aprovada). Testar o atlas em AVIF e medir o LCP no celular.
3. **Prova social real**: relatos e fotos de clientes quando existirem, nunca placeholders em produção.
4. **Critérios de "referência"** (para fechar o plano): axe 0 em todas as telas; Lighthouse ≥ 95 em acessibilidade e desempenho no celular; nenhuma inconsistência da seção 3.4 em aberto; teste de 5 segundos com 5 pessoas fora do projeto em que pelo menos 4 digam "jogos para casais imprimirem"; e uma auditoria de consistência final com esta mesma skill.

## 6. Decisões que são suas

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Cor por jogo (tokens a partir das capas) | Sim. É o que mais aproxima a interface das capas, com custo baixo |
| 2 | Fotos ou mockups da mesa | Sim. Começar com mockups dos PDFs e trocar por fotos reais quando houver |
| 3 | Chão pixel e Kito no rodapé | Sim. Fecha a página no mundo do Kito |
| 4 | Licenciar a fonte pixel | Opcional. Só se a licença web for simples |
| 5 | Aceite dos termos no pagamento sem bloquear o formulário | Sim, se o jurídico permitir |
| 6 | Novo Kito da caixa sem lágrima + folha de personagem | Sim |
| 7 | Copy (Ajuda, 404, Entrar, "encontro", "Ver os jogos") | Revisar em uma rodada só |
| 8 | Newsletter em produção sem envio | Esconder até o envio existir |

Nota fora do design: o pacote custa R$ 29,90 com 3 jogos, e o J001 avulso custa R$ 9,90. Se J002 e J003 forem vendidos avulsos pelo mesmo preço, o pacote fica mais caro que a soma (R$ 29,70). Vale decidir o preço antes de desenhar qualquer argumento de "economia".

---

## 7. Execução (2026-10-16, branch `design/fase-0-1`)

O responsável aprovou a Fase 0 e liberou a Fase 1 com as decisões que cabem ao design.

**Feito na Fase 0:**
- Card de jogo com o estado "No pacote" (selo e "Ver o pacote"). Tabuleiro e Rapadura deixam de aparecer "Em breve".
- Página do pacote com a variante "incluído": capa, resumo e ficha de cada jogo, sem compra avulsa.
- Resumo e ficha de J002 e J003, tirados das fichas do segundo cérebro (`Jogos/J002` e `Jogos/J003`, conferidas em 2026-10-16), sem duração não medida e sem spoiler.
- `summary` com chevron do sistema (FAQ, sacola e pedidos) e `BackLink` único.
- Grátis com H2 de seção no Início, e a regra seção/bloco escrita no DESIGN.md.
- Entrar com um título só.
- Área privada sem menu duplicado no desktop, com o Kito ao lado da saudação.
- Compra em modo foco: sem CTA comercial na sacola e na confirmação, rodapé mínimo no pagamento, três etapas para quem já entrou, sem etapas na sacola vazia nem nos erros.
- Capa antes da compra no celular, na página do produto e no card do pacote.
- Newsletter escondida até existir o envio (decisão do responsável).

**Feito na Fase 1:**
- Cor por jogo, tirada das capas: faixa sob a capa, marcador na lista do pacote e fundo da capa tipográfica.
- O chão da hero e o Kito acenando fecham o rodapé público.
- DESIGN.md atualizado: Cor do jogo, regras de rodapé, Voltar, Abre e fecha, Etapas e Kito.

**Ficou de fora**, porque depende do responsável ou de produção:
- Fotos e mockups da mesa.
- Licença da fonte pixel.
- Aceite dos termos sem bloquear o formulário (jurídico).
- Kito da caixa sem lágrima (arte nova).
- Toda mudança de copy: lista na seção 6, item 7. A exceção são os resumos e fichas de J002 e J003, que vieram das fichas.

O preço continua como está: o responsável vai adicionar mais jogos ao pacote.

## 8. Execução da Fase 2 (2026-10-16, branch `design/fase-2`)

- **Página de produto completa.** Ficha no topo; galeria (capa e páginas reais autorizadas, ou as capas dos jogos no pacote); "Como jogar" em três passos; "O que vocês precisam" com ícones; o pacote como alternativa ("todos num só pedido", sem comparar preços).
- **Avulsos de J003 e J002**, por decisão do responsável no meio da fase: todo jogo pago se vende sozinho. Tabuleiro da Sorte custa R$ 9,90 e O Sumiço de Rapadura, R$ 12,90. Os preços foram criados no Stripe de teste e os produtos ativados no banco hospedado, com o OK do responsável (`supabase/catalog/avulsos-j002-j003.sql`). As páginas `/loja/j003` e `/loja/j002` são pré-renderizadas.
- **Banner do pacote** na Loja e no Início: a capa grande com as miniaturas dos jogos embaixo e, ao lado, a compra.
- **Vitrine do Início:** fileira de capas clicáveis com o preço do avulso, em carrossel no celular. A compra fica no banner, na Loja e no produto.
- **"Como funciona"** em três cartas com calhas tracejadas e ícones.
- **Conteúdo:** os passos de "Como jogar" e "O que vocês precisam" de J002 e J003 vêm das fichas do segundo cérebro. Os do J001 vêm das regras já no site.
- **Fora desta fase:** a foto da mesa, que depende do responsável.

**Ajuste pedido pelo responsável (2026-10-16), antes do merge da Fase 2:** nenhuma página do PDF vai para o site, porque qualquer pessoa abriria a imagem em outra aba e baixaria o jogo sem comprar. Por isso:
- **Arquivos:** saíram de `public/` as três páginas do J001 e o componente que as mostrava no Início. O script `prepare-conversion-assets.mjs` deixou de renderizá-las.
- **Início:** o leque de páginas deu lugar ao Kito comemorando no tabuleiro, arte da marca. O link da hero agora é "Como funciona".
- **Galeria do produto:** mostra só capas oficiais.
- **Detalhes de cada jogo:** ficaram genéricos e focados na experiência do casal:
  - ficha com pessoas, jeito de jogar, o que está em jogo e formato, sem contar páginas nem cartas;
  - "Como é jogar" em três momentos no lugar dos passos de regra;
  - "O que está incluído" também sem contagens.

## 9. Execução da Fase 3 (2026-10-16, branch `design/fase-3`)

- **Central de ajuda:** cards de tema; textos com fatos conferidos (cartão pela Stripe, conta para comprar, e-mail com botões de 30 dias, acesso sem prazo); fim do "o pagamento estará disponível em breve".
- **Guia de impressão:** papel A4, tamanho real, uma face, recorte e guardar, mais "O que cada jogo pede", tirado de `needs`. Sem nenhuma página do PDF e sem prometer resultado de impressão que não foi testado.
- **Atendimento:** `contato@keytotwo.com.br`, definido pelo responsável, com botão "Copiar e-mail".
- **E-mails no visual da marca:** os 3 modelos de Auth e os 3 transacionais (entrega, lembrete e pós-compra) ganharam a faixa de Céu, a linha de recorte, o botão em Turquesa profundo e o rodapé com a assinatura e o atendimento. O texto não mudou. O responsável autorizou publicá-los no Supabase hospedado depois dos testes.
- **Meus jogos:** "Como imprimir" já levava a `/ajuda#impressao`, que agora é o guia. Não há como oferecer "imprimir só as cartas", porque cada jogo é um PDF único.

## 10. Execução da Fase 4 e prova de referência (2026-10-16, branch `design/fase-4`)

**Desempenho:**
- **Compressão:** `gzip on` no `nginx.conf` do container do site. Antes, JS e CSS saíam sem compressão (cerca de 535 KB a mais). O Traefik da VPS não foi tocado.
- **Fontes:** preload da Bricolage 700 e da DM Sans 400 (o título da hero é o LCP) e `preconnect` ao Supabase.
- **Capas:** `sizes` corretos, para as miniaturas de 88 a 112 px não baixarem a versão de 1280 px.
- **Atlas do Kito (482 KB):** não muda. É arte em resolução nativa, o AVIF sem perdas fica 2,7 vezes maior e o DESIGN.md proíbe regerar o atlas. Continua valendo a exceção aprovada no Portão 2. Testei adiar o atlas para depois do `load` e desfiz, porque não houve ganho consistente.

**Movimento:** as capas da vitrine entram uma a uma (8 px, 240 ms, 40 ms entre elas), só sem movimento reduzido.

**Consistência:** o cartão "Sair neste dispositivo" usa a variante "aviso" do sistema.

### Critérios de referência

| Critério | Resultado |
|---|---|
| Axe 0 em todas as telas | ✓ 18 telas (públicas e privadas, 1440 px), WCAG 2.2 AA |
| Lighthouse acessibilidade ≥ 95 | ✓ 100 em Início, Loja, produto e Ajuda |
| Lighthouse desempenho ≥ 95 no celular | ✗ Loja 82, produto 82, Ajuda 83, Início cerca de 70 (simulação de 4G lento, servidor local com gzip). O LCP observado sem simulação é de 0,7 s. |
| Nenhuma inconsistência da seção 3.4 em aberto | Quase: falta o Kito da caixa chorando (arte nova) e a repetição de "encontro" (copy) |
| Teste de 5 segundos com 5 pessoas | Pendente: depende do responsável |
| Nova crítica com a mesma skill | Feita (abaixo) |

### Crítica final (design:design-critique)

- **Primeira impressão:** a hero continua sendo a assinatura. Logo abaixo, o Kito comemorando no tabuleiro diz "isto é um jogo para jogar junto", sem mostrar nenhum conteúdo pago.
- **Usabilidade:** todo jogo pago se compra sozinho ou no pacote, sem nenhum "Em breve" enganoso. A página de produto responde o que é, como é jogar, o que precisam e quanto custa. A compra corre em modo foco e a Ajuda tem atendimento real.
- **Hierarquia:** o Início alterna cartas (Como funciona), relatos, o banner do pacote e a fileira de capas. As seções deixaram de ter todas o mesmo peso.
- **Consistência:** a cor por jogo atravessa card, banner, página, biblioteca e Ajuda. Um só desenho para voltar, abrir e fechar, aviso e etapas. Os e-mails falam a mesma língua do site.
- **Acessibilidade:** axe 0, Lighthouse 100, foco visível e movimento reduzido respeitado.

**O que ainda separa o site de uma referência:**
1. Fotos da mesa com o jogo impresso (produção do responsável).
2. Desempenho no celular: carregar o `supabase-js` só quando necessário nas páginas públicas e servir o atlas em duas resoluções, se o responsável aceitar rever a regra.
3. O Kito da caixa sem lágrima.
4. Uma rodada de copy (seção 6).
5. O teste de 5 segundos.
6. Atualizar o `scripts/verify-hero.mjs`, que ainda espera a navegação e o CTA anteriores aos PRs #17 e #18.
