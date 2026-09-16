/**
 * Injecting a chapter's styles into the shell's head (spec §5.4.3, §5.5).
 *
 * htmx swaps in the chapter's *body*. Nothing from its `<head>` comes with it,
 * so without this step every chapter after the first would render unstyled.
 *
 * Two rules shape the implementation:
 *
 *   1. **Everything is wrapped in `@layer epub`.** `shell.css` declares
 *      `@layer epub, shell`, so the book's rules lose to the reader's chrome
 *      regardless of specificity. That is what keeps a book's `body { margin }`
 *      from moving the toolbar.
 *
 *   2. **`@import` cannot live inside a layer block**, so an external stylesheet
 *      is pulled in by an `@import url(…) layer(epub);` rule of its own — a
 *      one-rule stylesheet, which is the only place `@import` is legal — while
 *      inline styles are wrapped in `@layer epub { … }`. The book's own top-level
 *      imports were lifted out at build time for exactly this reason (§4.4).
 *
 * The diff is coarse on purpose. The key sequence is compared as a whole, and
 * when it differs the sheet is rebuilt from scratch. The case that matters is the
 * one this optimises for: re-entering the *same* chapter — history restore,
 * a fragment link, a second click on the current entry — does nothing at all,
 * rather than re-parsing a book's stylesheet and flashing the page.
 */
import type { ChapterData } from './data'

/** Everything we put in the head, so it can be removed again. */
const injected = new Map<string, HTMLStyleElement>()
let currentSequence = ''

export function syncStyles(chapter: ChapterData, root: URL): void {
  const wanted = wantedSheets(chapter, root)
  const sequence = wanted.map((sheet) => sheet.key).join('\u0000')
  if (sequence === currentSequence) return

  for (const element of injected.values()) element.remove()
  injected.clear()

  for (const sheet of wanted) {
    const element = document.createElement('style')
    element.textContent = sheet.css
    document.head.appendChild(element)
    injected.set(sheet.key, element)
  }

  currentSequence = sequence
}

/** Clears the book's styles, for the landing page and for a failed lookup. */
export function clearStyles(): void {
  if (currentSequence === '') return
  for (const element of injected.values()) element.remove()
  injected.clear()
  currentSequence = ''
}

interface Sheet {
  key: string
  css: string
}

function wantedSheets(chapter: ChapterData, root: URL): Sheet[] {
  const sheets: Sheet[] = []

  // External stylesheets come first, because `@import` rules must precede other
  // rules within the stylesheet that contains them. Each one is its own
  // `<style>`, so the ordering that matters is between them.
  for (const ref of [...chapter.headStyles.imports, ...chapter.headStyles.links]) {
    const url = new URL(ref, root).href
    sheets.push({ key: `import:${url}`, css: `@import url("${cssUrl(url)}") layer(epub);` })
  }

  chapter.headStyles.inline.forEach((body, index) => {
    sheets.push({ key: `inline:${index}:${body}`, css: `@layer epub {${body}}` })
  })

  return sheets
}

/**
 * Escapes a URL for use inside a CSS string.
 *
 * Only `\` and `"` can end the string early. Percent-encoding the rest would be
 * wrong: the URL is already a URL, and encoding it again would break every
 * character that is legal there.
 */
function cssUrl(url: string): string {
  return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * The chapter's JSON-LD block (§5.6).
 *
 * Injected into `<head>` rather than travelling with the swapped content, and
 * that is not a preference: `allowScriptTags = false` (§10) makes htmx discard
 * every `<script>` in a response — including `type="application/ld+json"` — so a
 * script that rode along inside `#epub-content` would simply never exist. An
 * element we create ourselves is not subject to that rule, which is how both the
 * security measure and the metadata get what they want.
 *
 * Cleanup removes **only** `[data-epub-ld]` blocks. The book's node is static and
 * unmarked, so it is never touched — and a reader who navigates for an hour still
 * has exactly one book node and one chapter node in the document.
 */
const ldBlocks = new Map<string, HTMLScriptElement>()

export function syncJsonLd(node: Record<string, unknown> | undefined): void {
  for (const element of ldBlocks.values()) element.remove()
  ldBlocks.clear()
  if (node === undefined) return

  const element = document.createElement('script')
  element.type = 'application/ld+json'
  element.dataset.epubLd = ''
  // `<` is the only character that can end the block early; the JSON escape
  // parses back to the same value (render/escape.ts explains the rule).
  element.textContent = JSON.stringify(node).replace(/</g, '\\u003c')
  document.head.appendChild(element)

  const id = typeof node['@id'] === 'string' ? node['@id'] : ''
  ldBlocks.set(id, element)
}
