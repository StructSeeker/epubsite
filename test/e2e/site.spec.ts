/**
 * The reader, end to end (spec §13.2).
 *
 * Every case here is a **detector**, not a smoke test. §13.1 explains why: the
 * design depends on a handful of premises that fail silently — a URL base that
 * moved when it should not have, a request that went out when it should not
 * have, a script that ran when it should not have — and each has a crisp
 * observable that goes red the moment the premise breaks.
 *
 * The site is built by the real library and served by the real `serve`
 * implementation (§9.1), so what is being tested is the artifact a user gets, not
 * a mock of it. The server is not optional: the token protocol *is* custom 404
 * semantics, and a server that answers a missing path with its own error page
 * would make the whole entry chain untestable.
 */
import { expect, test, type Page, type Response } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from '../../src/build/build'
import { startServer, type RunningServer } from '../../src/serve/server'
import { sampleEpub } from '../fixtures/zip-writer'
import { writeEpub } from '../fixtures/tmp'

/** A real 1×1 PNG, so `naturalWidth` can be asserted rather than only the status. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const CH01 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>One</title>
  <link rel="stylesheet" href="../Styles/book.css"/>
  <style>@import url("../Styles/extra.css"); p { text-indent: 2em }</style>
</head>
<body class="calibre">
  <h1>One</h1>
  <p id="sec1">First paragraph.</p>
  <p><img src="../Images/pic.png" alt="a pixel"/></p>
  <p><a href="./ch01.xhtml#sec1">back to the top</a></p>
  <script>window.__pwned = true</script>
</body>
</html>`

const CH02 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Two</title></head>
<body>
  <h1>Two</h1>
  <p id="fn1">A footnote target.</p>
  <p><img src="../../Images/pic.png" loading="lazy" alt="a lazy pixel"/></p>
</body>
</html>`

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc"><ol>
    <li><a href="text/ch01.xhtml">One</a>
      <ol><li><a href="text/ch01.xhtml#sec1">Section one</a></li></ol>
    </li>
    <li><a href="text/deep/ch03.xhtml">Two</a></li>
  </ol></nav>
</body>
</html>`

// `fullyParallel` gives every test its own worker, and `beforeAll` runs in each
// of them — so the site directory has to be per-worker or six builds race for
// one path. Playwright exports the worker index for exactly this.
const WORKER = process.env['TEST_PARALLEL_INDEX'] ?? '0'
// Per-run as well as per-worker: see the note in layout.spec.ts. Two concurrent
// suites sharing `.tmp/e2e/w0` delete each other's site mid-test.
const workDir = resolve(process.cwd(), '.tmp', 'e2e', `${process.ppid}`, `w${WORKER}`)
const siteDir = join(workDir, 'site')

let server: RunningServer
let baseURL: string

// Servers started by individual tests. They are closed in `afterAll`, not by the
// test that opened them: `server.close()` resolves only once every connection has
// ended, and a browser holds a keep-alive socket open between requests. Closing
// while the test's own page is still open waits for that page to go away, which
// happens after the test — measured as a test that spent 29 of its 30 seconds
// shutting down a server it had finished using.
const extraServers: RunningServer[] = []

test.beforeAll(async () => {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(siteDir, { recursive: true })

  const epubPath = await writeEpub(workDir, buildFixture(), 'book.epub')
  await build(epubPath, { out: siteDir })

  server = await startServer({ root: siteDir })
  baseURL = server.url
})

test.afterAll(async () => {
  await server?.close()
  await Promise.all(extraServers.splice(0).map((extra) => extra.close()))
})

function buildFixture(): Buffer {
  return sampleEpub({
    'OEBPS/nav.xhtml': NAV,
    'OEBPS/text/ch01.xhtml': CH01,
    'OEBPS/text/deep/ch03.xhtml': CH02,
    'OEBPS/Images/pic.png': ONE_PIXEL_PNG,
    'OEBPS/Styles/extra.css': '@font-face { font-family: book }',
  })
}

/**
 * Waits until the shell's enhanced navigation is live.
 *
 * Without this the suite races the runtime: a click that arrives before htmx has
 * loaded is an ordinary link, and the reader lands on a bare chapter page. The
 * race is real for a fast user too — it is the price of degrading gracefully —
 * so the test waits on the flag the runtime publishes rather than on a timeout.
 */
