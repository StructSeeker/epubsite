/**
 * Whose styles apply to the book, and whose names the reader's chrome uses
 * (spec §1.2, §5.5, §5.13).
 *
 * Two properties, and both fail silently if they break:
 *
 *   - **`--content-style reader`** swaps the book's stylesheets for the reader's
 *     own. A build that did nothing would still produce a page that *looks*
 *     styled — the browser's defaults plus whatever the book left behind — so the
 *     detectors have to be values only one of the two sheets can produce.
 *   - **The shell's `epubsite-` namespace** keeps a book's stylesheet off the
 *     reader's chrome. The failure it prevents is invisible until a book happens
 *     to use a colliding name, so the fixture *is* such a book: its stylesheet
 *     carries the plausible hostile rules, and the test is that the reader is
 *     unmoved. The control matters as much as the assertion — the book's sheet is
 *     proved live by one of its rules reaching the book's own markup, otherwise
 *     "nothing was hidden" could just mean "nothing was loaded".
 *
 * Both sites are built by the real library and served by the real `serve`, so
 * what is under test is the artifact a reader receives.
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from '../../src/build/build'
import { startServer, type RunningServer } from '../../src/serve/server'
import type { BuildOptions } from '../../src/build/options'
import { sampleEpub } from '../fixtures/zip-writer'
import { writeEpub } from '../fixtures/tmp'

/**
 * The book's own stylesheet, with values nothing else would produce.
 *
 * `rgb(1, 2, 3)` and `rgb(4, 5, 6)` are deliberately absurd: they are the
 * discriminators, and a plausible-looking colour could pass by coincidence.
 * `text-indent` is the third, and the one that shows *why* the reader needs its
 * own default at all — a book that indents paragraphs and one that does not are
 * two different books to a reader.
 */
const BOOK_CSS = `p { color: rgb(1, 2, 3); text-indent: 3em }
a { color: rgb(11, 12, 13) }`

const CH01 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>One</title>
  <link rel="stylesheet" href="../Styles/book.css"/>
  <style>h1 { color: rgb(4, 5, 6) }</style>
</head>
<body class="calibre">
  <h1>One</h1>
  <p id="first">First paragraph.</p>
  <blockquote><p>A quotation.</p></blockquote>
  <pre><code>a code line</code></pre>
  <table><tr><th>Head</th><td>Cell</td></tr></table>
</body>
</html>`

/**
 * The hostile book: the names a real stylesheet plausibly uses, applied to
 * elements the reader owns.
 *
 * Every rule here would have hit the shell before §5.13 — `#epub-content` was the
 * pane, `#toc` the sidebar, `.notice`/`.credit`/`.skip-link` the landing page's
 * own classes. Under the current names none of them match anything, and the
 * book's `<p class="toc">` is the control: it *is* the book's own element, so its
 * colour proves the stylesheet was applied rather than merely fetched.
 */
const HOSTILE_CSS = `#epub-content, #toc, #toolbar, #frame { display: none }
#home, #prev, #next, #share, #search-open, #progress, #book-title { display: none }
.notice, .credit, .skip-link, .toc-row, .toc-disclosure { display: none }
.toc { color: rgb(9, 8, 7) }`

const HOSTILE_CH01 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>One</title>
  <link rel="stylesheet" href="../Styles/book.css"/>
</head>
<body>
  <h1>One</h1>
  <p class="toc">The book's own table of contents.</p>
