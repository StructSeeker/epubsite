/**
 * The reader's layout, end to end.
 *
 * These are regression tests for four defects that all had **one** cause, and the
 * cause is worth stating because none of the four symptoms points at it.
 *
 * `body` is a two-column grid holding `#toc` and `#frame`. It declared no
 * `grid-template-rows`, so the single row was implicit and `auto` — content-sized.
 * `#frame` then asked for `height: 100%` against a row whose height came from its
 * own contents: a cyclic reference, which CSS resolves by treating the percentage
 * as `auto`. So `#frame` grew to whatever the chapter was tall, `1fr` inside it
 * had nothing to distribute, and `#epub-content`'s `overflow: auto` never engaged.
 *
 * On the landing page, which is short, the row happened to stretch to the viewport
 * and everything looked right. Every symptom appeared only with a chapter long
 * enough to overflow:
 *
 *   1. the chapter could not scroll and was cut off at the fold — the panes had
 *      grown instead of scrolling, and `html`/`body` are `overflow: hidden`;
 *   2. the toolbar slid out of view, because `body`, though `overflow: hidden`,
 *      is still a *scroll container* — `overflow: hidden` blocks the scrollbar,
 *      not `scrollIntoView` — so scrolling the content scrolled the whole body;
 *   3. the sidebar lost its scrollbar, for the same reason as (1);
 *   4. the sidebar and the chapter appeared to scroll together, because they
 *      were both simply part of one very tall page.
 *
 * So there is one fix and four detectors, and the detectors are separate because
 * each symptom is what a reader would report. A single "layout is fine" assertion
 * would go red without saying which of the four came back.
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from '../../src/build/build'
import { startServer, type RunningServer } from '../../src/serve/server'
import { sampleEpub } from '../fixtures/zip-writer'
import { writeEpub } from '../fixtures/tmp'

const WORKER = process.env['TEST_PARALLEL_INDEX'] ?? '0'
// `<ppid>` because two suites can legitimately run at once: `prepublishOnly` runs
// the whole browser suite, so publishing while testing starts a second one. Without
// a per-run key both runs build into the same `.tmp/…/w0`, and each `beforeAll`
// deletes the other run's site while it is being tested. The runner's process id is
// what tells one run from another.
const workDir = resolve(process.cwd(), '.tmp', 'e2e-layout', `${process.ppid}`, `w${WORKER}`)
const siteDir = join(workDir, 'site')

/** Comfortably taller than any viewport the tests use. */
const PARAGRAPHS = 400

let server: RunningServer
let baseURL: string

test.beforeAll(async () => {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(siteDir, { recursive: true })
  const epubPath = await writeEpub(workDir, buildFixture(), 'tall.epub')
  // `search: true` so the search modal is present for its own tests. It costs one
  // Pagefind run in `beforeAll` and saves building a second site.
  await build(epubPath, { out: siteDir, search: true })
  server = await startServer({ root: siteDir })
  baseURL = server.url
})

test.afterAll(async () => {
  await server?.close()
})

