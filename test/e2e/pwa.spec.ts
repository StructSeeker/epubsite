/**
 * Offline reading, end to end (§9, appendix D).
 *
 * The site here is served with `Vary: Accept`, which is what a real static host
 * or CDN commonly sends, and what the local `serve` deliberately does not. Cache
 * matching honours `Vary` by comparing the *response's* listed headers against
 * the *request's*: a precached entry was fetched with `Accept: *∕*`, a
 * navigation sends `Accept: text/html,…`, so a request-object lookup misses and
 * the installed app opens a blank page with no network. These tests exist
 * because that failure is invisible while online and looks like a broken install
 * when it is really four lines of cache matching.
 */
import { expect, test, type Page } from '@playwright/test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { build } from '../../src/build/build'
import { sampleEpub } from '../fixtures/zip-writer'
import { writeEpub } from '../fixtures/tmp'

const WORKER = process.env['TEST_PARALLEL_INDEX'] ?? '0'
const workDir = resolve(process.cwd(), '.tmp', 'e2e', `${process.ppid}`, `pwa-w${WORKER}`)
const siteDir = join(workDir, 'site')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

let server: Server
let baseURL: string

test.beforeAll(async () => {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(siteDir, { recursive: true })

  const epubPath = await writeEpub(workDir, sampleEpub(), 'book.epub')
  await build(epubPath, { out: siteDir })

  server = createServer(handle)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  baseURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

/** A static host that varies on `Accept`, plus the 404 guide at the missing URL. */
function handle(request: IncomingMessage, response: ServerResponse): void {
  void (async () => {
    const pathname = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')
    const file = resolve(siteDir, `.${pathname}`)
    if (file !== siteDir && !file.startsWith(siteDir + sep)) {
      response.statusCode = 403
      response.end()
      return
    }

    const info = await stat(file).catch(() => undefined)
    const target = info?.isDirectory() === true ? join(file, 'index.html') : file
    const body = info === undefined ? undefined : await readFile(target).catch(() => undefined)

    response.setHeader('vary', 'Accept')
    if (body === undefined) {
      const guide = await readFile(join(siteDir, '404.html')).catch(() => undefined)
      response.statusCode = 404
      response.setHeader('content-type', MIME['.html'] as string)
      response.end(request.method === 'HEAD' ? undefined : guide)
      return
    }

    response.statusCode = 200
    response.setHeader('content-type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream')
    response.setHeader('content-length', body.byteLength)
    response.end(request.method === 'HEAD' ? undefined : body)
  })()
}

/**
 * Waits until the worker owns this page and the shell is really in the cache.
 *
 * `navigator.serviceWorker.ready` alone is not enough: it resolves while the
 * worker is still activating, and `clients.claim()` has not run yet, so a reload
 * at that instant is a network request and the test passes or fails by timing.
 */
async function offlineReady(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (navigator.serviceWorker.controller === null) return false
          const cache = await caches.open('epubsite-v1')
          const shell = new URL('/epubsite.html', location.origin).href
          return (await cache.match(shell, { ignoreVary: true })) !== undefined
        }),
      { timeout: 20_000 },
    )
    .toBe(true)
}

test('a reload while offline still opens the reader, even though the host varies on Accept', async ({
  page,
  context,
}) => {
  await page.goto(`${baseURL}/epubsite.html`)
  await expect(page.locator('#epubsite-book-title')).toHaveText('Sample Book')
  await offlineReady(page)

  await context.setOffline(true)
  await page.reload()

  // The shell came from the cache, and so did the runtime, its data and the
  // chapter the sidebar then loads.
  await expect(page.locator('#epubsite-book-title')).toHaveText('Sample Book')
  await page.click('#epubsite-toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epubsite-content h1')).toHaveText('Chapter 1')
})

test('a token deep link enters the reader while offline (§8.2)', async ({ page, context }) => {
  await page.goto(`${baseURL}/epubsite.html`)
  await offlineReady(page)

  await context.setOffline(true)
  // No such file exists, so this is a navigation the network cannot answer. The
  // worker must serve the cached guide, which redirects into the cached shell.
  await page.goto(`${baseURL}/OEBPS/text/@ch01.xhtml`)

  await expect(page.locator('#epubsite-content h1')).toHaveText('Chapter 1')
  expect(new URL(page.url()).pathname).toBe('/OEBPS/text/ch01.xhtml')
})