async function ready(page: Page, path = '/epubsite.html'): Promise<void> {
  await page.goto(`${baseURL}${path}`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
}

/**
 * §13.1's "zero 4xx" detector.
 *
 * Attached once per page. The token request itself is excluded by the caller,
 * because a token path *is* a 404 by construction — that is the mechanism, not a
 * defect.
 */
function watchForFailures(page: Page, expected: string[] = []): string[] {
  const failures: string[] = []
  page.on('response', (response: Response) => {
    if (response.status() < 400) return
    if (expected.some((fragment) => response.url().includes(fragment))) return
    failures.push(`${response.status()} ${response.url()}`)
  })
  return failures
}

test('a chapter opens from the sidebar without reloading the document', async ({ page }) => {
  const failures = watchForFailures(page)
  await ready(page)
  // The identity of the sidebar node is the whole reason `hx-target` overrides
  // boost's default: capture the element and prove it survived.
  await page.evaluate(() => {
    ;(window as unknown as { __toc: Element | null }).__toc = document.getElementById('toc')
  })

  await page.click('#toc a[data-key="OEBPS/text/deep/ch03.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('Two')

  const state = await page.evaluate(() => {
    const w = window as unknown as { __toc: Element | null }
    return {
      url: location.pathname,
      sidebarSame: w.__toc === document.getElementById('toc'),
      current: document.querySelector('#toc [aria-current="page"]')?.textContent ?? null,
    }
  })

  expect(state.url).toBe('/OEBPS/text/deep/ch03.xhtml')
  // §13.2's "sidebar node identity": a replacement would be invisible on screen
  // and would lose scroll position, expansion and focus in real use.
  expect(state.sidebarSame).toBe(true)
  expect(state.current).toBe('Two')
  expect(failures).toEqual([])
})

test('the home control returns to the landing page in place (§5.7)', async ({ page }) => {
  const failures = watchForFailures(page)
  await ready(page)

  // Two identities, because two separate claims are being made. The window flag
  // is what "no reload" means: a full navigation to /epubsite.html lands on the
  // same URL and shows the same heading, so only a value that survives in the
  // document can tell the two apart. The sidebar's node is the second: it must
  // still be the same element afterwards, which is only true if the response was
  // reduced to `#epub-content`'s children. Swapping in the whole shell body — what
  // a boosted request without `hx-select` does — would nest a second `#frame` and
  // a second `#toc` inside the pane, and `#toc` would be a different element.
  await page.evaluate(() => {
    const w = window as unknown as { __alive?: boolean; __toc: Element | null }
    w.__alive = true
    w.__toc = document.getElementById('toc')
  })

  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')
  await expect(page).toHaveTitle('One')
  expect(new URL(page.url()).pathname).toBe('/OEBPS/text/ch01.xhtml')

  await page.click('#home')
  await expect(page.locator('#epub-content h1')).toHaveText('Sample Book')

  const state = await page.evaluate(() => {
    const w = window as unknown as { __alive?: boolean; __toc: Element | null }
    return {
      path: location.pathname,
      alive: w.__alive,
      sidebarSame: w.__toc === document.getElementById('toc'),
      chapterNode: document.querySelectorAll('[data-epub-ld]').length,
      current: document.querySelector('#toc [aria-current]')?.textContent ?? null,
    }
  })

  expect(state.path).toBe('/epubsite.html')
  expect(state.alive).toBe(true)
  expect(state.sidebarSame).toBe(true)
  // The document title is the response's own `<title>`, put back by htmx — the
  // landing page carries no runtime code for it, and `syncChapter` never restored
  // the title on its landing branch, because until now only htmx's history cache
  // could bring the reader back here.
  await expect(page).toHaveTitle('Sample Book')
  // The chapter's JSON-LD node went with the chapter, and no sidebar entry is
  // current any more: both are the landing branch of the same sync.
  expect(state.chapterNode).toBe(0)
  expect(state.current).toBeNull()
  expect(failures).toEqual([])
})

test('the landing page credits the project, and a chapter does not (§5.1)', async ({ page }) => {
  const failures = watchForFailures(page)

  // The click opens a popup, i.e. a new *page*, so the stub has to be registered
  // on the context — `page.route` would never see the popup's request. Fulfilling
  // it here also keeps the suite off the real github.com.
  await page.context().route('https://github.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>epubsite</h1>' }),
  )

  await ready(page)
  const credit = page.locator('#epub-content .credit')
  await expect(credit).toBeVisible()
  expect((await credit.innerText()).trim()).toBe('Built with epubsite')

  // A working, un-intercepted link. §5.7 is why this is worth a request rather
  // than an attribute check: a boosted cross-origin link is refused by
  // `selfRequestsOnly` and then does *nothing at all* when clicked, which looks
  // exactly like a link that works.
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    credit.locator('a').click(),
  ])
  await popup.waitForLoadState()
  expect(popup.url()).toBe('https://github.com/StructSeeker/epubsite')

  // The credit belongs to the landing markup, so a chapter takes it away…
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')
  await expect(credit).toHaveCount(0)

  // …and the home control brings the landing page back, credit and all.
  await page.click('#home')
  await expect(page.locator('#epub-content h1')).toHaveText('Sample Book')
  await expect(credit).toBeVisible()
  expect(failures).toEqual([])
})

