import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function appSlugs() {
  const configPath = join(ROOT, 'site.config.json')
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      if (Array.isArray(config.apps) && config.apps.length) {
        return config.apps
          .map((a) => (typeof a === 'string' ? a : a?.slug || a?.id))
          .filter(Boolean)
      }
    } catch {
      // fallback below
    }
  }
  const appsDir = join(ROOT, 'apps')
  if (!existsSync(appsDir)) return []
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(appsDir, e.name, 'index.html')))
    .map((e) => e.name)
}

test('accueil répond', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.ok()).toBeTruthy()
  await expect(page.locator('body')).toBeVisible()
})

for (const slug of appSlugs().slice(0, 20)) {
  test(`app ${slug} répond`, async ({ page }) => {
    const response = await page.goto(`/apps/${slug}/`)
    expect(response?.ok()).toBeTruthy()
    await expect(page.locator('body')).toBeVisible()
  })
}
