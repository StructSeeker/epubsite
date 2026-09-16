/**
 * The site root, and why it has to be frozen (spec §5.2.2, I4).
 *
 * `new URL('.', location.href)` is only correct while the document is *at* the
 * site root. The whole entry protocol (§8) exists to keep that true: the 404
 * guide always navigates to `{SITE_ROOT}epubsite.html`, never to a deep path.
 *
 * Freezing matters more than it looks. Once `history.replaceState` or a boosted
 * navigation moves `location` to a chapter, every relative URL in the document
 * is re-resolved — that is the mechanism I1 relies on, and it is also how a
 * sidebar link silently doubles its path prefix. Capturing the root once, in a
 * module-level constant, means the shell's own references cannot be re-based by
 * anything that happens later.
 *
 * The `data-site-root` branch is §5.2.3. It is always absent today because
 * `--hosting rewrite` is not implemented (§8.4), so the fallback is currently
 * the only path taken — but it is the specified contract for that mode, and
 * implementing the mode is a matter of emitting the attribute, since this side
 * already reads it.
 */
export function freezeSiteRoot(): URL {
  const baked = document.documentElement.dataset.siteRoot
  return new URL(baked === undefined || baked === '' ? '.' : baked, location.href)
}
