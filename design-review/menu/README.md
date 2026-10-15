# Menu — evidências do I6

Direção vigente: `DESIGN.md`, Folha de recorte. Mantidos tipografia, tokens, ícones Tabler, Sheet, foco e movimento existentes. Nenhuma imagem ou conteúdo comercial foi criado.

As capturas WebP mostram o cabeçalho em 375/1280 px, o menu aberto e o estado da Loja sem CTA duplicado. São geradas por `tests/e2e/menu.spec.ts` com Playwright e Sharp. Para reproduzir, definir `VITE_SITE_STAGE=test` ou `preview`, executar `npm run build` e depois `E2E_PORT=4174 MENU_CAPTURE=1 npx playwright test tests/e2e/menu.spec.ts --workers=1` (variáveis com `$env:` no PowerShell).

O loader da raiz envia somente `{ hasBlogPosts: boolean }`. A presença do Blog segue os posts disponíveis no stage do build, como em `routes.ts`: o rascunho atual aparece em test/preview; live o exclui. O E2E confere o dado no prerender e no fallback, a recuperação pela 404 e navegação SPA sem requisição adicional de `.data` nas rotas sem loader próprio.

## Auditoria Impeccable

Integridade aprovada: reaproveitamento dos componentes e tokens vigentes, sem CSS novo; detector nos dois componentes retornou `[]`. Nenhuma ocorrência de `#comprar` ou `'P001'` em SiteHeader/SiteFooter. A troca do CTA vazio do CartDrawer pertence ao I7, conforme coordenação.

| Dimensão | Nota | Evidência |
| --- | --- | --- |
| Acessibilidade | 4/4 | Axe WCAG 2/2.1/2.2 AA sem violações nos estados capturados; teclado, Escape e retorno de foco cobertos. |
| Desempenho | 3/4 | Removidos scroll-spy e leituras de layout por seção; listener passivo e gaveta lazy preservados. Sem benchmark de desempenho. |
| Tokens | 4/4 | Classes e paleta existentes; nenhuma alteração de tema. O produto usa tema claro. |
| Responsividade | 4/4 | Viewports Chromium de 320 a 1440 e texto 200%; menu sem overflow. Dispositivo físico não testado. |
| Integridade | 4/4 | Detector sem achados; inspeção visual de desktop e menu móvel coerente com DESIGN.md. |

Total: 19/20. Nenhum problema P0–P3 identificado no escopo. Preservados os estados de conta, sacola e área privada. As verificações medem os cenários descritos, não certificam toda a aplicação.
