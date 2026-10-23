import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// O admin (admin.keytotwo.com.br) é um SPA à parte do site: outro build, outro contêiner, sem pré-renderização.
// Lê as mesmas VITE_* do site (.env.local na raiz); só chaves publicáveis entram no navegador.
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  root: path('.'),
  envDir: path('..'),
  // Só os ícones do Kito (favicon); o resto das imagens entra pelo import, com hash.
  publicDir: path('../public/media/icons'),
  plugins: [tailwindcss()],
  build: {
    // Fora de build/: o build do site (react-router build) limpa a pasta inteira.
    outDir: path('dist'),
    emptyOutDir: true,
    // O "use client" do react-router não significa nada num SPA; o aviso só polui o build.
    rolldownOptions: { onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning) } },
  },
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
})
