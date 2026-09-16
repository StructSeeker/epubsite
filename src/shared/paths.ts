/**
 * URL-path helpers (spec C.1).
 *
 * Everything here operates on **URL paths**: always `/`-separated, never OS
 * paths, never percent-encoded. This module is compiled into the browser bundle
 * as well as the Node build, so it must stay dependency-free — the eslint
 * config enforces that.
 *
 * "Entry path" always means a path *inside the EPUB container*, relative to the
 * container root, e.g. `OEBPS/text/ch03.xhtml`. Because the site root IS the
 * EPUB root (spec §3.1), an entry path is also the site-relative URL path.
 */

declare const entryPathBrand: unique symbol

/**
 * A path *inside the EPUB container*: root-relative, `/`-separated, normalised,
 * and never starting with `/`.
 *
 * This is a branded type on purpose. Before it existed, `string` carried two
 * incompatible meanings — an absolute URL path (leading `/`) and a container
 * entry path (no leading `/`) — and `normalize()` could produce the former where
 * the latter was expected. That let `/OEBPS/text/ch02.xhtml` flow into an
 * entry-path slot unchallenged, which is a bug that type-checks and then fails
 * at runtime, several layers away from its cause.
 *
 * The only way to produce one is {@link toEntryPath}, so the conflation cannot
 * recur.
 */
export type EntryPath = string & { readonly [entryPathBrand]: 'EntryPath' }

/**
 * Smart constructor for {@link EntryPath}.
 *
 * Normalises and strips a leading slash, so `'/OEBPS/a.xhtml'` and
 * `'OEBPS/./a.xhtml'` both become `'OEBPS/a.xhtml'`. That translation is exactly
 * right for a *manifest href*, where a leading `/` legitimately means the
 * container root.
 *
 * It also means this function **launders** an absolute path rather than
 * rejecting it, which would be wrong for a *ZIP entry name*, where a leading `/`
 * is a zip-slip marker. That distinction is enforced where the name enters the
 * system — see `escapesContainer` being applied to the raw entry name in
 * `src/build/epub/zip.ts` before this constructor is ever called.
 *
 * Escaping through `..` is likewise not rejected here: this function guarantees
 * *shape*, and `checkEntryPath` owns validity and its exit code.
 */
export function toEntryPath(path: string): EntryPath {
  const normalized = normalize(path)
  return (normalized.startsWith('/') ? normalized.slice(1) : normalized) as EntryPath
}

/**
 * A resolved reference.
 *
 * Modelled as a union rather than "`path` is empty means same file", because the
 * empty-string convention is exactly the kind of implicit sentinel a caller
 * forgets to check.
 */
export type Ref =
  | { readonly kind: 'fragment-only'; readonly fragment: string }
  | { readonly kind: 'file'; readonly path: EntryPath; readonly fragment: string }

/** A raw href split into its two syntactic halves, before any resolution. */
export interface SplitHref {
  /** Path portion as written. Empty for a pure fragment. */
  readonly path: string
  /** Fragment without the leading '#'. Empty when absent. */
  readonly fragment: string
}

/** Splits `a/b.xhtml#c` into `{ path: 'a/b.xhtml', fragment: 'c' }`. */
export function splitFragment(href: string): SplitHref {
  const hash = href.indexOf('#')
  if (hash === -1) return { path: href, fragment: '' }
  return { path: href.slice(0, hash), fragment: href.slice(hash + 1) }
}

/**
 * Directory portion of an entry path, **with** a trailing slash, because that is
 * what relative-URL resolution needs: `dirOf('a/b.xhtml') === 'a/'`.
 * Returns `''` for a top-level file.
 */
export function dirOf(entryPath: EntryPath): string {
  const slash = entryPath.lastIndexOf('/')
  return slash === -1 ? '' : entryPath.slice(0, slash + 1)
}

/** Final segment of an entry path. `basename('a/b.xhtml') === 'b.xhtml'`. */
export function basename(entryPath: EntryPath): string {
  const slash = entryPath.lastIndexOf('/')
  return slash === -1 ? entryPath : entryPath.slice(slash + 1)
}

/** Lowercase extension including the dot, or `''`. */
export function extname(entryPath: EntryPath): string {
  const name = basename(entryPath)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * Collapses `.` and `..` segments (RFC 3986 remove_dot_segments, simplified).
 *
 * A trailing slash is NOT preserved: every caller here deals with files.
 * Leading `..` survives on relative paths and is dropped on absolute paths,
 * matching URL resolution against a container root.
 */
export function normalize(entryPath: string): string {
  const absolute = entryPath.startsWith('/')
  const out: string[] = []

  for (const segment of entryPath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      const last = out[out.length - 1]
      if (last !== undefined && last !== '..') out.pop()
      else if (!absolute) out.push('..')
      // On an absolute path, '..' at the root is a no-op.
      continue
    }
    out.push(segment)
  }

  const body = out.join('/')
  return absolute ? `/${body}` : body
}

