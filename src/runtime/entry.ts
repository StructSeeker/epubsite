/**
 * The entry protocol (spec §8.2, §8.4).
 *
 * The reader can be reached three ways, and the order they are tested in is
 * significant:
 *
 *   1. `?p=…` — the 404 guide's route. The guide already knows the chapter and
 *      says so explicitly, so this wins outright.
 *   2. an `@`-basename — the hosted-rewrite route (§8.4), where the URL is
 *      preserved and the token is the only signal available. Implemented even
 *      though `--hosting rewrite` is not, because it costs one branch and
 *      because the guide writes `?p=` only *after* checking the same pattern:
 *      the two must agree, and the surest way is for one function to own both.
 *   3. anything else — the landing page.
 *
 * `index.html` deliberately does not participate. It has exactly one job, "send a
 * bare site-root visit to the reader", and it must not carry parameters; mixing
 * the two is the one mistake that silently turns every shared deep link into the
 * landing page (§8.2, §8.3 constraint 5).
 *
 * `applyFragment` and the `history.replaceState` that uses it are separated on
 * purpose: the state replacement must happen **before** any content is parsed
 * (§5.4.1 step 3), because from that moment on the document base is the
 * chapter's directory and every relative URL in the chapter resolves correctly.
 * Doing it after the fetch is the bug that makes a chapter's images 404.
 */
import { fromToken } from '../shared/token'

export interface Entry {
  /** Chapter path relative to the site root: exactly a `shell-data.json` key. */
  readonly key: string
  /** Fragment without the leading `#`; empty when there is none. */
  readonly fragment: string
}

export function resolveEntry(root: URL): Entry | null {
  const params = new URLSearchParams(location.search)
  const fromQuery = params.get('p')
  if (fromQuery !== null && fromQuery !== '') {
    return { key: stripLeadingSlash(fromQuery), fragment: params.get('h') ?? '' }
  }

  const real = fromToken(location.pathname)
  if (real === null) return null
  // `real` is still percent-encoded and still carries the deployment prefix;
  // stripping the prefix leaves the site-relative path the shell data is keyed by.
  return {
    key: stripLeadingSlash(real.slice(root.pathname.length)),
    fragment: decodeFragment(location.hash),
  }
}

/** The URL the reader should be *at*, once the entry has been honoured. */
export function entryUrl(root: URL, entry: Entry): URL {
  const url = new URL(entry.key, root)
  if (entry.fragment !== '') url.hash = entry.fragment
  return url
}

/** The URL to fetch: the same chapter, without the fragment (`#` is not sent). */
export function entryRequestUrl(root: URL, entry: Entry): string {
  return new URL(entry.key, root).href
}

function stripLeadingSlash(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value
}

function decodeFragment(hash: string): string {
  if (hash.length < 2) return ''
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return hash.slice(1)
  }
}
