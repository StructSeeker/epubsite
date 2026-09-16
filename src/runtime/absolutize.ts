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
 *     like `#toc a` silently misses the next shell link someone adds, and the
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
