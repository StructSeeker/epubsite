/**
 * Namespaces the HTML parse would throw away (spec §5.15).
 *
 * The book that produced this test is *Handbook of Financial Risk Management*,
 * whose every formula is `<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML">`.
 * Opened as a bare page it typesets, because that file is served as
 * `application/xhtml+xml` and an XML parser resolves the prefix. Under the shell
 * the document is HTML, htmx swaps a *fragment* of it, and the HTML parser has no
 * notion of a prefix: `<mml:math>` became an unknown element named `mml:math`,
 * `display: inline`, and 280 formulas rendered as lines of glued characters.
 *
 * So the fixture is that book in miniature — a chapter whose declarations sit on
 * the elements (the deployed shape) and one whose declaration sits on `<html>`
 * only (which the body swap discards, so the prefix has to be recognised without
 * it). `svg:` is here for the same reason as `mml:`: identical defect, identical
 * repair, and a different vocabulary to prove the resolution is not MathML-only.
 *
 * Every detector is a value only the correct namespace can produce. `mml:mfrac`
 * as an unknown HTML element computes to `display: inline`; as MathML it
 * computes to `display: block math`. An unknown `rect` ignores `fill`; an SVG
 * `rect` paints it.
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from '../../src/build/build'
import { startServer, type RunningServer } from '../../src/serve/server'
import { sampleEpub } from '../fixtures/zip-writer'
import { writeEpub } from '../fixtures/tmp'

const MATHML = 'http://www.w3.org/1998/Math/MathML'
const SVG = 'http://www.w3.org/2000/svg'

/** The deployed shape: the declaration travels with the element that uses it. */
const DECLARED_HERE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Formulas</title></head>
<body>
  <h1>Formulas</h1>
  <p id="inline">An inline <mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" display="inline"><mml:mi>x</mml:mi><mml:mo>+</mml:mo><mml:mn>1</mml:mn></mml:math> formula.</p>
  <mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML" display="block"><mml:mfrac><mml:mn>1</mml:mn><mml:mn>2</mml:mn></mml:mfrac></mml:math>
  <p id="drawing"><svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><svg:rect width="40" height="40" fill="rgb(4, 5, 6)"/></svg:svg></p>
</body>
</html>`

/**
 * The other shape: `xmlns:mml` is on `<html>`, which the swap does not keep.
 *
 * Nothing is written on the `mml:math` elements, so the repair has to recognise
 * the prefix itself — three of them, so a pass that fixed only the first would
 * show up. The fourth declares an unusual prefix (`mm`) on the element it names,
 * which is the one case where the declaration is neither above the element nor
 * one this project knows by heart.
 */
const DECLARED_ABOVE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:mml="http://www.w3.org/1998/Math/MathML">
<head><title>Prefixless</title></head>
<body>
  <h1>Prefixless</h1>
  <p><mml:math><mml:mn>1</mml:mn></mml:math>
     <mml:math><mml:mn>2</mml:mn></mml:math>
     <mml:math display="block"><mml:msup><mml:mi>e</mml:mi><mml:mn>2</mml:mn></mml:msup></mml:math>
     <mm:math xmlns:mm="http://www.w3.org/1998/Math/MathML"><mm:mn>3</mm:mn></mm:math></p>
</body>
</html>`

function namespacedBook(): Buffer {
  return sampleEpub({
    'OEBPS/text/ch01.xhtml': DECLARED_HERE,
    'OEBPS/text/ch02.xhtml': DECLARED_ABOVE,
  })
}

const WORKER = process.env['TEST_PARALLEL_INDEX'] ?? '0'
const workDir = resolve(process.cwd(), '.tmp', 'e2e', `${process.ppid}`, `ns-w${WORKER}`)
const siteDir = join(workDir, 'site')

/**
 * One worker for this file, because the builds are the cost and the tests are not.
 *
 * Under `fullyParallel` every `beforeAll` runs once per worker, so five workers
 * would build the same fixture five times and serve it five times while five
 * other suites are doing the same — and the extra contention is not free for the
 * suites that measure layout and computed styles right after a swap.
 */
test.describe.configure({ mode: 'serial' })

let server: RunningServer
let baseURL: string

test.beforeAll(async () => {
  await rm(workDir, { recursive: true, force: true })
  await mkdir(siteDir, { recursive: true })
  const epubPath = await writeEpub(workDir, namespacedBook(), 'namespaces.epub')
  await build(epubPath, { out: siteDir })
  server = await startServer({ root: siteDir })
  baseURL = server.url
})

test.afterAll(async () => {
  await server?.close()
})

/** Loads the reader, without opening a chapter. */
async function startReader(page: Page): Promise<void> {
  await page.goto(`${baseURL}/epubsite.html`)
  await page.waitForFunction(() => document.documentElement.dataset['epubsite'] === 'ready')
}

/**
 * Opens a chapter through the sidebar of the reader already on screen.
 *
 * `.click()` on the link rather than `goto`, because the defect only exists on
 * the swapped path: `goto` would load the chapter as a document, and the XML
 * parser resolves the prefix there.
 */
async function clickChapter(page: Page, key: string): Promise<void> {
  await page.evaluate((entryKey) => {
    document
      .querySelector<HTMLAnchorElement>(`#epubsite-toc a[data-key="${entryKey}"]`)
      ?.click()
  }, key)
  await page.waitForFunction(
    (entryKey) =>
      document.querySelector('#epubsite-toc a[aria-current="page"]')?.getAttribute('data-key') ===
      entryKey,
    key,
  )
}

