/**
 * Per-chapter head extraction (spec §4.4, §5.4, §5.5).
 *
 * Everything a chapter needs in order to look like itself has to be captured at
 * build time, because the runtime never parses XHTML: htmx swaps in the chapter's
 * *body*, and nothing from its `<head>` comes with it. Without this, every
 * chapter in the reader would render with the book's stylesheet missing — which
 * looks like a styling bug and is actually a structural one.
 *
 * Doing it here rather than at runtime is §4.4's stated reason: parsing risk
 * belongs in the phase that can be unit-tested, and the runtime should only ever
 * do table lookups.
 *
 * Two transformations happen here, both so the runtime can stay trivial:
 *
 *   - `linkStyless` are resolved against the chapter's own directory into
 *     **site-relative** paths. The runtime then only has to prefix `SITE_ROOT`,
 *     and never has to know where in the book a chapter lives.
 *   - `@import` rules inside an inline `<style>` are lifted out (see `css.ts`),
 *     because they cannot legally live inside the `@layer epub` block the
 *     runtime wraps the rest of the sheet in.
 */
import { attr, childElements, childrenNamed, findFirst, localName, plainText, textOf, type XmlNode } from './xml'
import { splitTopLevelImports } from '../css'
import { decodeSegment, dirOf, resolveRef, type EntryPath } from '../../shared/paths'

/** A resolved stylesheet reference: a site-relative path, or an absolute URL. */
export type StyleRef = { kind: 'path'; path: EntryPath } | { kind: 'external'; href: string }

export interface ChapterHead {
  /** External stylesheets, resolved to site-relative paths where possible. */
  readonly links: readonly StyleRef[]
  /** `@import` rules lifted out of inline styles, resolved the same way. */
  readonly imports: readonly StyleRef[]
  /** Inline `<style>` bodies, with their top-level imports removed. */
  readonly inline: readonly string[]
  /** `class` of the chapter's `<body>`, which an innerHTML swap would discard. */
  readonly bodyClass: string
  /** `dir` of `<html>` or `<body>`; `null` when the chapter does not say. */
  readonly dir: string | null
  /** `lang` of `<html>` or `<body>`; `null` when the chapter does not say. */
  readonly lang: string | null
  /** `<title>`, for the browser tab and as a label fallback (§12). */
  readonly title: string | null
  /** First `<h1>`, the last resort before the position (§12). */
  readonly h1: string | null
}

export const EMPTY_HEAD: ChapterHead = {
  links: [],
  imports: [],
  inline: [],
  bodyClass: '',
  dir: null,
  lang: null,
  title: null,
  h1: null,
}

/**
 * Extracts a chapter's head.
 *
 * @param chapterPath Where the chapter lives, which decides how its relative
 *   references resolve. Passing the wrong one is not a crash, it is a chapter
 *   whose stylesheet 404s — so the value comes from the manifest, never from
 *   guesswork.
 */
export function parseChapterHead(doc: XmlNode, chapterPath: EntryPath): ChapterHead {
  const html = findFirst(doc, ['html'])
  const body = findFirst(doc, ['body'])
  const head = findFirst(doc, ['head'])
  if (head === undefined) return { ...EMPTY_HEAD, ...bodyFacts(html, body) }

  const links: StyleRef[] = []
  for (const element of childElements(head)) {
    if (localName(element) !== 'link') continue
    const rel = attr(element, 'rel') ?? ''
    // `rel` is a token list: `stylesheet alternate` and `preload stylesheet`
    // both occur, and matching the whole attribute would miss them.
    if (!rel.split(/\s+/).includes('stylesheet')) continue
    const href = attr(element, 'href')
    if (href === undefined || href.trim() === '') continue
    const ref = resolveStyleRef(chapterPath, href)
    if (ref !== undefined) links.push(ref)
  }

  const imports: StyleRef[] = []
  const inline: string[] = []
  for (const element of childrenNamed(head, 'style')) {
    const split = splitTopLevelImports(textOf(element))
    for (const rule of split.imports) {
      const target = importTarget(rule)
      if (target === undefined) continue
      const ref = resolveStyleRef(chapterPath, target)
      if (ref !== undefined) imports.push(ref)
    }
    if (split.body.trim() !== '') inline.push(split.body)
  }

  return { links, imports, inline, ...bodyFacts(html, body) }
}

