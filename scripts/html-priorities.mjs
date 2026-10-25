// Pós-build (desempenho, 2026-10-16). As páginas chegam pré-renderizadas e completas no HTML, então o JS só
// precisa chegar para a interação. Aqui, em build/client/**/*.html:
// 1. saem os <link rel="modulepreload"> do <head>;
// 2. o boot do React Router (o <script type="module"> que importa manifest, rotas e entry.client) passa a
//    rodar depois da primeira pintura (FCP), recriando os modulepreload nesse momento (sem cascata de downloads).
// Assim o primeiro quadro, e o LCP, dependem só de HTML, CSS, fontes e da imagem principal. O dev server não muda.
// 3. (segurança, 2026-10-25) todo <script> que roda, menos os dados JSON-LD, leva nonce="__CSP_NONCE__"; o nginx troca o
//    marcador pelo nonce de cada resposta e o CSP só aceita scripts com ele (nginx.conf). Sem nginx (dev, preview e os
//    testes), o atributo fica e não faz nada.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('build/client')
const preloadTag = /<link rel="modulepreload" href="([^"]+)"\/>/g
const bootTag = /<script type="module" async="">([\s\S]*?)<\/script>/
const NONCE_MARKER = '__CSP_NONCE__'
const scriptOpen = /<script(?![^>]*\snonce=)(?![^>]*type="application\/ld\+json")(\s[^>]*)?>/g
const withNonces = html => html.replace(scriptOpen, (_, attrs = '') => `<script nonce="${NONCE_MARKER}"${attrs}>`)

function rewriteBoot(body, preloads) {
  // Cada import estático vira import dinâmico com await, na mesma ordem; o resto do boot (montagem das rotas
  // divididas, __reactRouterRouteModules, import do entry.client) fica igual.
  const steps = body
    .replace(/^import \* as (\w+) from ("[^"]+");$/gm, 'const $1 = await import($2);')
    .replace(/^import ("[^"]+");$/gm, 'await import($1);')
  if (/^\s*import\s+[^(\s]/m.test(steps) || !steps.includes('__reactRouterRouteModules')) throw new Error('boot do React Router em formato inesperado')
  return `<script type="module">
const boot = async () => {
  for (const href of ${JSON.stringify(preloads)}) { const link = document.createElement('link'); link.rel = 'modulepreload'; link.href = href; document.head.appendChild(link) }
${steps}
};
// Começa depois da primeira pintura real (FCP). Aba em segundo plano não pinta: o limite garante o boot.
let started = false;
const start = () => { if (started) return; started = true; requestAnimationFrame(() => setTimeout(boot, 0)) };
try { new PerformanceObserver((list, observer) => { if (list.getEntriesByName('first-contentful-paint').length) { observer.disconnect(); start() } }).observe({ type: 'paint', buffered: true }) } catch { start() }
setTimeout(start, 2500);
// Quem toca ou digita antes do boot não espera a pintura: o JS começa na hora.
for (const type of ['pointerdown', 'keydown', 'touchstart', 'focusin']) addEventListener(type, start, { once: true, capture: true, passive: true });
</script>`
}

let pages = 0
let signed = 0
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { await walk(full); continue }
    if (!entry.name.endsWith('.html')) continue
    const html = await readFile(full, 'utf8')
    const preloads = [...html.matchAll(preloadTag)].map(match => match[1])
    const boot = html.match(bootTag)
    const rebooted = boot && preloads.length ? html.replace(preloadTag, '').replace(bootTag, rewriteBoot(boot[1], preloads)) : html
    if (rebooted !== html) pages++
    const next = withNonces(rebooted)
    if (next !== rebooted) signed++
    if (next !== html) await writeFile(full, next)
  }
}
await walk(root)
console.log(`html-priorities: boot depois do primeiro quadro em ${pages} páginas; nonce do CSP em ${signed}`)
