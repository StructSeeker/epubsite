/**
 * The `index.html` transit page (spec §3.1, §8.2, §8.3 constraint 5).
 *
 * Its job is *only* "someone opened the site root; send them to the reader".
 * That narrowness is the design: the shell carries every entry decision — the
 * `?p=` / `?h=` parameters and the `@`-basename rule — and the transit page
 * carries none.
 *
 * Mixing the two is the single mistake that silently breaks the whole token
 * chain. If a `?p=` entry were routed through here, a page that does not
 * forward `location.search` would drop the parameter, and the shared deep link
 * would degrade into the landing page with nothing anywhere reporting a
 * failure. So the constraint is stated twice on purpose — here, in the
 * forwarding, and in the tests as "an entry with parameters does not lose
 * them" (§13.2).
 *
 * Three requirements this file must keep satisfying:
 *
 *   1. **Self-contained, zero external references.** It is served from the site
 *      root, but the same reasoning as §8.3 constraint 1 applies: a generated
 *      entry file that depends on the asset directory is a file that can be
 *      moved, renamed, or copied out of the site and stop working.
 *   2. **`location.replace()`, not `location.href`.** Assigning `href` pushes a
 *      history entry, so Back returns to the transit page, which immediately
 *      bounces forward again — an inescapable loop (§8.3 constraint 4).
 *   3. **Forward `search` and `hash`, with a relative target.** The relative
 *      form keeps the page correct under any deployment prefix below the root,
 *      because it resolves against where the page actually is.
 *
 * It is not generated when the book already has a top-level `index.html`: the
 * book's own file wins and this page is skipped (§3.2, §8.2). That is a real
 * cost of the flat layout and it is documented rather than worked around —
 * renaming a file inside someone's book is not ours to do.
 */
import { html, scriptString, type SafeHtml } from './escape'
export function renderTransitPage(shellName: string): SafeHtml {
  // `scriptString` rather than `serializeJson`: script content in HTML is raw
  // text, so the value must not pass through the HTML escaper. The wrapper
  // makes that impossible to forget.
  const target = scriptString(shellName)

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening the reader…</title>
<script>location.replace(${target} + location.search + location.hash);</script>
</head>
<body>
<p>Opening the reader… If nothing happens, <a href="${shellName}">continue to the reader</a>.</p>
</body>
</html>
`
}
