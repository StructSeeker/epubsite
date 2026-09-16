/**
 * Navigation extraction (spec §4.3).
 *
 * Rule 3 — a bare `#fragment` belongs to the file last mentioned, not to the
 * navigation document — is the reason this module is not ten lines inside the
 * build. It is also the rule that fails silently: the tree still builds, the
 * sidebar still renders, and every second-level entry points at a file nobody
 * wants. So the tests are written around it.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_NAV,
  navIndex,
  parseNavigation,
  parseNcx,
  presentationNav,
  type NavNode,
} from '../../src/build/epub/nav'
import { parseXml } from '../../src/build/epub/xml'
import { toEntryPath } from '../../src/shared/paths'

const NAV = toEntryPath('OEBPS/nav.xhtml')
const NCX = toEntryPath('OEBPS/toc.ncx')

function spine(...paths: string[]): Set<string> {
  return new Set(paths)
}

function nav3(inner: string, spinePaths = spine('OEBPS/text/a.xhtml', 'OEBPS/text/b.xhtml')) {
  return parseNavigation(
    parseXml(`<html xmlns:epub="http://www.idpf.org/2007/ops"><body>${inner}</body></html>`),
    NAV,
    spinePaths,
  )
}

function hrefs(nodes: readonly NavNode[]): string[] {
  return nodes.flatMap((node) => [
    node.entryPath === undefined ? '(none)' : node.entryPath,
    ...hrefs(node.children),
  ])
}

describe('parseNavigation — the four href rules (§4.3)', () => {
  it('rule 1: resolves a relative href against the navigation document', () => {
    const tree = nav3('<nav epub:type="toc"><ol><li><a href="text/a.xhtml">A</a></li></ol></nav>')
    expect(tree.toc[0]?.entryPath).toBe('OEBPS/text/a.xhtml')
    expect(tree.toc[0]?.label).toBe('A')
  })

  it('rule 2: collapses .. against the navigation document', () => {
    const tree = nav3('<nav epub:type="toc"><ol><li><a href="../OEBPS/text/a.xhtml">A</a></li></ol></nav>')
    expect(tree.toc[0]?.entryPath).toBe('OEBPS/text/a.xhtml')
  })

  it('rule 3: a bare fragment belongs to the last file that had a path', () => {
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><a href="text/a.xhtml">A</a>
        <ol>
          <li><a href="#a1">A1</a></li>
          <li><a href="#a2">A2</a></li>
        </ol>
      </li>
      <li><a href="text/b.xhtml">B</a></li>
    </ol></nav>`)

    const a = tree.toc[0]
    expect(a?.children.map((child) => child.entryPath)).toEqual([
      'OEBPS/text/a.xhtml',
      'OEBPS/text/a.xhtml',
    ])
    expect(a?.children.map((child) => child.fragment)).toEqual(['a1', 'a2'])
    // The cursor is per document, not per list: B still resolves normally.
    expect(tree.toc[1]?.entryPath).toBe('OEBPS/text/b.xhtml')
  })

  it('rule 3: a leading fragment falls back to the navigation document itself', () => {
    // Nothing to inherit from. The XML behaviour is wrong but it is at least
    // defined, and a book that opens this way has no better answer available.
    const tree = nav3(
      '<nav epub:type="toc"><ol><li><a href="#intro">Intro</a></li></ol></nav>',
      spine('OEBPS/nav.xhtml'),
    )
    expect(tree.toc[0]?.entryPath).toBe('OEBPS/nav.xhtml')
  })

  it('rule 3: a fragment does not move the cursor', () => {
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><a href="text/a.xhtml">A</a></li>
      <li><a href="#x">X</a></li>
      <li><a href="#y">Y</a></li>
    </ol></nav>`)
    expect(hrefs(tree.toc)).toEqual([
      'OEBPS/text/a.xhtml',
      'OEBPS/text/a.xhtml',
      'OEBPS/text/a.xhtml',
    ])
  })

  it('rule 4: an absolute URL is external and never a container path', () => {
    const tree = nav3(
      '<nav epub:type="toc"><ol><li><a href="https://example.com/x">X</a></li></ol></nav>',
    )
    expect(tree.toc[0]).toMatchObject({ external: true, entryPath: undefined })
  })

  it('rule 4: a protocol-relative URL counts as external too', () => {
    const tree = nav3('<nav epub:type="toc"><ol><li><a href="//cdn.example.com/x">X</a></li></ol></nav>')
    expect(tree.toc[0]?.external).toBe(true)
  })
})

describe('parseNavigation — structure', () => {
  it('keeps nesting', () => {
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><a href="text/a.xhtml">Part one</a>
        <ol><li><a href="text/b.xhtml">Chapter</a></li></ol>
      </li>
    </ol></nav>`)
    expect(tree.toc).toHaveLength(1)
    expect(tree.toc[0]?.children[0]?.label).toBe('Chapter')
  })

  it('keeps a grouping item that has no link', () => {
    // The list structure carries the meaning; an empty anchor here would be a
    // focus stop with no accessible name.
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><span>Volume I</span>
        <ol><li><a href="text/a.xhtml">A</a></li></ol>
      </li>
    </ol></nav>`)
    expect(tree.toc[0]).toMatchObject({ label: 'Volume I', entryPath: undefined, external: false })
    expect(tree.toc[0]?.children[0]?.entryPath).toBe('OEBPS/text/a.xhtml')
  })

  it('collapses whitespace in labels', () => {
    const tree = nav3(
      '<nav epub:type="toc"><ol><li><a href="text/a.xhtml">\n  Chapter\n  one\n </a></li></ol></nav>',
    )
    expect(tree.toc[0]?.label).toBe('Chapter one')
  })

  it('prefers epub:type="toc" over the first nav element', () => {
    const tree = nav3(`<nav epub:type="landmarks"><ol><li><a href="text/a.xhtml">Start</a></li></ol></nav>
      <nav epub:type="toc"><ol><li><a href="text/b.xhtml">Contents</a></li></ol></nav>`)
    expect(tree.toc.map((node) => node.entryPath)).toEqual(['OEBPS/text/b.xhtml'])
    expect(tree.landmarks.map((node) => node.label)).toEqual(['Start'])
  })

  it('renders an empty tree rather than throwing on a document with no nav', () => {
    expect(nav3('<p>nothing here</p>')).toEqual(EMPTY_NAV)
  })
})

describe('parseNavigation — spine filtering (§4.3, §12)', () => {
  it('moves entries outside the spine to the landmarks', () => {
    const tree = nav3(
      `<nav epub:type="toc"><ol>
        <li><a href="text/a.xhtml">Chapter 1</a></li>
        <li><a href="cover.xhtml">Cover</a></li>
      </ol></nav>`,
      spine('OEBPS/text/a.xhtml'),
    )

    expect(tree.toc.map((node) => node.label)).toEqual(['Chapter 1'])
    expect(tree.landmarks.map((node) => node.label)).toEqual(['Cover'])
  })

  it('takes a filtered entry’s whole subtree with it, rather than promoting its children', () => {
    // The children are subsections of an out-of-spine document. Promoting them
    // would invent chapters the book does not have in its reading order.
    const tree = nav3(
      `<nav epub:type="toc"><ol>
        <li><a href="front.xhtml">Front matter</a>
          <ol><li><a href="front.xhtml#copy">Copyright</a></li></ol>
        </li>
        <li><a href="text/a.xhtml">Chapter 1</a></li>
      </ol></nav>`,
      spine('OEBPS/text/a.xhtml'),
    )

    expect(tree.toc.map((node) => node.label)).toEqual(['Chapter 1'])
    expect(tree.landmarks).toHaveLength(1)
    expect(tree.landmarks[0]?.children[0]?.label).toBe('Copyright')
  })

  it('keeps a grouping heading even when its own children are filtered out', () => {
    const tree = nav3(
      `<nav epub:type="toc"><ol>
        <li><span>Volume I</span><ol><li><a href="front.xhtml">Cover</a></li></ol></li>
      </ol></nav>`,
      spine(),
    )
    expect(tree.toc).toHaveLength(1)
    expect(tree.toc[0]?.children).toEqual([])
    expect(tree.landmarks.map((node) => node.label)).toEqual(['Cover'])
  })
})

describe('parseNcx — EPUB 2', () => {
  it('reads a nested navMap', () => {
    const tree = parseNcx(
      parseXml(`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
        <navPoint id="n1"><navLabel><text>Chapter 1</text></navLabel><content src="text/a.xhtml"/>
          <navPoint id="n2"><navLabel><text>Section</text></navLabel><content src="#s1"/></navPoint>
        </navPoint>
      </navMap></ncx>`),
      NCX,
      spine('OEBPS/text/a.xhtml'),
    )

    expect(hrefs(tree.toc)).toEqual(['OEBPS/text/a.xhtml', 'OEBPS/text/a.xhtml'])
    expect(tree.toc[0]?.children[0]?.fragment).toBe('s1')
  })

  it('returns an empty tree when there is no navMap', () => {
    expect(parseNcx(parseXml('<ncx/>'), NCX, spine())).toEqual(EMPTY_NAV)
  })

  it('applies the same spine filtering as the EPUB 3 path', () => {
    const tree = parseNcx(
      parseXml(`<ncx><navMap>
        <navPoint><navLabel><text>Cover</text></navLabel><content src="cover.xhtml"/></navPoint>
        <navPoint><navLabel><text>One</text></navLabel><content src="text/a.xhtml"/></navPoint>
      </navMap></ncx>`),
      NCX,
      spine('OEBPS/text/a.xhtml'),
    )
    expect(tree.toc.map((node) => node.label)).toEqual(['One'])
    expect(tree.landmarks.map((node) => node.label)).toEqual(['Cover'])
  })
})

describe('navIndex', () => {
  it('lets the first entry in document order name a repeated document', () => {
    // "Chapter 1" is what the book calls this file; "Section 1.1" names a part
    // of it. Preferring the deeper label would rename the chapter after its own
    // subsection.
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><a href="text/a.xhtml">Chapter 1</a>
        <ol><li><a href="text/a.xhtml#s1">Section 1.1</a></li></ol>
      </li>
    </ol></nav>`)

    expect(navIndex(tree).get('OEBPS/text/a.xhtml')?.label).toBe('Chapter 1')
  })

  it('records the parent label as the section, for articleSection (§7.5)', () => {
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><span>Volume I</span>
        <ol><li><a href="text/a.xhtml">Chapter 1</a></li></ol>
      </li>
    </ol></nav>`)

    expect(navIndex(tree).get('OEBPS/text/a.xhtml')?.section).toBe('Volume I')
  })

  it('has no section at the top level, so articleSection is omitted rather than empty', () => {
    const tree = nav3('<nav epub:type="toc"><ol><li><a href="text/a.xhtml">A</a></li></ol></nav>')
    expect(navIndex(tree).get('OEBPS/text/a.xhtml')?.section).toBeUndefined()
  })
})

describe('presentationNav', () => {
  it('is the identity for LTR, so nothing downstream can reorder the reading order', () => {
    const tree = nav3('<nav epub:type="toc"><ol><li><a href="text/a.xhtml">A</a></li><li><a href="text/b.xhtml">B</a></li></ol></nav>')
    expect(presentationNav(tree.toc, 'ltr')).toBe(tree.toc)
  })

  it('reverses RTL recursively, without touching the input', () => {
    const tree = nav3(`<nav epub:type="toc"><ol>
      <li><a href="text/a.xhtml">A</a>
        <ol><li><a href="text/a.xhtml#1">A1</a></li><li><a href="text/a.xhtml#2">A2</a></li></ol>
      </li>
      <li><a href="text/b.xhtml">B</a></li>
    </ol></nav>`)

    const rtl = presentationNav(tree.toc, 'rtl')
    expect(rtl.map((node) => node.label)).toEqual(['B', 'A'])
    expect(rtl[1]?.children.map((node) => node.label)).toEqual(['A2', 'A1'])
    // The original is untouched: presentation order is not reading order (§12).
    expect(tree.toc.map((node) => node.label)).toEqual(['A', 'B'])
  })
})
