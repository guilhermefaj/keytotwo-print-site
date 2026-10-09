import { defineConfig } from '@playwright/test'

const port = Number(process.env.E2E_PORT || 4174)
const baseURL = `http://127.0.0.1:${port}`

// Smoke tests run against the prerendered build (build/client) served by `npm run preview`.
// Run `npm run build` first; the CI is expected to do so before `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node node_modules/sirv-cli/bin.js build/client --host 127.0.0.1 --port ${port} --single __spa-fallback.html`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
