/**
 * Absolutising the shell's own links (spec §5.3, I2).
 *
 * `pushState` moves the document base. Everything relative in the document is
 * then resolved against the chapter's directory, so the sidebar's
 * `OEBPS/text/ch01.xhtml` becomes `…/text/OEBPS/text/ch01.xhtml`. This is not an
 * htmx quirk; it is what changing the path of a document *means*.
 *
 * Two decisions worth keeping:
 *
 *   - Links are marked with `data-shell` rather than selected by CSS. A selector
 *     like `#epubsite-toc a` silently misses the next shell link someone adds, and the
 *     failure appears only after a navigation, on a page nobody tested.
 *   - `setAttribute` is used rather than `a.href =`, so the content attribute and
 *     the IDL property stay in sync. Assigning `a.href` rewrites only the
 *     property on some paths, and the markup then disagrees with the DOM.
 *
 * The `data-abs` guard makes the pass idempotent, so it is safe to call again
 * after the shell's own DOM changes — which is exactly what a drawer, a theme
 * toggle or a re-render will do.
 */
export function absolutizeShell(root: URL): void {
  const links = document.querySelectorAll<HTMLAnchorElement>('[data-shell][href]')
  for (const link of links) {
    if (link.dataset.abs === '1') continue
    const href = link.getAttribute('href')
    if (href === null) continue
    link.setAttribute('href', new URL(href, root).href)
    link.dataset.abs = '1'
  }
}

/**
 * The subresource attributes a chapter can carry, and the ones a later base
 * change can quietly break.
 *
 * `srcset` is included because an image that has one is requested through it,
 * and its candidates are URLs with descriptors attached.
 */
const SUBRESOURCES: ReadonlyArray<readonly [selector: string, attribute: string]> = [
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['audio[src]', 'src'],
  ['video[src]', 'src'],
  ['track[src]', 'src'],
  ['video[poster]', 'poster'],
]

/**
 * Pins a chapter's subresource URLs to the base in force when it was inserted.
 *
 * Called on every swap, while the document still names the chapter that markup
 * came from. Without it, this is a real defect rather than a cosmetic one:
 * htmx's history snapshot stores the previous chapter's markup as HTML and
 * re-inserts it into the document *after* the address bar has moved on, so a
 * relative `../Images/pic.png` is re-resolved against the new chapter's
 * directory — a 404 nobody sees except in the network log, on every Back step.
 *
 * Links are deliberately left alone: they are only fetched when clicked, and
 * absolutising them would change what the reader's own navigation compares.
 */
export function absolutizeContent(content: ParentNode | null, base: string): void {
  if (content === null) return

  for (const [selector, attribute] of SUBRESOURCES) {
    for (const element of content.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute)
      if (value === null || value === '') continue
      element.setAttribute(attribute, new URL(value, base).href)
    }
  }

  for (const element of content.querySelectorAll('[srcset]')) {
    const value = element.getAttribute('srcset')
    if (value === null || value.trim() === '') continue
    element.setAttribute('srcset', absolutizeSrcset(value, base))
  }
}

/** Rewrites each candidate URL in a `srcset`, keeping its descriptor. */
function absolutizeSrcset(value: string, base: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim()
      if (trimmed === '') return ''
      const [url, ...descriptor] = trimmed.split(/\s+/)
      const absolute = new URL(url as string, base).href
      return [absolute, ...descriptor].join(' ')
    })
    .filter((candidate) => candidate !== '')
    .join(', ')
}
