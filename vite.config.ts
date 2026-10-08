import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
})
