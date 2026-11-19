import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UI = join(ROOT, 'node_modules/@kewinmarchand/boilerplates-ui')

if (!existsSync(UI)) {
  console.log('boilerplates-ui non installé, vendor ignoré.')
  process.exit(0)
}

const outDir = join(ROOT, 'vendor/boilerplates-ui')
mkdirSync(outDir, { recursive: true })

// Tokens et CSS des composants dans une feuille unique (couche bui).
const inlineImports = (path) =>
  readFileSync(join(UI, path), 'utf8').replace(/^@import '\.\/(.+)';$/gm, (_, file) =>
    inlineImports(join(dirname(path), file)).trim(),
  )

const tokensCss = readFileSync(join(UI, 'packages/tokens/generated/tokens.css'), 'utf8')
const componentsCss = inlineImports('packages/css/index.css')
writeFileSync(join(outDir, 'boilerplates-ui.css'), `@layer bui {\n${tokensCss}\n${componentsCss}\n}\n`)

// Comportements vanilla.
if (existsSync(join(UI, 'packages/vanilla/src'))) {
  cpSync(join(UI, 'packages/vanilla/src'), join(outDir, 'vanilla'), { recursive: true })
}

console.log('Vendor boilerplates-ui prêt dans vendor/boilerplates-ui/.')
