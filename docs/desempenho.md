# Desempenho (Lighthouse no celular)

Meta: Lighthouse **≥ 95 no celular** nas páginas públicas (responsável, 2026-10-16).

## Resultado (mediana de 3 rodadas, build com gzip)

Medido com o catálogo real, numa origem liberada pelo CORS das functions (5178):

| Página | Nota | FCP | LCP | CLS |
|---|---|---|---|---|
| Início | 99 | 1,06 s | 1,66 s | 0,017 |
| Loja | 97 | 1,06 s | 2,56 s | 0,019 |
| Pacote (`/loja/colecao-fundadores`) | 96 | 1,06 s | 2,71 s | 0 |
| Rabisque (`/loja/rabisque-e-adivinhe`) | 100 | 1,06 s | 1,81 s | 0 |

Na origem 4176, sem catálogo, Ajuda, Entrar e Blog deram 100, Tabuleiro 99 e Rapadura 98.

Antes: Início 59, Loja 61, produto 60, Ajuda 83 (só depois do gzip).

## O que foi feito, e por quê

O Lighthouse móvel simula 4G lento. No LCP, ele conta tudo o que foi pedido antes do LCP observado, exceto imagens de prioridade baixa. Os cerca de 30 `modulepreload` (uns 200 KB de JS), o logo e a cena da hero entravam todos nessa conta.

1. **Gzip no nginx** (`nginx.conf`): JS e CSS saíam sem compressão.
2. **Um só CSS** (`src/app.css`, importado com `?url` e `precedence` no `root.tsx`): o React 19 o coloca antes dos scripts no `<head>`.
3. **Boot depois da primeira pintura** (`scripts/html-priorities.mjs`, que roda no `npm run build`):
   - os `modulepreload` saem do HTML;
   - o boot do React Router roda depois do FCP real (via `PerformanceObserver`, com limite de 2,5 s para abas em segundo plano);
   - os `modulepreload` são recriados nesse momento, sem cascata de downloads.
   - As páginas já chegam completas no HTML, então nada some. A interação começa logo depois da primeira pintura.
4. **Hidratação depois do primeiro quadro** (`src/entry.client.tsx`).
5. **Prioridades das imagens:**
   - o logo e a cena da hero usam `fetchpriority="low"`;
   - o atlas do Kito só desce quando a cena roda pela primeira vez, com prioridade baixa (`HeroScene.tsx`);
   - a capa principal (galeria do produto e banner da Loja) usa `fetchpriority="high"`, sem lazy.
6. **Capas em 640 e 800 px** (`scripts/prepare-game-covers.mjs`; o teto de 800 px é também o limite para as folhas dos jogos pagos não darem para usar).
7. **Fontes do título** com preload e `preconnect` ao Supabase.
8. **Loja:** o "Consultando disponibilidade…" do topo fica só para leitor de tela, porque empurrava o banner (CLS).

**O que não mudou:**
- **Atlas do Kito (`kito-pixel-atlas.webp`, 290 KB, sem perdas):** é arte em resolução nativa e o AVIF sem perdas fica 2,7 vezes maior.
- **supabase-js (59 KB com gzip):** continua no boot, mas agora depois da pintura.

## Custo conhecido

O JS começa a baixar depois da primeira pintura, então botões como "Adicionar à sacola" respondem um pouco mais tarde que antes. Numa navegação normal, o boot começa de 10 a 20 ms depois do FCP. Os e2e de interação passaram em duas repetições.

## Testes e2e

Com o JS começando depois da primeira pintura, um teste podia clicar ou teclar antes da hidratação (no CI, o menu móvel e o formulário de senha falharam assim).

- **Marcador:** o `root.tsx` liga `html[data-interactive="true"]` quando a página já responde, ou seja, hidratada e com a sessão lida.
- **Fixture:** as specs importam `test` de `tests/e2e/fixtures/test.ts`, em que `page.goto` e `page.reload` esperam esse marcador.
- **Timeout:** o global subiu para 60 s, por causa dos testes que varrem dezenas de rotas.
- **Usuários reais:** um toque, uma tecla ou um foco antes do boot já inicia o download do JS.

## Como medir localmente

1. `npm run build`.
2. Servir `build/client` com gzip, imitando o nginx:
   - o `sirv` não comprime;
   - um servidor Node de umas 20 linhas resolve (`try_files $uri/index.html $uri`, gzip em texto).
3. Rodar o Lighthouse 12 com Chrome do Playwright:
   - `CHROME_PATH=<chromium do Playwright> npx lighthouse@12.8.2 <url> --only-categories=performance --chrome-flags="--headless=new"`;
   - 3 rodadas por página, usando a mediana.
4. Para medir a Loja e os produtos com o catálogo real, a origem precisa estar no `ALLOWED_ORIGINS` das functions hospedadas (hoje: o domínio, o teste, o admin e a 5178). Em outra origem, o catálogo falha por CORS e aparece um erro que gera CLS artificial.
