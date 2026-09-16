/**
 * The 404 guide (spec §8.2, §8.3, §4.7).
 *
 * This is the file that makes a shared chapter link work. A token path does not
 * exist on disk by construction, so the server answers 404 — and this page, which
 * the host serves *in place of* the missing file, turns that 404 into the reader
 * at the right chapter.
 *
 * It is the most constrained file in the project, because it is served at an
 * arbitrary depth with no manifest, no network help, and no control over where it
 * lands. §8.3 lists five constraints; each one maps to a line below.
 *
 *   1. **Completely self-contained.** It runs at `/OEBPS/text/deep/@ch03.xhtml`,
 *      where a relative `<script src="_epubsite_assets/x.js">` would be
 *      requested from `/OEBPS/text/deep/_epubsite_assets/…` and 404 again. So
 *      there are no external references at all: the token transform is *inlined*
 *      (compiled from the same `src/shared/token.ts` the reader uses), and the
 *      probe below is deliberately relative because being relative is its job.
 *   2. **It must find the site root.** `'../'.repeat(n)` arithmetic is wrong the
 *      moment the site is deployed under a prefix, and a guide that redirects to
 *      the wrong place is worse than one that does nothing. So it probes for
 *      `/.epubsite-root` — a uniquely named marker, *not* `index.html`, because
 *      EPUBs routinely ship their own `index.html` (§8.3). `.epubsite-root` is a
 *      name no book can occupy: the build refuses to run if a book contains it
 *      (§3.2).
 *   3. **Only `@`-shaped paths are redirected.** A missing image must produce a
 *      404 page, not a chapter load. Without this, every broken asset in a book
 *      would be disguised as "the reader is starting", which is the kind of
 *      defect that takes an afternoon to find.
 *   4. **`location.replace()`, never `location.href`.** Assigning `href` leaves
 *      the 404 in history, so Back lands on it and it bounces forward again —
 *      a loop the user cannot escape.
 *   5. (The transit page's constraint; see `transit.ts`.)
 *
 * The redirect targets `epubsite.html` **directly, never `index.html`**. Routing
 * a `?p=` entry through the transit page is the one mistake that silently
 * degrades every shared link into the landing page: the transit page would have
 * to forward the query string, and one that forgets loses `?p=` and `?h=` with
 * nothing reporting a failure (§8.2).
 */
import { RESERVED_PATHS } from '../../shared/paths'
import { html, inlineScript, scriptString, type SafeHtml } from './escape'

export interface Guide404Input {
  /** The shell's file name, so `--name` moves the redirect target too (§9). */
  shellName: string
  /** The compiled token IIFE, inlined verbatim (§C.4.2). */
  tokenScript: string
}

export function renderGuide404(input: Guide404Input): SafeHtml {
  const marker = scriptString(RESERVED_PATHS.rootMarker)
  const shell = scriptString(input.shellName)

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found</title>
<style>
body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 3rem 1.5rem; color: #111; }
main { max-width: 40rem; margin: 0 auto; }
h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
p { margin: 0 0 1rem; color: #444; }
a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>Page not found</h1>
<p>That file is not part of this book. If you followed a shared link to a
chapter, it may have been created against a different version of the site.</p>
<p><a id="start" href="/">Start from the beginning</a></p>
</main>
<script>${inlineScript(input.tokenScript)}</script>
<script>
(function () {
  'use strict'

  var MARKER = ${marker}
  var SHELL = ${shell}

  findSiteRoot(function (root) {
    // The link above defaults to "/", which is right for a root deployment and
    // wrong under a path prefix. It costs nothing to correct it here, and this
    // script only runs for a *document* 404 — a missing image never executes it.
    var start = document.getElementById('start')
    if (start !== null) start.href = new URL(SHELL, root).href

    // Constraint 3: only a token path is redirected. Everything else keeps the
    // page above, so a missing asset is never disguised as a starting reader.
    if (!epubsiteToken.isTokenPath(location.pathname)) return
    var realPath = epubsiteToken.fromToken(location.pathname)
    if (realPath === null) return

    // Strip the deployment prefix, not just the leading slash: "p" is read
    // relative to the site root, and at /sub/a/@c.xhtml the chapter's
    // site-relative path is "a/c.xhtml", not "sub/a/c.xhtml".
    var relative = realPath.slice(root.pathname.length)
    var url = new URL(SHELL, root)
    // URLSearchParams does the encoding. Splicing a raw pathname into a query
    // string would break on any book whose file names contain "&" or "=".
    url.searchParams.set('p', safeDecode(relative))
    if (location.hash.length > 1) url.searchParams.set('h', safeDecode(location.hash.slice(1)))
    // Constraint 4.
    location.replace(url.href)
  })

  /**
   * Constraint 2: find the site root by probing for its marker.
   *
   * **Deepest first, one at a time, stopping at the first hit.** The deepest
   * candidate — going up one level per path segment — is the origin root, which
   * is exactly where the site root is for the overwhelmingly common case of a
   * deployment at the origin. So the common case costs *one* request and produces
   * *no* failed ones; a deployment under a path prefix walks up until it finds
   * the marker, costing at most one round trip per level.
   *
   * Probing all candidates at once would answer faster and would fire one
   * deliberate 404 per level on every missing path — which turns a clean network
   * log into one that needs explaining, and makes the zero-4xx detector useless
   * as a signal. Latency here is on an error path nobody is watching.
   */
  function findSiteRoot(done) {
    var depth = location.pathname.split('/').length - 2
    if (depth <= 0) {
      done(new URL('./', location.href))
      return
    }

    var candidate = depth
    function attempt() {
      if (candidate <= 0) {
        // No marker anywhere: the site predates this feature, or the host does
        // not serve dotfiles. The naive count is right for a root deployment —
        // the default — and it is the only guess available.
        done(new URL(repeatUp(depth), location.href))
        return
      }
      var level = candidate
      candidate -= 1
      fetch(repeatUp(level) + MARKER, { method: 'HEAD' }).then(
        function (response) {
          if (response.ok) done(new URL(repeatUp(level), location.href))
          else attempt()
        },
        // A failed fetch is a 404 on most hosts that do not serve dotfiles at
        // all, so it is treated exactly like a miss rather than as a crash.
        function () { attempt() },
      )
    }
    attempt()
  }

  function repeatUp(times) {
    var out = ''
    for (var i = 0; i < times; i += 1) out += '../'
    return out
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value)
    } catch (error) {
      return value
    }
  }
})();
</script>
</body>
</html>
`
}
