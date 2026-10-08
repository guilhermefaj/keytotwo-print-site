# Redesign — experiência KeyToTwo

2026-10-08. Floor `featredesign`, porta 5178. Merge solicitado de `origin/feat/kito-v31` (`d8658be`), realizado antes de mudar a hero; commit de merge `2acaf66`. Alterações do redesign sem commit/push. Arte e coreografia K31 preservadas.

## Direção e conteúdo

Referência estudada: https://atwistofdate.co.uk/. Aproveitamos a hierarquia de experiência, benefícios, passos curtos e dúvidas ao fim. Não copiamos textos, produtos, fotografias, números, relatos ou marca.

Paleta proposta da marca: céu #ECFAF7, branco #FFFFFF, tinta #123A3D, turquesa #006970, damasco #FFB866. Bricolage Grotesque 700 e DM Sans 400/600 existentes, auto-hospedadas. Cena pixel art como abertura; bloco tipográfico “só mais uma rodada” como convite visual, sem simular produto ou fotografia de clientes. Conversão orienta a clareza e a hierarquia; não houve experimento de conversão.

Home: manchete de experiência, três benefícios e um CTA; três passos; pilares; bloco visual; prova social reservada; oferta enxuta; cinco dúvidas; fechamento. Navegação, rodapé, formulários e páginas privadas usam o mesmo visual. Detalhes dos jogos saíram da home; composição no carrinho é expansível. Aviso de não reembolso permanece antes da ação de compra.

Prova social editável em **src/content/experience.ts → experience.social**: `rating`, `reviewCount`, `testimonials[].quote/author` e rótulos. Valores null geram espaços reservados sem estrelas ou citações falsas. O check-release bloqueia live com qualquer campo incompleto, independentemente de os marcadores comerciais PENDENTE aparecerem na tela. Conteúdo comercial/legal ainda incompleto continua registrado em src/content e bloqueando release.

Cadastro obrigatório e carrinho privado do I2b preservados: adicionar sem sessão guarda a intenção na URL e abre a entrada; após verificar o e-mail, o item é adicionado. Código, senha após confirmação, recuperação, Google, consentimento único e APIs existentes não foram reimplementados. Google não foi exercitado ponta a ponta. Checkout continua desabilitado até I3. O resumo flexível admite futura seção de cupom; nenhum cupom implementado.

## Skills avaliadas e usadas

- `frontend-design`: versão local indicada, C:/Users/figue/.claude/skills/frontend-design/SKILL.md; direção visual, tipografia, crítica da composição e copy. Já disponível via skill compartilhada em .agents.
- `find-skills`: busca e triagem no diretório público.
- `web-design-guidelines`: Vercel, https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines. Instalada em C:/Users/figue/.codex/skills/web-design-guidelines. Referência para foco, formulário, responsividade e semântica.
- `copywriting`: Corey Haines, https://github.com/coreyhaines31/marketingskills/tree/b9ba399dd88b082b926e261e8ccfb843d20aa066/skills/copywriting. Instalada em C:/Users/figue/.codex/skills/copywriting. Benefício antes de especificação, uma ideia por seção, CTA claro e prova honesta.

Duas instalações com conteúdo lido antes, referências fixadas por commit e sem scripts executáveis no pacote instalado. Usado o instalador oficial do Codex. Não instalamos Impeccable (a versão examinada exigia launcher/binário adicional) nem bancos genéricos de estilos: não eram necessários para esta direção da marca.

## Execução e verificações

`npm ci` (253 pacotes, auditoria sem vulnerabilidades), `npm run lint`, `npm run typecheck` e `npm run build`: exit 0. O build inclui typecheck; 12 rotas pré-renderizadas. Dev: `npm run dev`, **http://127.0.0.1:5178/**. Configuração local ignorada pelo Git, com stage test e somente chave publishable. Supabase/API/Mailpit locais existentes; nenhum arquivo supabase/ ou segredo versionado.

`I2B_LOCAL_QA=1 REDESIGN_QA_DIR=D:/Maestri/qa/keytotwo-redesign npm run test:e2e -- --workers=2`: **55 passed, 1 skipped**, 51,0 s, exit 0. Skip corresponde ao cenário exclusivo de stage preview; build test usado. Fluxos reais de código por Mailpit, senha após verificação, recuperação, proteção de next, persistência/remover carrinho, consentimento entre recargas, preferência de marketing, biblioteca e pedido do seed passaram. Asserts funcionais I2b preservados.

Sem rolagem horizontal nas rotas a 320/390/1440; home também 768 e 1280, com fontes computadas a 200%, sem sobreposição da copy/cena. Formulários privados conferidos pelo teste I2b a 320/390/1440 e fonte raiz 200%. Não é zoom nativo do navegador. Erros encontrados na primeira revisão (quebra de largura do bloco tipográfico e do botão da oferta a 200%) corrigidos e revalidados.

`node scripts/check-release.mjs --self-test`: nove fixtures passaram. `VITE_SITE_STAGE=live node scripts/check-release.mjs`: exit 1 esperado, com bloqueio explícito dos cinco campos vazios de prova social e das pendências comerciais/legais existentes. `git diff --check`: sem erros.

Capturas do build, movimento reduzido, fora do versionamento:
- `D:/Maestri/qa/keytotwo-redesign/home-1440.png` (home completa desktop)
- `D:/Maestri/qa/keytotwo-redesign/home-390.png` (home completa celular)
- `D:/Maestri/qa/keytotwo-redesign/hero-1440.png` e `hero-390.png` (primeira tela)
- Logs: `build.log`, `e2e.log` na mesma pasta.

Pendentes: aprovação visual/copy pelo responsável; relatos, nota e contagem reais; preço, conteúdo final e validação jurídica; checkout/cupom I3 e downloads I4. Nenhum dado de prova social ou preço inventado.
`HERO_URL=http://127.0.0.1:4174/ HERO_QA_DIR=D:/Maestri/qa/keytotwo-redesign/hero-verification npm run verify:hero`: **PASS**, exit 0. Adaptado aos novos títulos, links e proteção de rotas I2b. Dez layouts; zero erros de console/runtime; Axe sem violações nos oito estados; 20 amostras de contraste de controles, mínimo 6,45:1. Teclado, pausa/retomada, suspensão fora de vista, troca real de abas e movimento reduzido passaram. Percursos completos 24,7 s desktop e 11,9 s celular, 12 poses e fechamento 12→01 observados. Mídia 1.429.359 bytes em ambas as escalas, mesma exceção K31 pelo atlas oficial intacto. Relatório em `hero-verification/report.json`, log `verify.log`.