async function openChapter(page: Page, key: string): Promise<void> {
  await startReader(page)
  await clickChapter(page, key)
}

/** Every element under the content pane whose name still carries a prefix. */
function prefixedNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#epubsite-content *')]
      .map((element) => element.localName)
      .filter((name) => name.includes(':')),
  )
}

test('a prefixed MathML formula is laid out as MathML, not as unknown markup', async ({ page }) => {
  await openChapter(page, 'OEBPS/text/ch01.xhtml')

  // The repair is complete, not partial: an unknown `mml:mrow` would still be
  // an unknown element even if the formula around it were fixed.
  expect(await prefixedNames(page)).toEqual([])

  const math = await page.evaluate((namespace) => {
    const elements = [...document.querySelectorAll('#epubsite-content math')]
    const display = elements.find((element) => element.getAttribute('display') === 'block')
    const fraction = display?.querySelector('mfrac')
    return {
      count: elements.length,
      allInNamespace: elements.every((element) => element.namespaceURI === namespace),
      // Values only the MathML UA stylesheet produces: unknown elements are
      // `inline`, and `block math` is the box the browser gives a display
      // formula. The inline formula computes to plain `math`.
      fractionDisplay: fraction === null || fraction === undefined ? null : getComputedStyle(fraction).display,
      displayDisplay: display === undefined ? null : getComputedStyle(display).display,
      inlineDisplay:
        elements.length > 1 ? getComputedStyle(elements[0] as Element).display : null,
    }
  }, MATHML)

  expect(math.count).toBe(2)
  expect(math.allInNamespace).toBe(true)
  expect(math.fractionDisplay).toBe('block math')
  expect(math.displayDisplay).toBe('block math')
  expect(math.inlineDisplay).toBe('math')
})

test('a prefixed SVG is an SVG, so its fill paints', async ({ page }) => {
  await openChapter(page, 'OEBPS/text/ch01.xhtml')

  const drawing = await page.evaluate((namespace) => {
    const svg = document.querySelector('#epubsite-content svg')
    const rect = svg?.querySelector('rect')
    return {
      svgNamespace: svg?.namespaceURI ?? null,
      rectNamespace: rect?.namespaceURI ?? null,
      // `fill` is a presentation attribute: an element in the wrong namespace
      // ignores it, and the box stays transparent.
      fill: rect === null || rect === undefined ? null : getComputedStyle(rect).fill,
      rectWidth: rect === null || rect === undefined ? null : rect.getBoundingClientRect().width,
      expected: namespace,
    }
  }, SVG)

  expect(drawing.svgNamespace).toBe(SVG)
  expect(drawing.rectNamespace).toBe(SVG)
  expect(drawing.fill).toBe('rgb(4, 5, 6)')
  expect(drawing.rectWidth).toBe(40)
})

test('the prefix survives a declaration the swap did not keep', async ({ page }) => {
  // `xmlns:mml` on `<html>` is dropped with the rest of the chapter's head and
  // root element, so the repair cannot look it up. The four formulas are the
  // detector for a pass that only handled the ones it could resolve: three use
  // the well-known `mml`, and one declares an unusual `mm` on the element that
  // names it.
  await openChapter(page, 'OEBPS/text/ch02.xhtml')

  expect(await prefixedNames(page)).toEqual([])

  const count = await page.evaluate(
    (namespace) =>
      [...document.querySelectorAll('#epubsite-content math')].filter(
        (element) => element.namespaceURI === namespace,
      ).length,
    MATHML,
  )
  expect(count).toBe(4)
})

test('going back re-parses into the correct namespace without another pass', async ({ page }) => {
  // htmx restores a chapter from its own snapshot, which is serialised markup:
  // the serializer writes a namespaced element by its local name, so the
  // re-parse lands in MathML by itself (§5.15). This is that claim, measured —
  // and it is why `historyRestore` is not wired to the repair.
  await startReader(page)
  await clickChapter(page, 'OEBPS/text/ch01.xhtml')
  await clickChapter(page, 'OEBPS/text/ch02.xhtml')

  await page.evaluate(() => history.back())
  await page.waitForFunction(
    () =>
      document.querySelector('#epubsite-toc a[aria-current="page"]')?.getAttribute('data-key') ===
      'OEBPS/text/ch01.xhtml',
  )

  const restored = await page.evaluate((namespace) => {
    const elements = [...document.querySelectorAll('#epubsite-content math')]
    const display = elements.find((element) => element.getAttribute('display') === 'block')
    const fraction = display?.querySelector('mfrac')
    return {
      prefixed: [...document.querySelectorAll('#epubsite-content *')].filter((element) =>
        element.localName.includes(':'),
      ).length,
      inNamespace: elements.every((element) => element.namespaceURI === namespace),
      fractionDisplay: fraction === null || fraction === undefined ? null : getComputedStyle(fraction).display,
    }
  }, MATHML)

  expect(restored.prefixed).toBe(0)
  expect(restored.inNamespace).toBe(true)
  expect(restored.fractionDisplay).toBe('block math')
})

test('the bare chapter is the control, and is unchanged', async ({ page }) => {
  // Served as `application/xhtml+xml`, this file always worked — the XML parser
  // resolves the prefix. The assertion is here so that a fixture mistake cannot
  // masquerade as a shell defect.
  await page.goto(`${baseURL}/OEBPS/text/ch01.xhtml`)

  const count = await page.evaluate(
    (namespace) =>
      [...document.querySelectorAll('math')].filter((element) => element.namespaceURI === namespace)
        .length,
    MATHML,
  )
  expect(count).toBe(2)
})
