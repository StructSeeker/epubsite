/**
 * The addresses a chapter page is reachable at (spec §7.3, §8.5).
 *
 * A chapter has two URLs, and they are not interchangeable:
 *
 *   real    /OEBPS/text/ch03.xhtml     a file that exists; opening it gives the
 *                                      chapter as a bare page, no reader around it
 *   token   /OEBPS/text/@ch03.xhtml    no such file; the server 404s and the guide
 *                                      (§8.2) routes the reader into the shell
 *
 * A crawler that only ever sees the first will index the bare page, which is a
 * perfectly good reading experience but not the one this site is for. Listing
 * both says "this chapter is reachable at either address", which is true.
 *
 * **Only the runtime can do this.** The build knows where the site will be
 * deployed — that is what `--base-url` is — but not where it is actually being
 * served from at the moment a reader opens a chapter. The dynamic node is
 * therefore decorated here, with the URL the reader really arrived at, rather
 * than baked in at build time. That also means it works with the default
 * relative `--base-url`, where the build emits no `url` at all.
 *
 * `pageUrl` is a parameter rather than read from `location` so that the whole
 * thing is a pure function of its inputs. The interesting cases here are not
 * visual — a duplicate URL, a missing token, a stray fragment — and they are far
 * cheaper to pin in a unit test than to arrange in a browser.
 */
import { toToken } from '../shared/token'

/**
 * Returns a copy of `node` whose `url` lists the chapter's real and token
 * addresses.
 *
 * A copy, never the original: the node comes from the `shell-data.json` object
 * the runtime fetched once and keeps for the life of the page. Mutating it would
 * make the result depend on how many times the reader had visited the chapter.
 */
export function withChapterUrls(
  node: Record<string, unknown>,
  pageUrl: URL,
): Record<string, unknown> {
  const urls = existingUrls(node['url'])

  // `toToken` returns null for a path with no basename or one that is already a
  // token, and both are ordinary rather than exceptional, so the token address is
  // simply absent in those cases.
  //
  // Compared in canonical form, not as strings. Two spellings of one address are
  // one address, and the build has no way to produce the browser's spelling: it
  // emits the entry path as it appears in the zip, while `location.href` has been
  // through `new URL(…)` — see `canonical`. Comparing the raw strings would list a
  // chapter named `a b.xhtml` twice, once with a space and once with `%20`.
  const seen = new Set(urls.map(canonical))
  for (const address of [pageAddress(pageUrl).href, tokenAddress(pageUrl)]) {
    if (address === null) continue
    const key = canonical(address)
    if (seen.has(key)) continue
    seen.add(key)
    urls.push(address)
  }

  return { ...node, url: urls }
}

/**
 * The page itself: origin and path, with the query and the fragment removed.
 *
 * `url` names the chapter *document*. A fragment addresses a point inside it, and
 * the build-time `url` — when an absolute `--base-url` produced one — never
 * carries a fragment either, so including one only at runtime would make the two
 * entries inconsistent with each other.
 */
function pageAddress(pageUrl: URL): URL {
  const url = new URL(pageUrl.href)
  url.search = ''
  url.hash = ''
  return url
}

/** The same page addressed through the reader (§8.2), or `null` when it cannot be. */
function tokenAddress(pageUrl: URL): string | null {
  const url = pageAddress(pageUrl)
  const token = toToken(url.pathname)
  if (token === null) return null
  url.pathname = token
  return url.href
}

/**
 * A URL in the form a browser would write it, for comparing two URLs.
 *
 * Only ever used as a set key, never as the value that is returned: the caller's
 * existing entries are preserved exactly as they were found.
 *
 * A relative value cannot be made absolute without a base, and a malformed one
 * cannot be parsed at all. Returning the raw string in those cases is the honest
 * answer — it compares equal only to itself, which is the right amount of
 * matching to claim about something that is not a URL.
 */
function canonical(address: string): string {
  try {
    return new URL(address).href
  } catch {
    return address
  }
}

/**
 * `url` as a list: absent, a single string, or already a list.
 *
 * All three occur. The build emits nothing under the default relative
 * `--base-url`, a single string when `--base-url` is absolute, and a list once
 * this function has run — and the runtime may decorate the same node again after
 * a navigation that returns to the chapter.
 */
function existingUrls(value: unknown): string[] {
  // Normalise to a list first and filter once. Doing it per-shape invites the two
  // branches to disagree about what counts as a usable URL — which they did: a
  // bare `''` was dropped while an `''` inside a list was kept, and an empty entry
  // in `url` asserts that the chapter is reachable at the empty address.
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return entries.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
}
