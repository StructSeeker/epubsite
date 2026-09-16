/**
 * Reference audit (spec §12, C.3.3).
 *
 * Two findings the build reports without acting on, because neither is a defect
 * in the book and both change what a deployed site does:
 *
 *   **external resources**  absolute URLs to other origins. They are never
 *                           rewritten and they work exactly as written — but they
 *                           are a privacy and availability dependency the
 *                           publisher may not have realised they shipped, and a
 *                           reader on a plane will find out the hard way.
 *
 *   **out-of-tree links**   relative references that climb out of the container.
 *                           Nothing can satisfy them: the site root *is* the book
 *                           root (§3.1), so `../../etc/passwd` addresses a
 *                           sibling of the site, which the build does not create
 *                           and the host does not serve.
 *
 * Reporting rather than failing is deliberate. A book with a broken link is still
 * a readable book, and refusing to build it would trade a cosmetic defect for a
 * total one. `Diagnostics` exists for exactly this (C.3.3), and the codes are
 * stable strings so a CI job can assert on them.
 */
import { attr, isElement, type XmlNode } from './epub/xml'
import { escapesContainer, resolveRef, type EntryPath } from '../shared/paths'

export interface DocumentAudit {
  /** Absolute URLs, in document order, deduplicated. */
  externalRefs: string[]
  /** Raw relative references that resolve outside the container. */
  outOfTreeRefs: string[]
}

/**
 * Every attribute that can address another resource.
 *
 * `srcset` and `imagesrcset` are listed separately from `src` even though they
 * carry `src`, because §5.3 calls them out: they are *second-pass* references
 * that the browser re-resolves after an element is inserted, which is why they
 * cannot be fixed up by rewriting the DOM and why they have to be right in the
 * first place. An audit that ignored them would miss the exact case the spec
 * warns about.
 */
const REFERENCE_ATTRIBUTES = ['href', 'src', 'poster', 'data', 'srcset', 'imagesrcset'] as const

export function auditDocument(doc: XmlNode, chapterPath: EntryPath): DocumentAudit {
  const external = new Set<string>()
  const outOfTree = new Set<string>()

  const walk = (node: XmlNode): void => {
    if (isElement(node)) {
      for (const name of REFERENCE_ATTRIBUTES) {
        const value = attr(node, name)
        if (value === undefined || value === '') continue
        for (const candidate of splitCandidates(name, value)) {
          classify(candidate, chapterPath, external, outOfTree)
        }
      }
    }
    for (const child of node.children) walk(child)
  }
  walk(doc)

  return { externalRefs: [...external].sort(), outOfTreeRefs: [...outOfTree].sort() }
}

/**
 * `srcset` is a comma-separated list of `url [descriptor]` pairs, so the naive
 * read of the attribute would classify `"a.png 1x, b.png 2x"` as one path and
 * report nonsense. The comma split is a small lie — a URL may legally contain a
 * comma — but it errs towards reporting *more* references, and a false positive
 * in an advisory report is cheaper than a missed external dependency.
 */
function splitCandidates(name: string, value: string): string[] {
  if (name !== 'srcset' && name !== 'imagesrcset') return [value.trim()]
  return value
    .split(',')
    .map((part) => (part.trim().split(/\s+/)[0] ?? '').trim())
    .filter((part) => part !== '')
}

function classify(
  raw: string,
  chapterPath: EntryPath,
  external: Set<string>,
  outOfTree: Set<string>,
): void {
  // Fragments are internal anchors, never resources.
  if (raw.startsWith('#')) return

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith('//')) {
    // `mailto:` and `javascript:` are not resources either; only report things a
    // browser would actually fetch.
    if (/^(https?|ftp|ws|wss):/i.test(raw) || raw.startsWith('//')) external.add(raw)
    return
  }

  const resolved = resolveRef(chapterPath, raw)
  if (resolved.kind !== 'file') return
  // `resolveRef` has already collapsed the path, so an escaping reference now
  // begins with `..` rather than merely containing it.
  if (escapesContainer(resolved.path)) outOfTree.add(raw)
}