function tallChapter(heading = 'Tall'): string {
  const body = Array.from(
    { length: PARAGRAPHS },
    (_, index) => `<p>Paragraph ${index} of a deliberately long chapter.</p>`,
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${heading}</title></head>
<body>
<h1>${heading}</h1>
${body}
<p>A filesystem path cannot be broken at a space, and CSS does not treat a slash
as a line-break opportunity either:
/home/someuser/.local/share/mise/installs/ruby/3.1.6/lib/ruby/gems/3.1.0/gems/example/lib/example.rb</p>
<p id="the-end">The very last paragraph.</p>
</body>
</html>`
}

/** Long enough that the sidebar must scroll at the test viewport. */
function tallNav(): string {
  const items = Array.from(
    { length: 80 },
    (_, index) => `<li><a href="text/ch01.xhtml#p${index}">Chapter entry number ${index}</a></li>`,
  ).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
<nav epub:type="toc"><ol>
<li><a href="text/ch01.xhtml">Tall</a><ol>${items}
<li><a href="text/ch01.xhtml#spec">What Does spec.add_development_dependency Do?</a></li></ol></li>
<li><a href="text/ch02.xhtml">Short</a></li>
<li><a href="text/deep/ch03.xhtml">Deep</a></li>
</ol></nav>
</body>
</html>`
}

function buildFixture(): Buffer {
  return sampleEpub({
    'OEBPS/nav.xhtml': tallNav(),
    'OEBPS/text/ch01.xhtml': tallChapter(),
    // Also tall, and deliberately so. A scroll-position test needs a destination
    // that can hold an offset: against a short chapter the pane clamps back to 0
    // by itself, and the assertion passes whatever the code does.
    'OEBPS/text/ch02.xhtml': tallChapter('Short'),
  })
}

interface Pane {
  height: number
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
  scrollTop: number
  scrolls: boolean
}

interface Layout {
  bodyScrollHeight: number
  bodyScrollTop: number
  toolbarY: number
  content: Pane
  toc: Pane
}

/**
 * Measures the four things that went wrong.
 *
 * `bodyScrollHeight` is the tells-all number: when the page is laid out as two
 * fixed panes it equals the viewport, and when it is not it equals the chapter.
 */
async function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const pane = (selector: string): Pane => {
      const element = document.querySelector(selector) as HTMLElement
      return {
        height: Math.round(element.getBoundingClientRect().height),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollTop: Math.round(element.scrollTop),
        scrolls: element.scrollHeight > element.clientHeight + 1,
      }
    }
    return {
      bodyScrollHeight: document.body.scrollHeight,
      bodyScrollTop: Math.round(document.body.scrollTop),
      toolbarY: Math.round(
        (document.querySelector('#toolbar') as HTMLElement).getBoundingClientRect().y,
      ),
      content: pane('#epub-content'),
      toc: pane('#toc'),
    }
  })
}