test('a chapter’s relative images resolve after the base moved', async ({ page }) => {
  const failures = watchForFailures(page)
  // A deeply nested chapter is the case that discriminates: a sibling-relative
  // path only resolves if the document base really moved (§13.2).
  await page.goto(`${baseURL}/OEBPS/text/deep/ch03.xhtml`)
  await page.goto(`${baseURL}/epubsite.html`)
  await page.click('#toc a[data-key="OEBPS/text/deep/ch03.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('Two')

  const image = page.locator('#epub-content img')
  // `loading="lazy"` means the browser does not even ask until it is near the
  // viewport, so a 404-only check would pass while the image never loads — the
  // §13.2 case says as much.
  await image.scrollIntoViewIfNeeded()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(failures).toEqual([])
})

test('a chapter script does not execute (§10 measure 1)', async ({ page }) => {
  await page.goto(`${baseURL}/epubsite.html`)
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  // Asserting the *behaviour*, not `htmx.config.allowScriptTags`: the ESM build
  // exposes no global, and the behaviour is what the setting exists to produce.
  const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)
  expect(pwned).toBeUndefined()
})

test('a token deep link enters the reader at the real path (§8.2)', async ({ page }) => {
  // The token request is the one 404 that is supposed to happen.
  const failures = watchForFailures(page, ['/@ch01.xhtml'])
  await page.goto(`${baseURL}/OEBPS/text/@ch01.xhtml`)
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  expect(new URL(page.url()).pathname).toBe('/OEBPS/text/ch01.xhtml')
  // §13.2's "sidebar usable after entry": SITE_ROOT must survive the entry.
  await page.click('#toc a[data-key="OEBPS/text/deep/ch03.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('Two')
  expect(failures).toEqual([])
})

test('an entry with parameters does not lose them (§8.3 constraint 5)', async ({ page }) => {
  const failures = watchForFailures(page)
  await page.goto(`${baseURL}/epubsite.html?p=OEBPS/text/deep/ch03.xhtml&h=fn1`)
  await expect(page.locator('#epub-content h1')).toHaveText('Two')

  const state = await page.evaluate(() => ({ path: location.pathname, hash: location.hash }))
  expect(state.path).toBe('/OEBPS/text/deep/ch03.xhtml')
  expect(state.hash).toBe('#fn1')
  expect(failures).toEqual([])
})

test('the site root transit page does not stay in history (§8.3 constraint 4)', async ({ page }) => {
  await page.goto(`${baseURL}/`)
  await expect(page).toHaveURL(`${baseURL}/epubsite.html`)

  await page.goto(`${baseURL}/epubsite.html`)
  await page.click('#toc a >> nth=0')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  await page.goBack()
  // Back must not land on the transit page and be bounced forward again.
  await expect(page).not.toHaveURL(`${baseURL}/`)
})

test('shell-data.json is fetched from the site root, not from the chapter directory', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.goto(`${baseURL}/OEBPS/text/@ch01.xhtml`)
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  // §5.4.1 step 4 / C.6.2: after the entry replaced the URL, a relative fetch
  // would ask for /OEBPS/text/_epubsite_assets/shell-data.json and 404.
  const shellData = requests.filter((url) => url.includes('shell-data.json'))
  expect(shellData.length).toBeGreaterThan(0)
  for (const url of shellData) expect(new URL(url).pathname).toBe('/_epubsite_assets/shell-data.json')
})

test('the chapter JSON-LD is injected, and the book’s block is left alone (§5.6)', async ({
  page,
}) => {
  await page.goto(`${baseURL}/epubsite.html`)
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  const state = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) =>
      JSON.parse(s.textContent ?? '{}'),
    )
    return {
      types: nodes.map((node) => node['@type']),
      ids: nodes.map((node) => node['@id']),
      marked: document.querySelectorAll('[data-epub-ld]').length,
      partOf: nodes.find((node) => node['@id']?.toString().includes('#ch-'))?.['isPartOf']?.['@id'],
    }
  })

  expect(state.types).toEqual(['Book', ['Chapter', 'Article']])
  expect(state.marked).toBe(1)
  expect(state.partOf).toBe('urn:isbn:9780000000000')
})

