/**
 * Phase 0 — the I1 gate (spec §14).
 *
 * "P0 must come first. I1 is the single point of dependency for the whole
 *  design, and it is guaranteed by htmx's upstream behaviour rather than by our
 *  own code. Two hours of experiment settles the 'do we need <base>?' question
 *  once and for all."
 *
 * The server is inlined on purpose: this is disposable code whose only job is
 * to produce a verdict. Phase 6 replaces it with `epubsite serve`.
 */
import { expect, test, type Page, type Response } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { deflateSync } from 'node:zlib'

type Probe = {
  beforeSwapPath: string | null
  pushedPath: string | null
  contentAtPush: string | null
  afterSwapPath: string | null
  requests: string[]
}

const SITE_ROOT = resolve(process.cwd(), 'test', 'spike', 'site')
const HTMX_PATH = resolve(process.cwd(), 'vendor', 'htmx.esm.js')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  // Faithful to §9.1 and to what static hosts do for .xhtml. If htmx dislikes
  // this content type, this spike is exactly where we want to find out.
  '.xhtml': 'application/xhtml+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
}

let server: Server
let baseURL: string
let htmxSource: Buffer

test.beforeAll(async () => {
  htmxSource = await readFile(HTMX_PATH)
  server = createServer(handleRequest)
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('no port')
      baseURL = `http://127.0.0.1:${address.port}`
      done()
    })
  })
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

/** Collects every 4xx/5xx and every failed request, so "zero 4xx" is a real assertion. */
function watch(page: Page): string[] {
  const bad: string[] = []
  page.on('response', (res: Response) => {
    if (res.status() >= 400) bad.push(`${res.status()} ${res.url()}`)
  })
  page.on('requestfailed', (req) => {
    bad.push(`FAILED ${req.url()} ${req.failure()?.errorText ?? ''}`)
  })
  return bad
}

async function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => (globalThis as unknown as { __i1: Probe }).__i1)
}

// Scoped to [data-shell] so the deliberately-un-absolutized negative control
// (see the I2 control below) can never be selected by accident.
const sidebar = (page: Page, label: string) =>
  page.locator('#toc a[data-shell]', { hasText: label })

test.beforeEach(async ({ page }) => {
  await page.goto(`${baseURL}/epubsite.html`)
})

test('I1: the sidebar keeps its DOM node identity across navigation', async ({ page }) => {
  const bad = watch(page)
  const tocBefore = await page.$('#toc')
  expect(tocBefore).not.toBeNull()

  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')

  const isSameNode = await tocBefore!.evaluate(
    (el) => el.isConnected && document.querySelector('#toc') === el,
  )
  expect(isSameNode, 'sidebar must be outside the swap target (§5.1)').toBe(true)
  expect(bad).toEqual([])
})

test('I1: the URL is pushed before the DOM is swapped, so the base is already correct', async ({
  page,
}) => {
  const bad = watch(page)
  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')

  const probe = await readProbe(page)

  // htmx:beforeSwap is the *veto hook*: it fires before htmx begins swapping,
  // so the URL is legitimately still the old one there. Asserting the opposite
  // was this spike's own bug on the first run, not a flaw in the design.
  expect(probe.beforeSwapPath).toBe('/epubsite.html')

  // The push happens inside swap()'s beforeSwapCallback, which doSwap() calls
  // as its first statement. htmx's own source comment at that site reads: "if we
  // need to save history, do so, before swapping so that relative resources
  // have the correct base URL".
  expect(probe.pushedPath, 'the URL must already be the chapter URL at push time').toBe(
    '/text/ch01.xhtml',
  )
  expect(probe.contentAtPush, 'the swap must not have happened yet').toContain('Landing page')

  expect(probe.afterSwapPath).toBe('/text/ch01.xhtml')
  expect(new URL(page.url()).pathname).toBe('/text/ch01.xhtml')
  expect(bad).toEqual([])
})