/** Enters the reader and opens the long chapter through the sidebar. */
async function openTallChapter(page: Page, width = 1280): Promise<Layout> {
  await page.setViewportSize({ width, height: 800 })
  await page.goto(`${baseURL}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
  // `force` because this click asserts *navigation*, not reachability: if it never
  // lands on the link, the wait for the chapter's last paragraph fails anyway.
  //
  // What it removes is Playwright's "stable" pre-check, which requires the
  // element's box to be unchanged across two consecutive animation frames. That is
  // a property of the machine's frame pacing rather than of this code, and it
  // starves when a second suite runs at the same time — `prepublishOnly` runs the
  // whole browser suite, so publishing while testing is enough to cause it.
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]', { force: true })
  await page.waitForFunction(
    () => (document.querySelector('#epub-content')?.textContent ?? '').includes('The very last'),
  )
  return measure(page)
}

test('the chapter scrolls inside its own pane instead of growing the page', async ({ page }) => {
  const layout = await openTallChapter(page)

  // The whole page fits the viewport, because nothing about it scrolls.
  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(801)
  // And the chapter really is taller than its pane, so `scrolls` is a real test.
  expect(layout.content.scrollHeight).toBeGreaterThan(layout.content.clientHeight)
  expect(layout.content.height).toBeLessThanOrEqual(800)
  expect(layout.content.scrolls).toBe(true)
})

test('scrolling to the end of a long chapter does not push the toolbar away', async ({ page }) => {
  await openTallChapter(page)
  const end = page.locator('#the-end')
  await end.scrollIntoViewIfNeeded()
  await expect(end).toBeInViewport()

  // The trap: this passes even when the layout is broken, because the body is
  // still scrollable and scrolling it does bring the paragraph into view. The
  // toolbar going with it is what makes it a defect, so that is what is asserted.
  const layout = await measure(page)
  expect(layout.toolbarY).toBe(0)
  expect(layout.bodyScrollTop).toBe(0)
})

test('the toolbar stays in view after navigating', async ({ page }) => {
  const layout = await openTallChapter(page)

  expect(layout.toolbarY).toBe(0)
  // `overflow: hidden` still allows programmatic scrolling, which is how the
  // toolbar disappeared: the body had been scrolled by its own height.
  expect(layout.bodyScrollTop).toBe(0)
})

test('the sidebar keeps its own scrollbar after navigating', async ({ page }) => {
  const layout = await openTallChapter(page)

  expect(layout.toc.scrollHeight).toBeGreaterThan(layout.toc.clientHeight)
  expect(layout.toc.scrolls).toBe(true)
})

test('the sidebar and the chapter scroll independently', async ({ page }) => {
  await openTallChapter(page)

  await page.evaluate(() => {
    ;(document.querySelector('#epub-content') as HTMLElement).scrollTop = 4000
  })
  const afterContent = await measure(page)
  expect(afterContent.content.scrollTop).toBeGreaterThan(0)
  // Scrolling the chapter must not move the sidebar…
  expect(afterContent.toc.scrollTop).toBe(0)

  await page.evaluate(() => {
    ;(document.querySelector('#toc') as HTMLElement).scrollTop = 500
  })
  const afterToc = await measure(page)
  expect(afterToc.toc.scrollTop).toBeGreaterThan(0)
  // …and scrolling the sidebar must not move the chapter.
  expect(afterToc.content.scrollTop).toBe(afterContent.content.scrollTop)
  expect(afterToc.bodyScrollTop).toBe(0)
})

test('the chapter pane never outgrows the viewport, so the right margin survives', async ({
  page,
}) => {
  // The defect: at mobile widths the pane was wider than the screen, so its right
  // padding — the reader's entire right margin — sat past the edge of it. `1fr`
  // tracks have an `auto` minimum and were being inflated by content, first by
  // the chapter and then by the toolbar, so both the pane and the frame that
  // holds it are checked.
  for (const width of [360, 500]) {
    await page.setViewportSize({ width, height: 800 })
    // Entered through the token protocol rather than the sidebar, because at
    // these widths the sidebar is a closed drawer and its links are off-screen.
    await page.goto(`${baseURL}/epubsite.html?p=%2FOEBPS%2Ftext%2Fch01.xhtml`)
    await page.waitForFunction(
      () => (document.querySelector('#epub-content')?.textContent ?? '').includes('The very last'),
    )

    const geometry = await page.evaluate(() => {
      const pane = document.querySelector('#epub-content') as HTMLElement
      const frame = document.querySelector('#frame') as HTMLElement
      return {
        paneRight: pane.getBoundingClientRect().right,
        frameRight: frame.getBoundingClientRect().right,
        paddingRight: Number.parseFloat(getComputedStyle(pane).paddingRight),
      }
    })

    expect(geometry.frameRight, `frame at ${width}px`).toBeLessThanOrEqual(width + 0.5)
    expect(geometry.paneRight, `pane at ${width}px`).toBeLessThanOrEqual(width + 0.5)
    // A margin is only a margin if something is reserved for it.
    expect(geometry.paddingRight, `padding at ${width}px`).toBeGreaterThan(0)
  }
})

/**
 * The search modal.
 *
 * Two defects, one cause. Pagefind's modal keeps its own `_isOpen` flag and
 * exposes `open()`/`close()`; the runtime used to call `showModal()` on the
 * `<dialog>` inside it, which opened the dialog while leaving the flag `false`.
 * The component therefore believed it was closed, and its own close button —
 * rendered, labelled "close", and visible below 640px — did nothing when clicked.
 * Above 640px there was no way out at all, because the component hides that
 * button on desktop on the assumption that Escape is enough.
 *
 * So the tests are: the control exists and is visible at every width, and
 * clicking it actually closes the dialog. The second is what fails if anyone
 * goes back to poking the dialog directly.
 */
test.describe('the search modal', () => {
  async function openSearch(page: Page, width: number): Promise<void> {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`${baseURL}/epubsite.html`)
    await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
    await page.click('#search-open')
    // The bundle is loaded lazily, so the modal appears a beat after the click.
    await expect(page.locator('#search-modal dialog')).toHaveAttribute('open', '')
  }

  for (const width of [1280, 500]) {
    test(`has a visible control that closes it at ${width}px`, async ({ page }) => {
      await openSearch(page, width)

      const close = page.locator('#search-modal .pf-modal-close')
      await expect(close).toBeVisible()

      // Visible is not the same as clickable: a control painted over by something
      // else is still "visible" to Playwright's first check.
      await close.click()
      await expect(page.locator('#search-modal dialog')).not.toHaveAttribute('open', '')
    })
  }

  test('still closes on Escape, which is the component’s own binding', async ({ page }) => {
    await openSearch(page, 1280)
    await page.keyboard.press('Escape')
    await expect(page.locator('#search-modal dialog')).not.toHaveAttribute('open', '')
  })
})

test('neither pane scrolls sideways, even for tokens CSS cannot break at spaces', async ({
  page,
}) => {
  // The fixture carries a long method name in the sidebar and a long filesystem
  // path in the chapter. Neither can be broken at a space, and CSS does not break
  // at `.`, `_` or `/`, so without `overflow-wrap` each one makes its pane wider
  // than it is — a horizontal scrollbar on both, which is what a reader sees and
  // reports as the page being "cut off".
  const layout = await openTallChapter(page)
  expect(layout.content.scrollWidth - layout.content.clientWidth).toBeLessThanOrEqual(1)
  expect(layout.toc.scrollWidth - layout.toc.clientWidth).toBeLessThanOrEqual(1)
})

test('a copy attempt reports itself without destroying the icon', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${baseURL}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')

  const button = page.locator('#share')
  await button.click()

  // The message used to be written into the button's text. For a symbol button
  // that means deleting the symbol, so the icon has to still be there afterwards —
  // this is the assertion that fails if anyone goes back to `textContent`.
  await expect(button).toHaveAttribute('data-flash', /./)
  await expect(button.locator('svg')).toBeVisible()
  await expect(button).toHaveAttribute('aria-label', 'Copy a link to this book')

  // Whichever way the clipboard went: "Link copied" and "Copy failed" both count,
  // because what is under test is the reporting, not the permission.
  expect(['Link copied', 'Copy failed']).toContain(await button.getAttribute('data-flash'))

  // And it clears itself.
  await expect.poll(() => button.getAttribute('data-flash')).toBeNull()
})

test('the toolbar symbols are buttons with accessible names, not text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${baseURL}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')

  // A symbol-only control has to get its name from somewhere. Without an
  // `aria-label` a screen reader announces the whole thing as "button", and the
  // icon is `aria-hidden` precisely because it carries no text of its own.
  for (const { selector, name } of [
    { selector: '#search-open', name: 'Search this book' },
    { selector: '#share', name: 'Copy a link to this book' },
  ]) {
    const button = page.locator(selector)
    await expect(button).toHaveAttribute('aria-label', name)
    await expect(button.locator('svg')).toBeVisible()
    // Nothing to read: the icon is drawn, not typeset.
    expect((await button.innerText()).trim()).toBe('')
  }
})

test('an 11-inch tablet is narrow in portrait and wide in landscape', async ({ page }) => {
  // 800x1280 is what a Samsung 11" panel reports held upright: 2560x1600 at
  // DPR 2. The old 640px threshold called that a desktop, so the screen with the
  // least horizontal room got the layout that wants the most.
  const cases = [
    { width: 800, height: 1280, narrow: true },
    { width: 1280, height: 800, narrow: false },
  ]

  for (const { width, height, narrow } of cases) {
    await page.setViewportSize({ width, height })
    await page.goto(`${baseURL}/epubsite.html`)
    await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')

    const drawerX = (): Promise<number> =>
      page.evaluate(() => (document.querySelector('#toc') as HTMLElement).getBoundingClientRect().x)

    if (narrow) {
      await expect(page.locator('#toc-toggle'), `at ${width}px`).toBeVisible()
      // The drawer exists but is off-screen until asked for.
      await expect.poll(drawerX).toBeLessThan(0)
    } else {
      await expect(page.locator('#toc-toggle'), `at ${width}px`).toBeHidden()
      await expect.poll(drawerX).toBe(0)
    }
  }
})

test('Copy link works on the landing page, before any chapter is open', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${baseURL}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')

  const button = page.locator('#share')
  await expect(button).toBeEnabled()
  await button.click()

  // No chapter to tokenise yet, so the link is the reader's own address: a
  // working way to send someone the book.
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe(`${baseURL}/epubsite.html`)
})

test('a chapter opens at its own top when the URL names no anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`${baseURL}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')

  const paneScrollTop = (): Promise<number> =>
    page.evaluate(() =>
      Math.round((document.querySelector('#epub-content') as HTMLElement).scrollTop),
    )

  // Read partway down the long chapter…
  await page.click('#toc a[data-key="OEBPS/text/ch01.xhtml"]', { force: true })
  await page.waitForFunction(() =>
    (document.querySelector('#epub-content')?.textContent ?? '').includes('The very last'),
  )
  await page.evaluate(() => {
    ;(document.querySelector('#epub-content') as HTMLElement).scrollTop = 3000
  })
  await expect.poll(paneScrollTop).toBeGreaterThan(0)

  // …then open a different chapter, whose URL names no anchor.
  await page.click('#toc a[data-key="OEBPS/text/ch02.xhtml"]', { force: true })
  await page.waitForFunction(() => document.title === 'Short')

  expect(new URL(page.url()).hash).toBe('')
  // htmx's `show:top` cannot do this: `show` scrolls the *document*, and under I6
  // the document never scrolls — the chapter scrolls inside its own pane. So the
  // pane kept the previous chapter's offset and the new one opened partway down.
  await expect.poll(paneScrollTop).toBe(0)
})

