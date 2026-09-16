/**
 * Navigation extraction (spec §4.3, §12).
 *
 * Two formats, one tree. EPUB 3 puts the table of contents in a `nav.xhtml`'s
 * `<nav epub:type="toc">`; EPUB 2 puts it in a `toc.ncx` `<navMap>`. Books in
 * the wild carry either, or both, and a reader that understands only one shows
 * an empty sidebar — the failure looks like a rendering bug and is actually a
 * parsing gap.
 *
 * The four href rules (§4.3) are the whole of the difficulty, and the third one
 * is the reason this module exists rather than ten lines inside the build:
 *
 *   1. `text/ch01.xhtml`        → relative to the navigation document's directory
 *   2. `../text/ch01.xhtml`     → same, with `..` collapsed
 *   3. `#s1`                    → **the file of the last href that had a path**
 *   4. `https://…`              → external, kept for display, never in the SPA
 *
 * Rule 3 contradicts the XML specification, which would resolve a bare fragment
 * against the navigation document itself — a file nobody wants to be sent to.
 * Real books use `#s1` to mean "an anchor in the chapter I just mentioned", so
 * that is what we implement. Without it, every second-level entry in every book
 * with a nested table of contents either disappears or points at the wrong
 * file. Because the rule is inherently sequential, the resolution is a single
 * left-to-right walk with a cursor, not a map over the tree.
 */
import { attr, attrLocal, childElements, childrenNamed, findAll, localName, textOf, type XmlNode } from './xml'
import { resolveRef, splitFragment, type EntryPath } from '../../shared/paths'

export interface NavNode {
  readonly label: string
  /** Where this entry points, or `undefined` for a grouping heading. */
  readonly entryPath: EntryPath | undefined
  /** Fragment without the leading `#`; empty when absent. */
  readonly fragment: string
  /** An absolute URL: shown in the table of contents, never fetched by the SPA. */
  readonly external: boolean
  /** The href as written, for diagnostics. `undefined` for a heading. */
  readonly href: string | undefined
  readonly children: readonly NavNode[]
}

export interface NavTree {
  /** The table of contents: entries whose documents are in the spine (§4.3). */
  readonly toc: readonly NavNode[]
  /**
   * `epub:type="landmarks"` entries, plus table-of-contents entries that point
   * at documents outside the spine — covers, copyright pages and similar (§4.3).
   */
  readonly landmarks: readonly NavNode[]
}

export const EMPTY_NAV: NavTree = { toc: [], landmarks: [] }

/** One node's worth of information about a chapter, keyed by its entry path. */
export interface NavEntry {
  /** The label of the deepest entry that points at this exact document. */
  readonly label: string
  /** The label of its parent in the tree, for `articleSection` (§7.5). */
  readonly section: string | undefined
}

/**
 * Parses an EPUB 3 navigation document.
 *
 * @param spinePaths Entry paths of the spine documents; anything else in the
 *   table of contents becomes a landmark rather than a chapter (§4.3).
 */
export function parseNavigation(
  doc: XmlNode,
  navPath: EntryPath,
  spinePaths: ReadonlySet<string>,
): NavTree {
  const navs = findAll(doc, ['nav'])
  const tocNav = navs.find((nav) => hasType(nav, 'toc')) ?? navs[0]

  const toc = tocNav === undefined ? [] : readOl(firstOl(tocNav), navPath)
  const landmarksFromNav = navs
    .filter((nav) => hasType(nav, 'landmarks'))
    .flatMap((nav) => readOl(firstOl(nav), navPath))

  const { toc: inSpine, landmarks: outsideSpine } = partitionBySpine(toc, spinePaths)
  return { toc: inSpine, landmarks: [...landmarksFromNav, ...outsideSpine] }
}

/**
 * Parses an EPUB 2 NCX.
 *
 * `<navMap>` is the table of contents. NCX `<navList>` sections (page lists,
 * landmark proxies) are deliberately ignored: they duplicate the spine and the
 * reader has its own way of presenting them.
 */
export function parseNcx(
  doc: XmlNode,
  ncxPath: EntryPath,
  spinePaths: ReadonlySet<string>,
): NavTree {
  const navMap = findAll(doc, ['navMap'])[0]
  if (navMap === undefined) return EMPTY_NAV

  const cursor: Cursor = { last: undefined }
  const toc = childrenNamed(navMap, 'navPoint').map((point) => readNavPoint(point, ncxPath, cursor))
  const { toc: inSpine, landmarks: outsideSpine } = partitionBySpine(toc, spinePaths)
  return { toc: inSpine, landmarks: outsideSpine }
}

/**
 * Where each chapter's label comes from, keyed by entry path.
 *
 * **Document order wins**, deliberately. Consider the common shape
 *
 *   <li><a href="ch1.xhtml">Chapter 1</a>
 *     <ol><li><a href="ch1.xhtml#s1">Section 1.1</a></li></ol>
 *   </li>
 *
 * where one document is named twice. "The deepest label wins" sounds more
 * precise but produces "Section 1.1" as the name of chapter one — worse, not
 * better. The outermost entry is what the book's own table of contents calls
 * that document, so that is the label the sidebar shows.
 */