/**
 * Resolves a reference found *inside* `fromEntry` against that file's directory.
 *
 * A pure fragment yields `kind: 'fragment-only'`, which callers must handle
 * explicitly — the previous "empty path means same file" convention was a
 * sentinel that was easy to forget.
 *
 * A leading `/` means the container root (spec I3 forbids it in *generated*
 * output, but real books contain such hrefs and we must read them correctly).
 */
export function resolveRef(fromEntry: EntryPath, href: string): Ref {
  const { path, fragment } = splitFragment(href)
  if (path === '') return { kind: 'fragment-only', fragment }
  const joined = path.startsWith('/') ? path : dirOf(fromEntry) + path
  return { kind: 'file', path: toEntryPath(joined), fragment }
}

/** True when the path escapes the container root (spec §10 zip-slip defence). */
export function escapesContainer(entryPath: string): boolean {
  if (entryPath.startsWith('/')) return true
  if (/^[a-zA-Z]:/.test(entryPath)) return true // drive letter
  return normalize(entryPath).split('/').includes('..')
}

/**
 * Percent-encodes an entry path for use in a URL, segment by segment, so that
 * separators are preserved but spaces and non-ASCII are escaped.
 */
export function toUrlPath(entryPath: EntryPath): string {
  return entryPath.split('/').map(encodeURIComponent).join('/')
}

/** Percent-decodes a URL path segment, tolerating malformed input. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// ---------------------------------------------------------------------------
// Reserved namespace (spec §3.2)
// ---------------------------------------------------------------------------

/**
 * Paths owned by the build. Because the book occupies the site root, these must
 * be impossible to collide with.
 *
 * `.epubsite-root` is the 404 guide's root marker (§8.3). It is not in the
 * spec's §3.2 table — see spec-v1.2.md for the amendment adding it.
 */
export const RESERVED_PATHS = {
  shell: 'epubsite.html',
  transit: 'index.html',
  guide: '404.html',
  manifest: 'publication.json',
  assetsDir: '_epubsite_assets/',
  hostingDir: '_hosting/',
  rootMarker: '.epubsite-root',
} as const

/** True for a basename in the token namespace, i.e. `@ch03.xhtml` (§12). */
export function isTokenBasename(name: string): boolean {
  return name.startsWith('@')
}

/**
 * File names inside {@link RESERVED_PATHS.assetsDir} (spec §3.1).
 *
 * Shared between the build, which writes them, and the runtime, which fetches
 * them. Two literals in two layers is how a rename becomes a 404 that only shows
 * up in a browser: the build would keep writing `shell.js` while the runtime
 * asked for something else, and both halves would look correct on their own.
 */
export const SHELL_ASSETS = {
  shellJs: 'shell.js',
  shellCss: 'shell.css',
  htmx: 'htmx.esm.js',
  shellData: 'shell-data.json',
  iconSvg: 'icon.svg',
  /** A directory, hence the trailing slash. */
  pagefindDir: 'pagefind/',
} as const

/**
 * True for any entry whose presence would collide with the reserved
 * namespace. `index.html` is deliberately excluded: the book's own file wins
 * and the build simply does not generate a transit page (§3.2, §8.2).
 *
 * `shellName` is a parameter because `--name` moves the shell (§9). With
 * `--name custom.html` it is `custom.html` that would be overwritten, and a
 * book file called `epubsite.html` is then an ordinary file that gets copied
 * verbatim like any other. Hard-coding the default name here would have made
 * the check report the wrong file in both directions.
 */
export function collidesWithReserved(
  entryPath: EntryPath,
  shellName: string = RESERVED_PATHS.shell,
): boolean {
  const name = basename(entryPath)
  if (name === RESERVED_PATHS.transit) return false
  if (entryPath === shellName) return true
  if (entryPath === RESERVED_PATHS.guide) return true
  if (entryPath === RESERVED_PATHS.manifest) return true
  if (entryPath === RESERVED_PATHS.rootMarker) return true
  if (entryPath.startsWith(RESERVED_PATHS.assetsDir)) return true
  if (entryPath.startsWith(RESERVED_PATHS.hostingDir)) return true
  return isTokenBasename(name)
}
