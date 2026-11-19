import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const IGNORE = new Set(['node_modules', '.git', '.cache', '.api', 'vendor', 'test-results', 'playwright-report'])

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.html')) out.push(full)
  }
  return out
}

const files = walk(ROOT).map((f) => relative(ROOT, f))
if (files.length === 0) {
  console.log('Aucun fichier HTML à valider.')
  process.exit(0)
}

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['html-validate', ...files],
  { cwd: ROOT, stdio: 'inherit' },
)