export function navIndex(tree: NavTree): Map<string, NavEntry> {
  const index = new Map<string, NavEntry>()

  const walk = (nodes: readonly NavNode[], section: string | undefined): void => {
    for (const node of nodes) {
      if (node.entryPath !== undefined && !index.has(node.entryPath)) {
        index.set(node.entryPath, { label: node.label, section })
      }
      walk(node.children, node.label === '' ? section : node.label)
    }
  }

  walk(tree.toc, undefined)
  walk(tree.landmarks, undefined)
  return index
}

/** Reverse for RTL, which is a presentation concern and never touches the model (§12). */
export function presentationNav(
  nodes: readonly NavNode[],
  progression: 'ltr' | 'rtl',
): readonly NavNode[] {
  if (progression !== 'rtl') return nodes
  return [...nodes].reverse().map((node) => ({
    ...node,
    children: presentationNav(node.children, progression),
  }))
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The "last file seen" cursor that rule 3 needs. */
interface Cursor {
  last: EntryPath | undefined
}

function hasType(element: XmlNode, value: string): boolean {
  const type = attrLocal(element, 'type')
  return type !== undefined && type.split(/\s+/).includes(value)
}

function firstOl(element: XmlNode): XmlNode | undefined {
  return childElements(element).find((child) => localName(child) === 'ol')
}

function readOl(ol: XmlNode | undefined, base: EntryPath, cursor?: Cursor): NavNode[] {
  if (ol === undefined) return []
  const state: Cursor = cursor ?? { last: undefined }
  return childrenNamed(ol, 'li').map((li) => readListItem(li, base, state))
}

function readListItem(li: XmlNode, base: EntryPath, cursor: Cursor): NavNode {
  const labelElement = childElements(li).find(
    (child) => localName(child) === 'a' || localName(child) === 'span',
  )
  const label = collapse(labelElement === undefined ? '' : textOf(labelElement))
  const href = labelElement === undefined ? undefined : attr(labelElement, 'href')

  // The order of these two statements is the rule. Rule 3 looks backwards in
  // *document* order, and an element's own href is read before its children's,
  // so the cursor must have already seen this node's target by the time the
  // children are resolved. Computing `nested` first — which reads naturally, and
  // which is what this did before a test caught it — makes every nested entry
  // inherit the *previous* file instead of its own parent's.
  const resolved = resolveHref(href, base, cursor)
  const nested = readOl(firstOl(li), base, cursor)

  return { ...resolved, label, children: nested }
}

function readNavPoint(point: XmlNode, base: EntryPath, cursor: Cursor): NavNode {
  const navLabel = childrenNamed(point, 'navLabel')[0]
  const label = collapse(navLabel === undefined ? '' : textOf(navLabel))
  const content = childrenNamed(point, 'content')[0]
  const href = content === undefined ? undefined : attr(content, 'src')

  // Parent before children, for the same reason as `readListItem`.
  const resolved = resolveHref(href, base, cursor)
  const nested = childrenNamed(point, 'navPoint').map((child) => readNavPoint(child, base, cursor))

  return { ...resolved, label, children: nested }
}

/**
 * Applies rules 1–4 and advances the cursor.
 *
 * The cursor advances only for a href that names a file. A bare fragment
 * inherits the file but does not change it — that is what makes
 * `<li><a href="#s1">` and a following `<li><a href="#s2">` both land in the
 * same chapter, which is the behaviour rule 3 exists to produce.
 */
function resolveHref(
  href: string | undefined,
  base: EntryPath,
  cursor: Cursor,
): Pick<NavNode, 'entryPath' | 'fragment' | 'external' | 'href'> {
  if (href === undefined || href.trim() === '') {
    return { entryPath: undefined, fragment: '', external: false, href: undefined }
  }

  if (isExternal(href)) {
    return { entryPath: undefined, fragment: '', external: true, href }
  }

  const { path, fragment } = splitFragment(href)

  if (path === '') {
    // Rule 3. Falling back to the navigation document itself keeps the XML
    // behaviour for a book that opens with a bare fragment and has no earlier
    // href to inherit from.
    const owner = cursor.last ?? base
    return { entryPath: owner, fragment, external: false, href }
  }

  const resolved = resolveRef(base, path)
  if (resolved.kind !== 'file') {
    return { entryPath: undefined, fragment, external: false, href }
  }

  cursor.last = resolved.path
  return { entryPath: resolved.path, fragment, external: false, href }
}

/** Rule 4: an absolute URL, including a protocol-relative one. */
function isExternal(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('//')
}

/**
 * Splits the table of contents into spine entries and everything else (§4.3).
 *
 * A node without a target is a grouping heading and always stays: it is what
 * holds the nesting together. A node pointing outside the spine takes its whole
 * subtree to the landmarks — its children are subsections of that same
 * out-of-spine document, so promoting them would invent chapters that the book
 * does not have in its reading order.
 */
function partitionBySpine(
  nodes: readonly NavNode[],
  spinePaths: ReadonlySet<string>,
): { toc: NavNode[]; landmarks: NavNode[] } {
  const toc: NavNode[] = []
  const landmarks: NavNode[] = []

  for (const node of nodes) {
    if (node.entryPath !== undefined && !spinePaths.has(node.entryPath)) {
      landmarks.push(node)
      continue
    }
    const split = partitionBySpine(node.children, spinePaths)
    toc.push({ ...node, children: split.toc })
    landmarks.push(...split.landmarks)
  }

  return { toc, landmarks }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
