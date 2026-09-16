/**
 * The local development server (spec §9.1).
 *
 * It exists for one reason: **no general-purpose static server implements custom
 * 404 semantics.** `python -m http.server`, `npx serve` and friends answer a
 * missing path with their own error page and — crucially — they do not serve a
 * *site's* `404.html` at the *missing* URL. Token paths depend on exactly that,
 * so without this server the whole entry protocol is untestable locally, and the
 * first time it is exercised is in production.
 *
 * What §9.1 requires, and why each item is not optional:
 *
 *   custom 404      status 404, the body of `404.html`, and the **URL unchanged**.
 *                   Rewriting the URL (or redirecting) would erase the token the
 *                   guide needs to read. The URL is the input.
 *   `.xhtml` MIME   served as `application/xhtml+xml`, which is what a real host
 *                   does and what makes the browser apply XML rules. A server
 *                   that gets this wrong hides a whole class of book defect.
 *   no listing      a directory without an index is a 404, not a file inventory.
 *                   Serving a listing would publish the entire book as a
 *                   browsable tree (§12).
 *
 * Two behaviours are deliberately absent:
 *
 *   - **Rewrite simulation.** §9.1 mentions it as an option "for comparison
 *     testing", but `--hosting rewrite` is the documented gap (§8.4), and a
 *     simulator for a mode that produces no artifacts would let us test a
 *     behaviour we do not have. It arrives with the mode or not at all.
 *   - **Live reload.** Not in the spec, and not free: it changes the documents
 *     the browser sees, which is precisely what these tests are here to observe.
 *
 * The path-traversal guard below *is* reachable — unlike the one that was removed
 * from the ZIP reader. There, a library already guaranteed the property and the
 * guard could not fire; here an HTTP request path is attacker-controlled input
 * that Node does not normalise for us, so the check is load-bearing.
 */
import { createServer, type Server } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ServeOptions {
  /** Directory to serve. Resolved against the caller's cwd by the CLI. */
  root: string
  /** 0 picks a free port, which is what the tests use. */
  port?: number
  host?: string
}

export interface RunningServer {
  /** e.g. `http://127.0.0.1:4173` — no trailing slash. */
  readonly url: string
  readonly port: number
  close(): Promise<void>
}

/**
 * Types a static host would send.
 *
 * `charset=utf-8` is included where it belongs. Omitting it on HTML lets a
 * browser pick a legacy encoding for a book whose markup is UTF-8 — a defect
 * that looks like mangled text in the book, not like a server problem.
 */
const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  // §9.1. The whole point of serving `.xhtml` correctly is that the browser then
  // treats it as XML, which is how the book was authored.
  '.xhtml': 'application/xhtml+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.ncx': 'application/x-dtbncx+xml',
  '.opf': 'application/oebps-package+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '': 'application/octet-stream',
}

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const root = resolve(options.root)
  const host = options.host ?? '127.0.0.1'

  const server = createServer((request, response) => {
    handle(request, response, root).catch((error: unknown) => {
      // A failure here is a bug in this file, not a client error, so it says so
      // rather than pretending to be a 404.
      response.statusCode = 500
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(`epubsite serve: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  })

  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', fail)
      done()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    await close(server)
    throw new Error('the server did not report a port')
  }

  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    async close() {
      await close(server)
    },
  }
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((done) => server.close(() => done()))
}

async function handle(request: IncomingMessage, response: ServerResponse, root: string): Promise<void> {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('allow', 'GET, HEAD')
    response.end()
    return
  }

  const file = targetFile(request.url ?? '/', root)
  if (file === null) {
    await notFound(response, root, method)
    return
  }

  const info = await statOrUndefined(file)
  if (info === undefined || info.isDirectory()) {
    // A directory is only served if it has an index. Anything else is a 404 —
    // §9.1's "no directory listing", and §12's warning about what a listing
    // would publish.
    const index = info?.isDirectory() === true ? await statOrUndefined(join(file, 'index.html')) : undefined
    if (index === undefined) {
      await notFound(response, root, method)
      return
    }
    await send(response, join(file, 'index.html'), method)
    return
  }

  await send(response, file, method)
}

/**
 * Maps a request URL to a file inside the root, or `null` if it escapes.
 *
 * `decodeURIComponent` first, so `%2e%2e%2f` is caught as `../`; Node does not
 * normalise `req.url`, and a server that resolves the raw string would happily
 * walk out of the site.
 */
function targetFile(url: string, root: string): string | null {
  const pathname = url.split('?')[0]?.split('#')[0] ?? '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const candidate = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`)
  // The guard is reachable: the request path is attacker-controlled input.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  return candidate
}

async function notFound(response: ServerResponse, root: string, method: string): Promise<void> {
  const guide = join(root, '404.html')
  const body = await readFile(guide).catch(() => undefined)
  response.statusCode = 404
  response.setHeader('content-type', 'text/html; charset=utf-8')
  // The URL is deliberately left alone: it is the token the guide reads.
  if (method === 'HEAD') {
    response.setHeader('content-length', body?.byteLength ?? 0)
    response.end()
    return
  }
  response.end(body ?? 'Not found\n')
}

async function send(response: ServerResponse, file: string, method: string): Promise<void> {
  const body = await readFile(file)
  response.statusCode = 200
  response.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? MIME[''] as string)
  // Always set, including for HEAD. Omitting it on a HEAD response makes a
  // browser report the request as aborted once the connection is reused, which
  // turns a clean network log into a misleading one — it cost an hour during the
  // token work, and it was only the throwaway test server that had the bug.
  response.setHeader('content-length', body.byteLength)
  response.setHeader('cache-control', 'no-store')
  response.end(method === 'HEAD' ? undefined : body)
}

async function statOrUndefined(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}