</body>
</html>`

function styledBook(): Buffer {
  return sampleEpub({
    'OEBPS/text/ch01.xhtml': CH01,
    'OEBPS/Styles/book.css': BOOK_CSS,
  })
}

function hostileBook(): Buffer {
  return sampleEpub({
    'OEBPS/text/ch01.xhtml': HOSTILE_CH01,
    'OEBPS/Styles/book.css': HOSTILE_CSS,
  })
}

// Per-worker and per-run, for the reasons `site.spec.ts` gives: `beforeAll` runs
// once per worker under `fullyParallel`, and two suites sharing a directory would
// delete each other's site mid-test.
const WORKER = process.env['TEST_PARALLEL_INDEX'] ?? '0'
const workDir = resolve(process.cwd(), '.tmp', 'e2e', `${process.ppid}`, `style-w${WORKER}`)

const servers: RunningServer[] = []
const builtSites = new Map<string, string>()

test.beforeAll(async () => {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })

  const styled = await writeEpub(workDir, styledBook(), 'styled.epub')
  const hostile = await writeEpub(workDir, hostileBook(), 'hostile.epub')

  await site(styled, 'book')
  await site(styled, 'reader', { contentStyle: 'reader' })
  await site(hostile, 'hostile')
})

test.afterAll(async () => {
  // Closed together, at the end: `close()` resolves only once every connection has
  // ended, and a page left open on a server holds one.
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

/** Builds into its own directory and serves it. */
async function site(epub: string, name: string, options: Partial<BuildOptions> = {}): Promise<void> {
  const dir = join(workDir, name)
  await mkdir(dir, { recursive: true })
  await build(epub, { out: dir, ...options })
  const server = await startServer({ root: dir })
  servers.push(server)
  builtSites.set(name, server.url)
}

/** The address of a site built above, so no test has to hold its own copy. */
function urlOf(name: string): string {
  const url = builtSites.get(name)
  if (url === undefined) throw new Error(`no server for ${name}`)
  return url
}

/** Opens chapter one through the sidebar, waiting for the runtime to be live. */
async function openChapter(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
  await page.click('#epubsite-toc a[data-key="OEBPS/text/ch01.xhtml"]')
  await expect(page.locator('#epubsite-content h1')).toHaveText('One')
}

/** A computed property of one element, read as the browser resolved it. */
async function computed(page: Page, selector: string, property: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  )
}

test.describe('the reader’s own content style', () => {
  test('the book’s rules reach its content when nothing was asked for', async ({ page }) => {
    // The control for the two tests below: without it, "the book's colour is
    // absent" could mean the reader replaced the sheet or that it never loaded.
    await openChapter(page, urlOf('book'))

    expect(await computed(page, '#epubsite-content p', 'color')).toBe('rgb(1, 2, 3)')
    // The inline `<style>` of the same chapter goes through a different path in
    // the build (`@layer epub { … }` rather than an `@import`), so it is asserted
    // too: a swap that missed one of the two would be a half-fix.
    expect(await computed(page, '#epubsite-content h1', 'color')).toBe('rgb(4, 5, 6)')
  })

  test('replaces the book’s sheets, and supplies a reading default of its own', async ({ page }) => {
    await openChapter(page, urlOf('reader'))

    // The book's rules are gone…
    expect(await computed(page, '#epubsite-content p', 'color')).not.toBe('rgb(1, 2, 3)')
    expect(await computed(page, '#epubsite-content h1', 'color')).not.toBe('rgb(4, 5, 6)')
    // …including its paragraph indent, which the reader's default does not use.
    expect(await computed(page, '#epubsite-content p', 'text-indent')).toBe('0px')

    // …and the reader's sheet is the one in force. `ui-serif` appears in exactly
    // one stylesheet in this project, and the pane is the only element it names.
    expect(await computed(page, '#epubsite-content', 'font-family')).toContain('ui-serif')
  })

  test('styles the block elements the shell leaves alone', async ({ page }) => {
    await openChapter(page, urlOf('reader'))

    // The shell deliberately declares nothing for these: §5.10's rules are about
    // the pane, the grid and media sizing. So a value here is the reader's
    // stylesheet working — and the code block is the case §5.8 names, because the
    // book's own styling of it is exactly what the flag gives up.
    expect(await computed(page, '#epubsite-content pre', 'border-top-width')).toBe('1px')
    expect(await computed(page, '#epubsite-content table', 'border-collapse')).toBe('collapse')
    expect(await computed(page, '#epubsite-content blockquote', 'border-inline-start-width')).toBe('3px')
  })

  test('follows the theme, in both directions', async ({ page }) => {
    // Built with the default `--theme auto`, so this is the OS-preference path:
    // `light-dark()` on tokens the shell defines and the sheet only reads.
    const reader = urlOf('reader')
    const pre = '#epubsite-content pre'

    await page.emulateMedia({ colorScheme: 'dark' })
    await openChapter(page, reader)
    const dark = await computed(page, pre, 'background-color')

    // Re-entered from the landing page rather than reloaded: the reader has
    // pushed a chapter URL by now, and that address is the book's own file, which
    // has no runtime to wait for.
    await page.emulateMedia({ colorScheme: 'light' })
    await openChapter(page, reader)
    const light = await computed(page, pre, 'background-color')

    // Two different, non-transparent surfaces: one value would mean the sheet's
    // colour is a literal, and transparent would mean it never applied.
    expect(dark).not.toBe(light)
    expect(dark).toMatch(/^rgb\(/)
    expect(dark).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('leaves the landing page alone, and is withdrawn when the reader returns to it', async ({ page }) => {
    // The sheet is a slot, not a link: it is injected when a chapter is on screen
    // and removed when one is not (§5.4.3). Landing first proves the removal is a
    // removal rather than an absence — the same sheet is measured on both sides.
    await openChapter(page, urlOf('reader'))
    expect(await computed(page, '#epubsite-content', 'font-family')).toContain('ui-serif')

    await page.click('#epubsite-home')
    await expect(page.locator('#epubsite-content h1')).toHaveText('Sample Book')

    expect(await computed(page, '#epubsite-content', 'font-family')).not.toContain('ui-serif')
  })
})

test.describe('the shell’s namespace', () => {
  test('a book stylsheet cannot reach the reader’s chrome, whatever it names', async ({ page }) => {
    const failures: string[] = []
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
    })

    await openChapter(page, urlOf('hostile'))

    // The book's stylesheet is live — this is the control, and it is the book's
    // own `<p class="toc">`, not the reader's sidebar.
    expect(await computed(page, '#epubsite-content p.toc', 'color')).toBe('rgb(9, 8, 7)')

    // Nothing the reader owns was hidden, moved or blanked. Each selector is the
    // name the book chose, so a rename that left one behind shows up here.
    await expect(page.locator('#epubsite-content')).toBeVisible()
    await expect(page.locator('#epubsite-content h1')).toBeVisible()
    await expect(page.locator('#epubsite-toc')).toBeVisible()
    await expect(page.locator('#epubsite-toolbar')).toBeVisible()
    await expect(page.locator('#epubsite-book-title')).toBeVisible()
    for (const control of ['#epubsite-home', '#epubsite-prev', '#epubsite-next']) {
      await expect(page.locator(control), `${control} was hidden`).toBeVisible()
    }
    expect(failures).toEqual([])
  })
})