test('the favicon survives the document URL moving', async ({ page }) => {
  const failures: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
  })

  await openTallChapter(page)

  // The browser re-resolves `<link rel="icon">` against the document's current
  // base, exactly as it does for any other relative URL — so after a pushState a
  // relative href pointed at `/OEBPS/text/_epubsite_assets/icon.svg`, which does
  // not exist. That is why the shell's own URLs carry `data-shell`.
  const href = await page.getAttribute('link[rel="icon"]', 'href')
  expect(href).not.toBeNull()
  expect(new URL(href as string).pathname).toBe('/_epubsite_assets/icon.svg')

  expect(failures.filter((failure) => failure.includes('icon'))).toEqual([])
})

/**
 * The narrow-screen drawer.
 *
 * The defect: the drawer is an overlay spanning the full viewport height, and
 * `#toc-toggle` lives in the toolbar — so opening the drawer painted over the
 * very button that opened it, leaving no way to close it but a page reload.
 *
 * The fix is geometric, not another control: the panel starts below the toolbar,
 * which keeps its own trigger reachable. So what these tests assert is the
 * invariant — *the control that opens the drawer is still the thing a click at
 * its centre hits while the drawer is open* — because that is the property that
 * makes the second click work. `toBeVisible` cannot express it: the button is
 * perfectly visible with a panel painted on top of it.
 */
