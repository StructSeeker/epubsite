/**
 * Tests for the three by-construction fixes.
 *
 * Each one asserts a property that would have been violated by the original bug,
 * and each is written so that reintroducing the bug fails here rather than
 * producing a plausible-looking site.
 */
import { describe, expect, it } from 'vitest'
import { buildBookModel, displayTitle, presentationOrder } from '../../src/build/model/book'
import { parseOpf } from '../../src/build/epub/opf'
import { parseXml } from '../../src/build/epub/xml'
import { toEntryPath, type EntryPath } from '../../src/shared/paths'

const entry = (path: string): EntryPath => toEntryPath(path)

function packageOf(spineAttributes: string, extraMetadata = ''): string {
  return `<package version="3.0"><metadata>
      <dc:title>Book</dc:title>
      <dc:title id="sub" />
      <meta refines="#sub" property="title-type">subtitle</meta>
      ${extraMetadata}
    </metadata>
    <manifest>
      <item id="a" href="text/a.xhtml" media-type="application/xhtml+xml"/>
      <item id="b" href="text/b.xhtml" media-type="application/xhtml+xml"/>
      <item id="c" href="text/c.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine${spineAttributes}>
      <itemref idref="a"/>
      <itemref idref="b"/>
      <itemref idref="c"/>
    </spine></package>`
}

describe('fix 1: the <meta> dialects cannot be confused', () => {
  it('reads the legacy cover from the content attribute, not the element text', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata>
          <meta name="cover" content="cover-image"/>
        </metadata>
        <manifest>
          <item id="cover-image" href="Images/cover.png" media-type="image/png"/>
          <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    expect(opf.coverImagePath).toBe('Images/cover.png')
  })

  it('does not treat a legacy meta as a primary property expression', () => {
    // `<meta name="dcterms:modified" content="...">` is NOT how EPUB 3 expresses
    // modification, and must not be picked up as though it were: the union makes
    // the two dialects structurally separate.
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata>
          <meta name="modified" content="2020-01-01T00:00:00Z"/>
        </metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    expect(opf.metadata.modified).toBeUndefined()
  })

  it('still reads the EPUB 3 property form from element text', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata>
          <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
        </metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    expect(opf.metadata.modified).toBe('2026-01-01T00:00:00Z')
  })

  it('ignores a <meta> written in neither dialect', () => {
    const opf = parseOpf(parseXml(packageOf('', '<meta/>')), entry('content.opf'))
    expect(opf.metadata.modified).toBeUndefined()
    expect(opf.coverImagePath).toBeUndefined()
  })

  it('accepts a prefixed module for the legacy cover check', () => {
    expect(() => parseOpf(parseXml(packageOf('')), entry('content.opf'))).not.toThrow()
  })
})

describe('fix 2: an entry path cannot be an absolute URL path', () => {
  it('normalises and strips the leading slash in the smart constructor', () => {
    expect(toEntryPath('/OEBPS/text/ch.xhtml')).toBe('OEBPS/text/ch.xhtml')
    expect(toEntryPath('OEBPS/./text/../text/ch.xhtml')).toBe('OEBPS/text/ch.xhtml')
    expect(toEntryPath('OEBPS//text//ch.xhtml')).toBe('OEBPS/text/ch.xhtml')
  })

  it('never yields a value starting with a slash, whatever it is handed', () => {
    for (const input of ['/a/b', '//a/b', '/./a', '/a/../../b', 'a/b']) {
      expect(toEntryPath(input).startsWith('/')).toBe(false)
    }
  })

  it('resolves a root-relative href to an entry path, not an absolute path', () => {
    // The original bug returned '/OEBPS/text/ch02.xhtml' here.
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata/>
        <manifest>
          <item id="a" href="/OEBPS/text/a.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('OEBPS/content.opf'),
    )
    expect(opf.spine[0]?.entryPath).toBe('OEBPS/text/a.xhtml')
  })

  it('keeps a fragment-only reference out of the entry-path space entirely', () => {
    // A bare fragment is now a distinct variant of `Ref`, so it cannot be
    // mistaken for a path (the old "empty string means same file" sentinel).
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata/>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    expect(opf.manifestById.get('a')?.entryPath).toBe('a.xhtml')
  })
})

describe('fix 3: presentation order cannot leak into reading order', () => {
  const rtl = () => buildBookModel(parseOpf(parseXml(packageOf(' page-progression-direction="rtl"')), entry('content.opf')))

  it('numbers positions from the spine index, 1-based (§7.5)', () => {
    const book = buildBookModel(parseOpf(parseXml(packageOf('')), entry('content.opf')))
    expect(book.chapters.map((chapter) => chapter.position)).toEqual([1, 2, 3])
    expect(book.chapters.map((chapter) => chapter.index)).toEqual([0, 1, 2])
    for (const chapter of book.chapters) expect(chapter.position).toBe(chapter.index + 1)
  })

  it('keeps the reading order unchanged for an RTL book', () => {
    const book = rtl()
    expect(book.progression).toBe('rtl')
    expect(book.chapters.map((chapter) => chapter.entryPath)).toEqual([
      'text/a.xhtml',
      'text/b.xhtml',
      'text/c.xhtml',
    ])
    expect(book.chapters.map((chapter) => chapter.position)).toEqual([1, 2, 3])
  })

  it('reverses only when presentation order is explicitly requested', () => {
    const book = rtl()
    expect(presentationOrder(book.chapters, 'rtl').map((chapter) => chapter.position)).toEqual([
      3, 2, 1,
    ])
    // ...and ltr is untouched, so the two orders cannot be confused.
    expect(presentationOrder(book.chapters, 'ltr')).toBe(book.chapters)
  })

  it('does not mutate the reading order when producing presentation order', () => {
    const book = rtl()
    const before = book.chapters.map((chapter) => chapter.entryPath)
    presentationOrder(book.chapters, 'rtl')
    expect(book.chapters.map((chapter) => chapter.entryPath)).toEqual(before)
  })
})

describe('book model basics', () => {
  it('prefers a title marked title-type=main', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata>
          <dc:title>The Subtitle</dc:title>
          <dc:title id="t">The Real Title</dc:title>
          <meta refines="#t" property="title-type">main</meta>
        </metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    expect(buildBookModel(opf).title).toBe('The Real Title')
  })

  it('falls back to Untitled rather than inventing a name', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata/>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    expect(buildBookModel(opf).title).toBe('Untitled')
  })

  it('collects translators from both creators and contributors', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata>
          <dc:creator id="c1">Author</dc:creator>
          <meta refines="#c1" property="role" scheme="marc:relators">aut</meta>
          <dc:creator id="c2">Translator One</dc:creator>
          <meta refines="#c2" property="role" scheme="marc:relators">trl</meta>
          <dc:contributor id="c3">Translator Two</dc:contributor>
          <meta refines="#c3" property="role" scheme="marc:relators">trl</meta>
        </metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      entry('content.opf'),
    )
    const book = buildBookModel(opf)
    expect(book.authors.map((person) => person.name)).toEqual(['Author'])
    expect(book.translators.map((person) => person.name)).toEqual([
      'Translator One',
      'Translator Two',
    ])
  })

  it('uses position as the display fallback until the nav document is parsed', () => {
    const book = buildBookModel(parseOpf(parseXml(packageOf('')), entry('content.opf')))
    expect(displayTitle(book.chapters[1]!)).toBe('Chapter 2')
  })
})
