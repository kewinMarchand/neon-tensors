import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.SITE_ROOT
  ? `${resolve(process.env.SITE_ROOT)}/`
  : `${resolve(fileURLToPath(new URL('..', import.meta.url)))}/`
const PORT = Number(process.argv[2] ?? 4098)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.xml': 'text/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

const isFile = async (path) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const decodePath = (pathname) => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

const resolveFile = async (pathname) => {
  const decoded = decodePath(pathname)
  if (decoded === undefined) return undefined
  const path = join(ROOT, normalize(decoded))
  if (!path.startsWith(ROOT)) return undefined
  for (const candidate of [path, join(path, 'index.html')]) {
    if (await isFile(candidate)) return candidate
  }
  return undefined
}

const send = async (request, response, status, file, extraHeaders = {}) => {
  const extension = extname(file)
  const headers = {
    ...extraHeaders,
    'Content-Type': TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  }
  if (request.method === 'HEAD') {
    response.writeHead(status, headers)
    response.end()
    return
  }
  if (extension === '.html') {
    const body = await readFile(file)
    response.writeHead(status, headers)
    response.end(body)
    return
  }
  response.writeHead(status, headers)
  createReadStream(file).pipe(response)
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Method Not Allowed')
    return
  }
  const file = await resolveFile(pathname)
  if (file) await send(request, response, 200, file)
  else {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not Found')
  }
}).listen(PORT, () => {
  console.log(`Serveur statique prêt sur http://localhost:${PORT}`)
})
