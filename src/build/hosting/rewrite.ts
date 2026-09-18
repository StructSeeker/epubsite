/**
 * Host rewriting rules — **deliberately unimplemented** (spec §8.4, §C.6.1, §4.8).
 *
 * This module exists so that the feature has a home, a name, and a contract,
 * instead of being silently absent. `--hosting rewrite` and `--hosting all`
 * fail fast with exit code 2 and a message that points at the documented reason,
 * rather than producing a site that looks fine and quietly serves the wrong
 * status codes.
 *
 * ---------------------------------------------------------------------------
 * What implementing this means
 * ---------------------------------------------------------------------------
 *
 * The whole point of §8.4 is a trade, and it is worth stating plainly because
 * everything below follows from it: rewriting lets token paths answer **200**
 * instead of 404, which makes shared links indexable — and the price is
 * portability. Once the shell is served from an arbitrary depth, `SITE_ROOT`
 * can no longer be derived from `location` (I4) and must be baked in at build
 * time.
 *
 * The work is therefore, in full:
 *
 * 1. **Bake `data-site-root`** onto `<html>` (§5.2.3). The runtime already
 *    reads it (`document.documentElement.dataset.siteRoot || '.'`); without the
 *    attribute that fallback is what you get, which is the 404-mode behaviour
 *    and wrong for every deep path under rewrite.
 *
 * 2. **Absolutise every static reference in the shell** — not just the root.
 *    §C.6.1 is explicit that `<link href="_epubsite_assets/shell.css">`,
 *    `<script src="_epubsite_assets/shell.js">` and `<link rel="canonical">`
 *    are document-relative too, so under rewrite they resolve to
 *    `/OEBPS/text/_epubsite_assets/…` and 404, violating G4. This is the same
 *    trade, already paid for; there is no extra cost to accept.
 *
 * 3. **Emit `_hosting/*`** (§3.1, §4.8), derived from the book's real chapter
 *    paths and `--base-url`:
 *      - Netlify / Cloudflare Pages — `_redirects`, one line matching the
 *        token form and targeting /epubsite.html with status 200
 *      - Vercel — `vercel.json` with a `rewrites` array
 *      - nginx — a `location ~ /@[^/]+\.(x?html)$ { try_files /epubsite.html =404; }` snippet
 *      - optional site-root 301: `/  /epubsite.html  301`, which replaces the
 *        JavaScript transit page with a real redirect and lets `index.html` be
 *        dropped entirely — cleaner for SEO, and the only case where a
 *        `canonical` pointing at the site root becomes defensible (§8.5).
 *    Rewrite targets must **not** carry a query string: the URL is preserved,
 *    so `location.pathname` is already the token path and both `SITE_ROOT` and
 *    the document base are naturally correct. Writing `/epubsite.html?p=…`
 *    would move the base to `/` and force a repair that did not need to exist.
 *
 * 4. **Accept the path form of `--base-url`.** It is validated today but has no
 *    output effect (`src/build/options.ts` explains why); under rewrite it
 *    becomes the source of the baked root. Everything else in the flag's
 *    behaviour — the absolute form enabling the *landing page's* `canonical`,
 *    JSON-LD `url` and `image` — is unchanged and orthogonal.
 *
 * ---------------------------------------------------------------------------
 * What must not change
 * ---------------------------------------------------------------------------
 *
 * `--hosting none | 404` is the default and the portable mode: the shell is
 * always served from its own location, `SITE_ROOT` comes from `location`
 * (I4), and the artifact can be moved between hosts and URL prefixes without
 * being rebuilt. Rewriting trades that away, so it must stay opt-in and must
 * never become the default by accident.
 *
 * The token path itself is unaffected either way. It remains a routing token
 * whose only purpose is the share button (§5.8) — never `readingOrder`, never
 * `canonical`, never Open Graph (§8.5, C.7). Rewriting changes the status code
 * a token path answers with, not what it means.
 */
import type { HostingMode } from '../options'
import { NotImplementedFeatureError } from '../errors'

/** True for the modes this build cannot honour yet. */
export function requiresHostingRules(mode: HostingMode): boolean {
  return mode === 'rewrite' || mode === 'all'
}

/**
 * Rejects the unimplemented hosting modes.
 *
 * Called once, from `build()`, before any output is produced — a build that
 * fails must not leave half a site behind, and the cleanest way to guarantee
 * that is to decide before the first byte is written.
 */
export function assertHostingImplemented(mode: HostingMode): void {
  if (!requiresHostingRules(mode)) return

  throw new NotImplementedFeatureError(
    `--hosting ${mode} is not implemented: hosting rewrite rules are the one ` +
      'documented gap (spec §8.4 / §C.6.1). Use --hosting 404 (default) or ' +
      '--hosting none, which need no platform configuration and keep the ' +
      'artifact portable. The full implementation contract is in the header of ' +
      'src/build/hosting/rewrite.ts.',
  )
}
