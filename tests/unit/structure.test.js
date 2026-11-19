import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

test('la page d’accueil existe', () => {
  assert.ok(existsSync(join(ROOT, 'index.html')), 'index.html manquant à la racine')
})

test('site.config.json est valide', () => {
  const configPath = join(ROOT, 'site.config.json')
  assert.ok(existsSync(configPath), 'site.config.json manquant')
  const config = readJson(configPath)
  assert.equal(typeof config.name, 'string')
})

test('chaque app déclarée a un index.html', () => {
  const configPath = join(ROOT, 'site.config.json')
  if (!existsSync(configPath)) return
  const config = readJson(configPath)
  const apps = Array.isArray(config.apps) ? config.apps : []
  for (const app of apps) {
    const slug = typeof app === 'string' ? app : app?.slug || app?.id
    if (!slug) continue
    assert.ok(
      existsSync(join(ROOT, 'apps', slug, 'index.html')),
      `apps/${slug}/index.html manquant`,
    )
  }
})

test('les dossiers apps/* contiennent un index.html', () => {
  const appsDir = join(ROOT, 'apps')
  if (!existsSync(appsDir)) return
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    assert.ok(
      existsSync(join(appsDir, entry.name, 'index.html')),
      `apps/${entry.name}/index.html manquant`,
    )
  }
})