/*
 * The actual proof of I1 — and the test that would have caught a regression the
 * naive version of this spike could not.
 *
 * `../Images/pic.png` is NOT a discriminator: '..' collapses to the site root
 * whether the base is `/epubsite.html` or `/text/ch01.xhtml`, so both bases
 * resolve it to the same URL and the test passes even with the bug present.
 * A bare sibling reference is a discriminator: from `/` it resolves to
 * `/ch01-local.png` (404), from `/text/` to `/text/ch01-local.png` (200).
 */
test('I1: a sibling relative URL only resolves if the base really moved', async ({ page }) => {
  const bad = watch(page)
  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')

  const width = await page.locator('#local').evaluate((el: HTMLImageElement) => el.naturalWidth)
  expect(width, 'src="ch01-local.png" must resolve against /text/, not against /').toBeGreaterThan(0)
  expect(bad).toEqual([])
})

test('I1: relative image URLs resolve from a deeply nested chapter', async ({ page }) => {
  const bad = watch(page)
  await sidebar(page, 'Chapter 3').click()
  await expect(page.locator('#epub-content')).toContainText('chapter three body text')

  expect(new URL(page.url()).pathname).toBe('/text/deep/part/ch03.xhtml')

  // Books really do use multi-level ../ paths, so this must work. Note it is not
  // by itself proof of I1 (see the sibling-URL test below for that).
  const up = await page.locator('#pic3').evaluate((el: HTMLImageElement) => el.naturalWidth)
  expect(up, 'a 3-level-up ../Images path must resolve').toBeGreaterThan(0)

  const sibling = await page.locator('#local3').evaluate((el: HTMLImageElement) => el.naturalWidth)
  expect(sibling, 'a sibling path must resolve against /text/deep/part/').toBeGreaterThan(0)

  expect(bad).toEqual([])
})

test('I2: sidebar links still resolve after pushState moved the document base', async ({ page }) => {
  const bad = watch(page)

  await sidebar(page, 'Chapter 3').click()
  await expect(page.locator('#epub-content')).toContainText('chapter three body text')

  // Without data-shell absolutization this resolves to /text/text/ch01.xhtml
  // and 404s: the base directory is now /text/deep/part/.
  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')

  await sidebar(page, 'Chapter 2').click()
  await expect(page.locator('#epub-content')).toContainText('chapter two body text')

  expect(bad, 'absolutization against SITE_ROOT is sufficient for I2').toEqual([])
})

/*
 * Negative control for I2. Test 7 above shows absolutization is *sufficient*;
 * this one shows it is *necessary*, so we are not carrying the complexity for
 * nothing. Both halves matter: a mitigation nobody can justify gets deleted by
 * the next person who reads it.
 */
test('I2 negative control: an un-absolutized shell link double-prefixes and 404s', async ({
  page,
}) => {
  const bad = watch(page)

  await sidebar(page, 'Chapter 3').click()
  await expect(page.locator('#epub-content')).toContainText('chapter three body text')

  // The document base is now /text/deep/part/, so the untouched relative href
  // resolves to /text/deep/part/text/ch02.xhtml.
  await page.locator('#unfixed').click()

  await expect
    .poll(() => bad.length, { message: 'the un-absolutized link must 404' })
    .toBeGreaterThan(0)
  expect(
    bad.some((entry) => entry.startsWith('404') && entry.includes('/text/deep/part/text/ch02.xhtml')),
    `expected a double-prefixed 404, got: ${bad.join(', ')}`,
  ).toBe(true)
})

test('I1: a loading="lazy" image still resolves after the content is swapped in', async ({ page }) => {
  const bad = watch(page)
  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')

  const eager = await page.locator('#pic').evaluate((el: HTMLImageElement) => el.naturalWidth)
  expect(eager).toBeGreaterThan(0)

  await page.locator('#fn1').scrollIntoViewIfNeeded()
  await expect
    .poll(async () => page.locator('#lazy').evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0)

  expect(bad).toEqual([])
})

