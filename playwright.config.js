import { defineConfig, devices } from '@playwright/test'

const PORT = 4099
export const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testMatch: /.*\.(e2e|a11y)\.js/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    testIdAttribute: 'data-testid',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node scripts/serve.js ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
})
