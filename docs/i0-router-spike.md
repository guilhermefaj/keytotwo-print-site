# I0-A — React Router e pré-render

Floor: `D:/Maestri/.maestri/floors/keytotwo-print-site--feati0-router`, branch `feat/i0-router`, base `28727bf`. Trabalho restrito ao floor, sem commit/push. A nota **Plano do site P1**, seções 2.3, I0 e ajustes do orquestrador, orienta este incremento; a hospedagem prevista é a VPS Hostinger, não Cloudflare.

## Spike

React Router **8.4.0** em framework mode funciona com **Vite 8.3.3**, **Tailwind 4.3.3**, React 19.3, TypeScript 6.0.3 e Node 24.13.0. `ssr: false`, `appDirectory: src` e `prerender({ getStaticPaths })` produzem HTML durante o build, sem exigir servidor de aplicação em produção. **Plano B não necessário.**

O `node_modules` copiado estava incompleto; a reinstalação pelo lockfile corrigiu os módulos ausentes. `isbot`, exigido pelo entry server padrão do framework durante o build, está declarado e travado no lockfile, evitando instalação automática na primeira execução.

O `vite preview` original devolvia o HTML da home para caminhos de diretórios sem barra final, provocando recuperação de hidratação nas outras rotas. O preview passou a usar **sirv-cli** com o fallback próprio do React Router. A checagem agora compara o H1 do HTML efetivamente servido, antes do JavaScript, além de capturar erros de execução e console.

Referências oficiais: [pré-render e servidor estático](https://reactrouter.com/how-to/pre-rendering), [adoção do framework e Vite 8](https://reactrouter.com/upgrading/component-routes), [documento raiz](https://reactrouter.com/api/framework-conventions/root.tsx).

## Estrutura

- `src/root.tsx`: documento pt-BR, estilos/fontes existentes, noindex geral, skeleton temporário compartilhado, fallback e erro. Metadados de título/descrição usam os elementos nativos do React 19.
- `src/routes/home.tsx`: absorve `App.tsx`, preserva copy, composição, CSS e assets da hero. O logo navega para `/` usando `Link`. `/preview/hero` permanece como alias.
- `HeroScene`: snapshots determinísticos para pré-render/hidratação; APIs do navegador só são consultadas no cliente. Kito começa estático e centralizado no HTML, aplicando preferência de movimento após hidratação. Pausa manual e visibilidade conservam o comportamento anterior.
- Stubs mínimos com marcador PENDENTE para entrar, meus jogos, conta, confirmação do pedido, ajuda, termos, privacidade, reembolsos e página não encontrada. Não há autenticação, dados de conta, confirmação de pagamento ou textos legais inventados.
- Removidos `index.html`, `src/main.tsx` e `src/App.tsx`. O framework fornece os entry points padrão.

`build/client` contém **11 `index.html`**: `/`, `/preview/hero`, `/entrar`, `/meus-jogos`, `/conta`, `/pedido/confirmacao`, `/ajuda`, `/termos`, `/privacidade`, `/reembolsos`, `/404`. O H1 da hero está no HTML da raiz. O catch-all `*`, conjunto ilimitado de URLs, usa `__spa-fallback.html` e a rota not-found no cliente.

## Rodar e verificar

```powershell
npm ci --include=dev
npm run dev       # http://127.0.0.1:5174 — strictPort
npm run lint
npm run typecheck # typegen + tsc
npm run build
npm run preview   # http://127.0.0.1:4174 — build/client

$env:HERO_URL = 'http://127.0.0.1:4174/'
$env:HERO_QA_DIR = 'D:/Maestri/.maestri/floors/keytotwo-print-site--feati0-router/dist/i0-qa'
npm run verify:hero
```

O teste cobre os HTMLs e cargas diretas das 11 rotas em 320/390/1440 (33 casos), noindex, navegação de retorno, erros de console/hidratação e overflow horizontal, além dos testes existentes da hero. Seu helper de aba oculta espera CSS e hidratação: o DOM pré-renderizado pode existir antes das animações CSS. Artefatos de QA ficam em `dist/i0-qa`, ignorado pelo Git. Não houve auditoria visual manual neste incremento.

Resultado em 2026-10-08: `npm run lint`, `npm run typecheck` e `npm run build` com **exit 0**; `npm run verify:hero` em `/` de produção com **PASS/exit 0**. 33 cargas de rotas sem overflow horizontal, 10 layouts da hero (matriz original e texto ampliado), zero erros de execução e zero erros de console/hidratação. O teste aguarda também o fechamento do diálogo no estado React antes do próximo comando de teclado. Relatório: `dist/i0-qa/report.json`; logs de lint/typecheck/build/verify na mesma pasta. A hero em `http://127.0.0.1:5174/` foi aberta em Chromium sem erros de console/execução.

## Integração

- Publicar somente `build/client`. `build/server` é intermediário de pré-render, não um runtime para a VPS.
- Costura: acrescentar `build/` e `.react-router/` ao `.gitignore`, que não foi alterado por esta tarefa. O lint ignora esses diretórios pelo comando do package.json. Não versionar esses artefatos gerados.
- Costura: configurar o servidor estático da VPS, headers, cache, status HTTP 404 e fallback. O preview local de SPA responde 200 para caminhos desconhecidos e mostra not-found; isso não define a política HTTP de produção.
- CI, infraestrutura, Supabase CLI e deploy seguem os donos definidos na nota. Canonical, robots/sitemap e liberação de indexação ficam para I1. Todo este protótipo, inclusive as cascas privadas, permanece noindex.