/**
 * `dir`, `lang`, `title` and `h1`.
 *
 * `dir` and `lang` may sit on either `<html>` or `<body>`: XHTML allows both, and
 * books use each. `<body>` wins because it is the closer ancestor of the
 * content, which is what a browser would use.
 */
function bodyFacts(
  html: XmlNode | undefined,
  body: XmlNode | undefined,
): Omit<ChapterHead, 'links' | 'imports' | 'inline'> {
  const dir = attributeIn(body, html, 'dir')
  const lang = attributeIn(body, html, 'lang') ?? attributeIn(body, html, 'xml:lang')
  const titleElement = html === undefined ? undefined : findFirst(html, ['title'])
  const title = titleElement === undefined ? null : collapse(textOf(titleElement))
  const h1Element = body === undefined ? undefined : findFirst(body, ['h1'])
  const h1 = h1Element === undefined ? null : plainText(textOf(h1Element))

  return {
    bodyClass: body === undefined ? '' : (attr(body, 'class') ?? ''),
    dir: dir === null || dir === '' ? null : dir,
    lang: lang === null || lang === '' ? null : lang,
    title: title === null || title === '' ? null : title,
    h1: h1 === null || h1 === '' ? null : h1,
  }
}

function attributeIn(first: XmlNode | undefined, second: XmlNode | undefined, name: string): string | null {
  const value = (first === undefined ? undefined : attr(first, name)) ?? (second === undefined ? undefined : attr(second, name))
  return value ?? null
}

/**
 * Turns a stylesheet reference into something the runtime can anchor to the site
 * root.
 *
 * An absolute URL stays absolute: it is external, it is reported as a diagnostic,
 * and re-basing it against the site would be actively wrong.
 *
 * Returns `undefined` for a pure fragment. `href="#x"` on a `<link rel=stylesheet>`
 * and `@import url(#x)` are both meaningless, and resolving a fragment through
 * the file resolver would launder it into a path and produce a 404 that nothing
 * in the build can explain. Dropping it is the correct reading of a rule that
 * says nothing useful.
 */
export function resolveStyleRef(from: EntryPath, href: string): StyleRef | undefined {
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return undefined

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
    return { kind: 'external', href: trimmed }
  }

  const resolved = resolveRef(from, trimmed)
  if (resolved.kind !== 'file') return undefined
  return { kind: 'path', path: resolved.path }
}

/**
 * The URL inside an `@import` rule.
 *
 * Both syntaxes occur in real books — `@import url("x.css")` and the older
 * `@import "x.css"` — and so does the media-query tail, which is discarded here
 * because the runtime re-emits the rule with a `layer()` tail of its own.
 *
 * Fragments are rejected rather than resolved: `@import url(#x)` is meaningless,
 * and a fragment that reached the file resolver would be laundered into a path
 * and produce a 404 nobody could explain.
 */
function importTarget(rule: string): string | undefined {
  const rest = rule.slice('@import'.length).trim()
  const urlForm = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/.exec(rest)
  if (urlForm !== null) {
    const value = urlForm[1] ?? urlForm[2] ?? urlForm[3] ?? ''
    return value === '' ? undefined : value
  }
  const stringForm = /^(?:"([^"]*)"|'([^']*)')/.exec(rest)
  if (stringForm !== null) {
    const value = stringForm[1] ?? stringForm[2] ?? ''
    return value === '' ? undefined : value
  }
  return undefined
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** The directory a chapter's relative references resolve against, for diagnostics. */
export function chapterDir(chapterPath: EntryPath): string {
  return dirOf(chapterPath)
}

/** Percent-decoded form of one path segment; exported for the runtime's benefit. */
export { decodeSegment }
