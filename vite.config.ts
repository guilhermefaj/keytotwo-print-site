import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), {
    name: 'blog-admin-directory',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        // Serve the static CMS before React Router handles /admin in development.
        if (request.url === '/admin' || request.url === '/admin/') request.url = '/admin/index.html'
        next()
      })
    },
  }, {
    name: 'blog-parsers-build-only',
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        const parser = Object.keys(chunk.modules).find(id => /node_modules[/\\](markdown-it|yaml)[/\\]/.test(id))
        if (parser) this.error(`Blog parser leaked into the client bundle: ${parser}`)
      }
      this.info('Blog: Markdown and YAML parsers excluded from client bundle.')
    },
  }, reactRouter()],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
})
