/**
 * The token transform (spec §8.2, §12).
 *
 * A **token path** is a chapter's real path with `@` prefixed to its basename:
 *
 *   real    /OEBPS/text/ch03.xhtml      a file that exists; opening it gives a
 *                                       bare page with no reader around it
 *   token   /OEBPS/text/@ch03.xhtml     no such file; the server 404s, the guide
 *                                       catches it and routes into the reader
 *
 * Only the basename differs. That is not a stylistic choice: it is I1's hard
 * requirement (§2.1). If the directory differed, every relative URL in the
 * chapter would resolve against the wrong base once the reader loaded it. Keeping
 * the directory identical means the URL a reader sees after the reader has taken
 * over is *already* the one the content needs.
 *
 * The transform is a pure function and a bijection, which is what lets the 404
 * guide — a static file at an arbitrary depth, with no access to the manifest —
 * recover the real path from nothing but the URL.
 *
 * This module is compiled three ways from this one source (C.4.2): imported by
 * the build for its bijection assertion, bundled into `shell.js` for the share
 * button, and compiled to a standalone IIFE that is inlined into `404.html`.
 * Hand-writing a second copy for the guide would make the bijection test
 * meaningless, so the toolchain does the duplicating.
 *
 * **Paths only.** Query strings and fragments are the caller's business: the
 * share button keeps them, the entry protocol reads them, and neither belongs
 * inside a function whose whole job is a bijection on pathnames.
 */

/**
 * `@`-prefixes the basename.
 *
 * Returns `null` when there is nothing to transform, and the caller must decide
 * what that means rather than being handed a plausible-looking wrong answer:
 *
 *   - a path with no basename (`/a/b/`) — there is no file to address;
 *   - a path that is already a token — tokenising twice would produce
 *     `@@ch01.xhtml`, which no server and no guide would recognise.
 */
export function toToken(pathname: string): string | null {
  const { dir, base } = split(pathname)
  if (base === '' || base.startsWith('@')) return null
  return `${dir}@${base}`
}

/**
 * Removes the `@` from the basename, recovering the real path.
 *
 * Returns `null` for anything that is not a token path. That check is constraint
 * 3 of §8.3 and it is the difference between a working site and a broken one: a
 * missing image must produce a 404 page, not a redirect into the reader. If the
 * guide hijacked every missing path, a broken image would silently turn into
 * "loading a chapter" and the real cause would take an hour to find.
 */
export function fromToken(pathname: string): string | null {
  const { dir, base } = split(pathname)
  if (!base.startsWith('@')) return null
  const rest = base.slice(1)
  if (rest === '') return null
  return `${dir}${rest}`
}

/** True when this pathname addresses a chapter through the reader (§8.3). */
export function isTokenPath(pathname: string): boolean {
  return fromToken(pathname) !== null
}

function split(pathname: string): { dir: string; base: string } {
  const slash = pathname.lastIndexOf('/')
  // No slash at all is a relative pathname; treat the whole thing as the
  // basename so the transform still round-trips. Callers pass `location.pathname`
  // or a URL pathname, both of which start with `/`, but a function that only
  // works on one of its plausible inputs is a trap.
  if (slash === -1) return { dir: '', base: pathname }
  return { dir: pathname.slice(0, slash + 1), base: pathname.slice(slash + 1) }
}
