import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('accueil sans violation axe critique/sérieuse', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page })
    .disableRules(['color-contrast']) // peut dépendre du thème; garder comme smoke léger
    .analyze()
  const serious = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact))
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
})