test('I1: a pure-fragment link is handled natively, without re-requesting the chapter', async ({
  page,
}) => {
  const bad = watch(page)
  let chapterRequests = 0
  page.on('request', (req) => {
    if (req.url().includes('/text/')) chapterRequests += 1
  })

  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')
  const requestsAfterNavigation = chapterRequests

  await page.locator('#fn-link').click()
  await expect(page).toHaveURL(/#fn1$/)

  expect(new URL(page.url()).pathname, 'a pure fragment must not change the path').toBe(
    '/text/ch01.xhtml',
  )
  expect(chapterRequests, 'htmx must skip pure # links (§5.7)').toBe(requestsAfterNavigation)
  expect(bad).toEqual([])
})

test('I1: chapter scripts do not execute (allowScriptTags=false, spec §10)', async ({ page }) => {
  const bad = watch(page)
  await sidebar(page, 'Chapter 2').click()
  await expect(page.locator('#epub-content')).toContainText('chapter two body text')

  const executed = await page.evaluate(
    () => (globalThis as unknown as { __evil?: boolean }).__evil === true,
  )
  expect(executed, 'htmx must drop <script> in swapped content').toBe(false)
  expect(bad).toEqual([])
})

/*
 * KNOWN GAP, not implemented yet: §5.7 requires same-chapter-plus-fragment
 * links (`ch01.xhtml#para1` while reading ch01) to short-circuit in
 * htmx:beforeRequest, so the chapter is not re-fetched and re-rendered.
 * Without it htmx performs a real request. Phase 3 flips this to the assertion
 * below; it is recorded now so the requirement is not lost.
 */
test.fixme('I1: a same-chapter link with a fragment short-circuits', async ({ page }) => {
  const bad = watch(page)
  await sidebar(page, 'Chapter 1').click()
  await expect(page.locator('#epub-content')).toContainText('chapter one body text')

  const probeBefore = await readProbe(page)
  await page.locator('#same-link').click()
  await expect(page).toHaveURL(/#para1$/)

  const probeAfter = await readProbe(page)
  expect(probeAfter.requests).toHaveLength(probeBefore.requests.length)
  expect(bad).toEqual([])
})

// ---------------------------------------------------------------------------
// Disposable static server: faithful where it matters (MIME types, no
// directory listing, generated-but-valid PNGs) and nothing more.
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  const decoded = decodeURIComponent(pathname)

  if (decoded === '/htmx.esm.js') return send(res, 200, MIME['.js']!, htmxSource)

  // Distinct solid colours so a test can tell the two images apart.
  if (decoded === '/Images/pic.png') return send(res, 200, MIME['.png']!, solidPng(200, 30, 30))
  if (decoded === '/Images/lazy.png') return send(res, 200, MIME['.png']!, solidPng(30, 30, 200))
  // Sibling of ch01.xhtml: the I1 discriminator (see the spec below).
  if (decoded === '/text/ch01-local.png') return send(res, 200, MIME['.png']!, solidPng(30, 200, 30))
  if (decoded === '/text/deep/part/ch03-local.png') {
    return send(res, 200, MIME['.png']!, solidPng(200, 200, 30))
  }

  const filePath = resolve(SITE_ROOT, `.${decoded}`)
  if (!filePath.startsWith(SITE_ROOT + sep)) return send(res, 403, 'text/plain', 'forbidden')

  try {
    const body = await readFile(filePath)
    send(res, 200, MIME[extname(filePath)] ?? 'application/octet-stream', body)
  } catch {
    // No directory listing (§12), and no 404.html guide yet.
    send(res, 404, 'text/plain; charset=utf-8', `not found: ${decoded}`)
  }
}

function send(res: ServerResponse, status: number, type: string, body: Buffer | string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

// --- minimal valid PNG, so `naturalWidth > 0` can never fail spuriously -----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

function solidPng(r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, r, g, b]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
