import { defineConfig } from '@playwright/test'

const port = Number(process.env.E2E_PORT || 4174)
const baseURL = `http://127.0.0.1:${port}`
// O admin (admin/, build em admin/dist) roda na porta seguinte, servido como SPA.
const adminURL = `http://127.0.0.1:${port + 1}`

// Smoke tests run against the prerendered build (build/client) served by `npm run preview`.
// Run `npm run build` and `npm run build:admin` first; the CI is expected to do so before `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Testes de varredura visitam dezenas de rotas, e cada navegação espera a página ficar interativa
  // (tests/e2e/fixtures/test.ts): o JS só começa depois da primeira pintura.
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: 'admin/**' },
    { name: 'admin', testDir: 'tests/e2e/admin', use: { browserName: 'chromium', baseURL: adminURL } },
  ],
  webServer: [{
    command: `node node_modules/sirv-cli/bin.js build/client --host 127.0.0.1 --port ${port} --single __spa-fallback.html`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  }, {
    command: `node node_modules/sirv-cli/bin.js admin/dist --host 127.0.0.1 --port ${port + 1} --single`,
    url: adminURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  }],
})