test('the chapter node names every address the chapter is reachable at (§7.3, §8.5)', async ({
  page,
}) => {
  // The default relative base URL is what this fixture is built with, and that is
  // the interesting case: the build emits no `url` at all, so both entries come
  // from the runtime — and they come from *where the site is actually served*,
  // which is a port the build could not have known.
  await ready(page)

  const chapterUrl = async (): Promise<unknown> =>
    page.evaluate(
      () => JSON.parse(document.querySelector('[data-epub-ld]')?.textContent ?? '{}')['url'],
    )

  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  expect(await chapterUrl()).toEqual([
    `${baseURL}/OEBPS/text/ch01.xhtml`,
    `${baseURL}/OEBPS/text/@ch01.xhtml`,
  ])

  // §5.4.1 step 3 replaced the token address with the real one before anything was
  // fetched, so the reader's own address is the plain file. The token entry is
  // derived from it rather than read back off `location`, which is why it is still
  // there and still correct.
  expect(new URL(page.url()).pathname).toBe('/OEBPS/text/ch01.xhtml')

  // Replaced, not accumulated. A node that kept the previous chapter's addresses
  // would tell a crawler that this page is also a copy of the chapter the reader
  // has already left — the exact claim `url` exists to make, made falsely.
  await page.click('#toc a[data-key="OEBPS/text/deep/ch03.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('Two')

  expect(await chapterUrl()).toEqual([
    `${baseURL}/OEBPS/text/deep/ch03.xhtml`,
    `${baseURL}/OEBPS/text/deep/@ch03.xhtml`,
  ])

  // And the landing page has no chapter node at all, so no stale `url` survives
  // the reader going back to it.
  await page.goto(`${baseURL}/epubsite.html`)
  await expect(page.locator('#toc')).toBeVisible()
  expect(await page.locator('[data-epub-ld]').count()).toBe(0)
})

test('an absolute --base-url does not make the reader list the real address twice (§7.3)', async ({
  page,
}) => {
  // The one case the shared fixture cannot reach: when `--base-url` is absolute,
  // the *build* has already written the chapter's real address into `url`, and the
  // runtime then computes the very same address from `location.href`. If the two
  // spellings differed at all, the "append only what is missing" rule would fail
  // and the chapter would be listed twice — asserting it lives in two places.
  //
  // The site must be served on the origin the build was told about, so it gets its
  // own directory and its own server rather than the suite's shared one. That
  // server is registered for `afterAll` rather than closed here — see the note on
  // `extraServers`.
  const dir = join(workDir, 'base-url-site')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const own = await startServer({ root: dir })
  extraServers.push(own)

  const origin = own.url
  const epubPath = await writeEpub(workDir, buildFixture(), 'based.epub')
  await build(epubPath, {
    out: dir,
    force: true,
    baseUrl: { form: 'absolute', href: `${origin}/` },
  })

  await page.goto(`${origin}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  // Read through a locator rather than `page.evaluate`, so that a stall names the
  // step: `evaluate` has no timeout of its own and reports only "test timeout".
  const raw = await page.locator('[data-epub-ld]').textContent()
  const url = (JSON.parse(raw ?? '{}') as Record<string, unknown>)['url']

  // Exactly two, not three: the real address appears once, and it is the build's
  // spelling that survived — the runtime recognised it and did not append its own.
  expect(url).toEqual([`${origin}/OEBPS/text/ch01.xhtml`, `${origin}/OEBPS/text/@ch01.xhtml`])
})

test('the landing page’s canonical is withdrawn on a chapter and put back afterwards (§5.4, §7.5)', async ({
  page,
}) => {
  // The tag only exists when the build was told the origin, so this needs its own
  // site on its own server — the same reason the test above does. That server goes
  // into `extraServers` rather than being closed here: `close()` waits for every
  // connection, and this page holds one open.
  const dir = join(workDir, 'canonical-site')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const own = await startServer({ root: dir })
  extraServers.push(own)

  const origin = own.url
  const epubPath = await writeEpub(workDir, buildFixture(), 'canonical.epub')
  await build(epubPath, {
    out: dir,
    force: true,
    baseUrl: { form: 'absolute', href: `${origin}/` },
  })

  const canonical = page.locator('link[rel="canonical"]')

  await page.goto(`${origin}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
  await expect(canonical).toHaveCount(1)
  expect(await canonical.getAttribute('href')).toBe(`${origin}/epubsite.html`)

  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  // The document is a chapter now, so the landing page's claim is false and must
  // be gone. It is not *replaced* by the chapter's own address: under this design
  // a chapter gets no canonical at all, in either of the two addresses it is
  // reachable at (§8.5).
  await expect(canonical).toHaveCount(0)

  // Back is the cheap return path: htmx restores the cached body and fires
  // `historyRestore`. It is also the path a removal-only implementation fails —
  // nothing else re-asserts the head's state, so the tag would stay gone.
  await page.goBack()
  await expect(page.locator('#epub-content h1')).toHaveText('Sample Book')
  await expect(canonical).toHaveCount(1)
  expect(await canonical.getAttribute('href')).toBe(`${origin}/epubsite.html`)

  // And the home control is the other one: a fresh request whose response is cut
  // down to `#epub-content`'s children. Same head state, different route to it.
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')
  await expect(canonical).toHaveCount(0)

  await page.click('#home')
  await expect(page.locator('#epub-content h1')).toHaveText('Sample Book')
  await expect(canonical).toHaveCount(1)
  expect(await canonical.getAttribute('href')).toBe(`${origin}/epubsite.html`)
})

test('a missing resource is not hijacked into a chapter load (§8.3 constraint 3)', async ({
  page,
}) => {
  const failures = watchForFailures(page, ['missing.png'])
  await page.goto(`${baseURL}/OEBPS/Images/missing.png`)

  // The guide's own page, not the reader: a broken image must stay a broken
  // image, or every asset defect is disguised as "the reader is starting".
  await expect(page.locator('h1')).toHaveText('Page not found')
  expect(await page.locator('#toc').count()).toBe(0)
  expect(failures).toEqual([])
})

test('a link within the current chapter does not re-request it (§5.7)', async ({ page }) => {
  const requests: string[] = []
  await page.goto(`${baseURL}/epubsite.html`)
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  page.on('request', (request) => requests.push(request.url()))
  await page.click('#epub-content a[href$="#sec1"]')
  await page.waitForTimeout(300)

  // §13.2's requirement for this case, and it holds: the short-circuit caught
  // the navigation before htmx issued anything.
  const chapterRequests = requests.filter((url) => url.includes('ch01.xhtml'))
  expect(chapterRequests).toEqual([])
})

/**
 * A same-chapter fragment must move the reader, not just suppress a request.
 *
 * This case is worth its own test because the naive short-circuit looks correct
 * and is not. htmx's `shouldCancel` cancels the browser's default action for any
 * link whose *raw* href does not match `/^#.+/` — so for `./ch01.xhtml#sec1` the
 * native fragment jump is already gone by the time `htmx:beforeRequest` fires.
 * If the short-circuit then cancels the request and does nothing else, both
 * navigation paths are closed and clicking a footnote silently does nothing at
 * all. The handler must therefore perform the jump itself.
 */
test('a same-chapter fragment moves the reader to the anchor (§5.7)', async ({ page }) => {
  await ready(page)
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epub-content h1')).toHaveText('One')

  await page.click('#epub-content a[href$="#sec1"]')
  await expect.poll(() => new URL(page.url()).hash).toBe('#sec1')
})

test('every chapter of the sample opens on its own as a bare page', async ({ page }) => {
  const failures = watchForFailures(page)
  for (const path of [
    '/OEBPS/text/ch01.xhtml',
    '/OEBPS/text/ch02.xhtml',
    '/OEBPS/text/deep/ch03.xhtml',
  ]) {
    const response = await page.goto(`${baseURL}${path}`)
    expect(response?.status()).toBe(200)
    // Served as XHTML, which is what §9.1 requires and what makes the browser
    // apply XML rules to the book's own markup.
    expect(response?.headers()['content-type']).toContain('application/xhtml+xml')
  }
  expect(failures).toEqual([])
})

test('the server refuses to walk out of the site root', async ({ request }) => {
  // The guard is reachable: the request path is attacker-controlled, and Node
  // does not normalise `req.url` for us.
  const encoded = await request.get(`${baseURL}/%2e%2e%2f%2e%2e%2fpackage.json`)
  expect(encoded.status()).toBe(404)
})