test.describe('the mobile drawer', () => {
  const NARROW = { width: 500, height: 800 }

  async function gotoNarrow(page: Page): Promise<void> {
    await page.setViewportSize(NARROW)
    await page.goto(`${baseURL}/epubsite.html`)
    await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
  }

  /**
   * What a click at the element's centre would actually reach.
   *
   * Hit-testing is the only honest question here, and it is exactly what the
   * browser does when the reader clicks.
   */
  async function isHitTestable(page: Page, selector: string): Promise<boolean> {
    return page.evaluate((target: string) => {
      const element = document.querySelector(target) as HTMLElement
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return hit !== null && (hit === element || element.contains(hit))
    }, selector)
  }

  /** The panel's settled position — `0` open, off-screen left when closed. */
  async function drawerX(page: Page): Promise<number> {
    return page.evaluate(
      () => (document.querySelector('#toc') as HTMLElement).getBoundingClientRect().x,
    )
  }

  /** Polls, because the panel slides: a fixed delay would race the transition. */
  async function expectDrawer(page: Page, state: 'open' | 'closed'): Promise<void> {
    if (state === 'open') {
      await expect(page.locator('html')).toHaveAttribute('data-drawer-open', '')
      await expect.poll(() => drawerX(page)).toBeGreaterThan(-1)
    } else {
      await expect(page.locator('html')).not.toHaveAttribute('data-drawer-open', '')
      await expect.poll(() => drawerX(page)).toBeLessThan(0)
    }
  }

  test('opens from the toggle', async ({ page }) => {
    await gotoNarrow(page)
    await page.click('#toc-toggle')
    await expectDrawer(page, 'open')
  })

  test('closes from the same toggle that opened it', async ({ page }) => {
    await gotoNarrow(page)
    await page.click('#toc-toggle')
    await expectDrawer(page, 'open')

    // The assertion the bug would have failed: with the drawer open, a click at
    // the toggle's centre must still land on the toggle.
    expect(await isHitTestable(page, '#toc-toggle')).toBe(true)

    await page.click('#toc-toggle')
    await expectDrawer(page, 'closed')
  })

  test('leaves the whole toolbar reachable while it is open', async ({ page }) => {
    await gotoNarrow(page)
    await page.click('#toc-toggle')
    await expectDrawer(page, 'open')

    for (const control of ['#toc-toggle', '#book-title']) {
      expect(await isHitTestable(page, control), `${control} is covered`).toBe(true)
    }
  })

  test('reports its state on the toggle', async ({ page }) => {
    await gotoNarrow(page)
    const toggle = page.locator('#toc-toggle')

    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('does not open, or leak, at desktop widths', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseURL}/epubsite.html`)
    await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')

    // The sidebar is permanent chrome here, so the toggle is not a control the
    // reader has: it must not be visible, and it must not have opened anything.
    await expect(page.locator('#toc-toggle')).toBeHidden()
    await expect(page.locator('html')).not.toHaveAttribute('data-drawer-open', '')
    expect(await drawerX(page)).toBe(0)
  })
})
