import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseContainer } from '../../src/build/epub/container'
import { parseOpf, selectIdentifier } from '../../src/build/epub/opf'
import { parseXml } from '../../src/build/epub/xml'
import { ENCRYPTION_PATH, MIMETYPE_PATH, MIMETYPE_VALUE, openEpub } from '../../src/build/epub/zip'
import { InvalidEpubError } from '../../src/build/errors'
import { toEntryPath } from '../../src/shared/paths'
import { buildZip, sampleEpub } from '../fixtures/zip-writer'

/** Entry paths always come from the smart constructor, as they do in the build. */
const CONTAINER_PATH = toEntryPath('META-INF/container.xml')
const CONTENT_OPF = toEntryPath('OEBPS/content.opf')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'epubsite-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function writeEpub(bytes: Buffer, name = 'book.epub'): Promise<string> {
  const filePath = join(workDir, name)
  await writeFile(filePath, bytes)
  return filePath
}

describe('openEpub', () => {
  it('indexes entries sorted by path, so every later loop is deterministic', async () => {
    const archive = await openEpub(await writeEpub(sampleEpub()))
    const paths = archive.entries.map((entry) => entry.entryPath)
    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain(MIMETYPE_PATH)
    await archive.close()
  })

  it('reads the container file verbatim', async () => {
    const archive = await openEpub(await writeEpub(sampleEpub()))
    const bytes = await archive.read(CONTAINER_PATH)
    expect(bytes.toString('utf8')).toContain('OEBPS/content.opf')
    await archive.close()
  })

  it('reports nothing about mimetype when the book is well formed', async () => {
    const archive = await openEpub(await writeEpub(sampleEpub()))
    expect(archive.warnings).toEqual([])
    await archive.close()
  })

  it('warns, rather than failing, when mimetype is missing', async () => {
    // Real books get this wrong; we copy the container verbatim, so a missing
    // mimetype does not stop us rendering it.
    const bytes = buildZip([{ path: 'META-INF/container.xml', content: '<container/>' }])
    const archive = await openEpub(await writeEpub(bytes))
    expect(archive.warnings.some((warning) => warning.includes('no mimetype entry'))).toBe(true)
    await archive.close()
  })

  it('warns when mimetype is not the first entry', async () => {
    const bytes = buildZip([
      { path: 'META-INF/container.xml', content: '<container/>' },
      { path: MIMETYPE_PATH, content: MIMETYPE_VALUE },
    ])
    const archive = await openEpub(await writeEpub(bytes))
    expect(archive.warnings.some((warning) => warning.includes('not the first entry'))).toBe(true)
    await archive.close()
  })

  it('rejects a file that is not a ZIP at all (exit 3)', async () => {
    const filePath = await writeEpub(Buffer.from('this is not an epub'))
    await expect(openEpub(filePath)).rejects.toBeInstanceOf(InvalidEpubError)
  })

  it('rejects two entries claiming the same path', async () => {
    const bytes = buildZip([
      { path: 'mimetype', content: MIMETYPE_VALUE },
      { path: 'OEBPS/dup.xhtml', content: 'a' },
      { path: 'OEBPS/dup.xhtml', content: 'b' },
    ])
    await expect(openEpub(await writeEpub(bytes))).rejects.toThrow(/two entries claim the same path/)
  })

  it('rejects an unsafe entry name (zip-slip, spec §10)', async () => {
    const bytes = buildZip([
      { path: 'mimetype', content: MIMETYPE_VALUE },
      { path: '../escaped.xhtml', content: 'x' },
    ])
    await expect(openEpub(await writeEpub(bytes))).rejects.toBeInstanceOf(InvalidEpubError)
  })

  it('rejects an absolute entry name (yauzl refuses it during the entry read)', async () => {
    // `toEntryPath('/etc/passwd')` yields 'etc/passwd' — harmless as an *href*
    // translation, a zip-slip hole if applied to an entry name. This is why
    // entry-name safety is delegated to `validateFileName` and pinned here.
    const bytes = buildZip([
      { path: 'mimetype', content: MIMETYPE_VALUE },
      { path: '/etc/passwd', content: 'x' },
    ])
    const error: unknown = await openEpub(await writeEpub(bytes)).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(InvalidEpubError)
    expect((error as Error).message).toMatch(/absolute path/)
  })

  it('rejects a drive-letter entry name, which is also an "absolute path" to yauzl', async () => {
    // Pins the delegated guarantee. There is deliberately no second
    // `escapesContainer` guard in zip.ts: one existed briefly and was
    // unreachable, because yauzl rejects these names before the `entry` event
    // fires. If a yauzl upgrade ever stops rejecting them, this test fails and
    // the guard has to come back.
    const bytes = buildZip([
      { path: 'mimetype', content: MIMETYPE_VALUE },
      { path: 'C:/windows/system32/x.dll', content: 'x' },
    ])
    const error: unknown = await openEpub(await writeEpub(bytes)).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(InvalidEpubError)
    expect((error as Error).message).toMatch(/absolute path/)
  })

  it('notices an encryption.xml so the build can refuse DRM (exit 5)', async () => {
    const archive = await openEpub(await writeEpub(sampleEpub({ [ENCRYPTION_PATH]: '<encryption/>' })))
    expect(archive.has(ENCRYPTION_PATH)).toBe(true)
    await archive.close()
  })

  it('errors on an unknown entry rather than returning empty bytes', async () => {
    const archive = await openEpub(await writeEpub(sampleEpub()))
    await expect(archive.read(toEntryPath('OEBPS/nope.xhtml'))).rejects.toBeInstanceOf(
      InvalidEpubError,
    )
    await archive.close()
  })
})

describe('parseContainer', () => {
  const read = (xml: string) => parseXml(xml)

  it('finds the package document through the container file', () => {
    const info = parseContainer(
      read(`<container version="1.0"><rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles></container>`),
      'META-INF/container.xml',
    )
    expect(info.opfPath).toBe('OEBPS/content.opf')
  })

  it('ignores rootfiles with an unrelated media type', () => {
    const info = parseContainer(
      read(`<container version="1.0"><rootfiles>
        <rootfile full-path="other.opf" media-type="text/plain"/>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles></container>`),
      'META-INF/container.xml',
    )
    expect(info.opfPath).toBe('OEBPS/content.opf')
    expect(info.otherRootfiles).toEqual([])
  })

  it('percent-decodes the full-path, which is a URL string', () => {
    const info = parseContainer(
      read(`<container version="1.0"><rootfiles>
        <rootfile full-path="OEBPS/my%20book.opf" media-type="application/oebps-package+xml"/>
      </rootfiles></container>`),
      'META-INF/container.xml',
    )
    expect(info.opfPath).toBe('OEBPS/my book.opf')
  })

  it('never yields an opf path that starts with a slash', () => {
    const info = parseContainer(
      read(`<container version="1.0"><rootfiles>
        <rootfile full-path="/OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles></container>`),
      'META-INF/container.xml',
    )
    expect(info.opfPath.startsWith('/')).toBe(false)
  })

  it.each([
    ['no container element', '<other/>'],
    ['no rootfiles element', '<container version="1.0"/>'],
    ['empty rootfiles', '<container version="1.0"><rootfiles/></container>'],
    [
      'no matching media type',
      '<container version="1.0"><rootfiles><rootfile full-path="a.opf" media-type="text/plain"/></rootfiles></container>',
    ],
  ])('rejects a container with %s', (_label, xml) => {
    expect(() => parseContainer(read(xml), 'META-INF/container.xml')).toThrow(InvalidEpubError)
  })
})

describe('parseOpf', () => {
  async function loadPackage() {
    const archive = await openEpub(await writeEpub(sampleEpub()))
    const container = parseContainer(
      parseXml((await archive.read(CONTAINER_PATH)).toString('utf8')),
      'META-INF/container.xml',
    )
    const opf = parseOpf(parseXml((await archive.read(container.opfPath)).toString('utf8')), container.opfPath)
    await archive.close()
    return opf
  }

  it('resolves manifest hrefs against the package document directory (§5.2)', async () => {
    const opf = await loadPackage()
    const chapter = opf.manifestItems.find((item) => item.id === 'ch1')
    expect(chapter?.entryPath).toBe('OEBPS/text/ch01.xhtml')
    // The nested chapter proves resolution is relative to the OPF, not the root.
    expect(opf.manifestById.get('deep')?.entryPath).toBe('OEBPS/text/deep/ch03.xhtml')
  })

  it('reads the spine as the reading order, including non-linear items', async () => {
    const opf = await loadPackage()
    expect(opf.spine.map((item) => item.entryPath)).toEqual([
      'OEBPS/text/ch01.xhtml',
      'OEBPS/text/ch02.xhtml',
      'OEBPS/text/deep/ch03.xhtml',
      'OEBPS/nav.xhtml',
    ])
    expect(opf.spine[3]?.linear).toBe(false)
  })

  it('does not reorder the spine for RTL: position derives from the spine index (§7.5)', async () => {
    const opf = await loadPackage()
    expect(opf.pageProgressionDirection).toBe('ltr')
    expect(opf.spine[0]?.entryPath).toBe('OEBPS/text/ch01.xhtml')
  })

  it('attributes creator roles through refines, the only way EPUB 3 expresses them', async () => {
    const opf = await loadPackage()
    expect(opf.metadata.creators).toHaveLength(1)
    expect(opf.metadata.creators[0]?.name).toBe('Ada Lovelace')
    expect(opf.metadata.creators[0]?.roles).toEqual(['author'])
    expect(opf.metadata.contributors[0]?.name).toBe('Grace Hopper')
    expect(opf.metadata.contributors[0]?.roles).toEqual(['translator'])
  })

  it('strips markup from dc:description before it can reach JSON-LD', async () => {
    const opf = await loadPackage()
    expect(opf.metadata.description).toBe('A sample with markup.')
  })

  it('reads the legacy dcterms:modified and dc:date', async () => {
    const opf = await loadPackage()
    expect(opf.metadata.modified).toBe('2026-01-01T00:00:00Z')
    expect(opf.metadata.date).toBe('2024-01-01')
  })

  it('finds the navigation document and the cover image', async () => {
    const opf = await loadPackage()
    expect(opf.navPath).toBe('OEBPS/nav.xhtml')
    // Reached through the legacy <meta name="cover">, which points at an id.
    expect(opf.coverImagePath).toBe('OEBPS/Images/cover.png')
  })

  it('defaults to a reflowable layout', async () => {
    const opf = await loadPackage()
    expect(opf.layout).toBe('reflowable')
  })

  it('detects pre-paginated books, which force --no-spa (§12)', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata>
          <meta property="rendition:layout">pre-paginated</meta>
        </metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      CONTENT_OPF,
    )
    expect(opf.layout).toBe('pre-paginated')
  })

  it('detects pre-paginated through a spine override too', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata/>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a" properties="rendition:layout-pre-paginated"/></spine></package>`),
      CONTENT_OPF,
    )
    expect(opf.layout).toBe('pre-paginated')
  })

  it('follows a manifest fallback chain to a document it can actually render', () => {
    const opf = parseOpf(
      parseXml(`<package version="3.0"><metadata/>
        <manifest>
          <item id="page" href="p1.jpg" media-type="image/jpeg" fallback="page-svg"/>
          <item id="page-svg" href="p1.svg" media-type="image/svg+xml"/>
        </manifest>
        <spine><itemref idref="page"/></spine></package>`),
      CONTENT_OPF,
    )
    expect(opf.spine[0]?.entryPath).toBe('OEBPS/p1.svg')
    expect(opf.spine[0]?.viaFallback).toBe(true)
  })

  it('refuses a spine item that is not renderable and has no fallback', () => {
    expect(() =>
      parseOpf(
        parseXml(`<package version="3.0"><metadata/>
          <manifest><item id="page" href="p1.jpg" media-type="image/jpeg"/></manifest>
          <spine><itemref idref="page"/></spine></package>`),
        CONTENT_OPF,
      ),
    ).toThrow(/no fallback to a content document/)
  })

  it('refuses a circular fallback chain', () => {
    expect(() =>
      parseOpf(
        parseXml(`<package version="3.0"><metadata/>
          <manifest>
            <item id="a" href="a.jpg" media-type="image/jpeg" fallback="b"/>
            <item id="b" href="b.jpg" media-type="image/jpeg" fallback="a"/>
          </manifest>
          <spine><itemref idref="a"/></spine></package>`),
        CONTENT_OPF,
      ),
    ).toThrow(/circular/)
  })

  it('reads EPUB 2 metadata, including the opf:role attribute', () => {
    const opf = parseOpf(
      parseXml(`<package version="2.0" unique-identifier="uid"><metadata
          xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
          <dc:identifier id="uid" opf:scheme="ISBN">9780000000000</dc:identifier>
          <dc:title>Old Book</dc:title>
          <dc:creator opf:role="aut">Anon</dc:creator>
          <dc:creator opf:role="trl">A Translator</dc:creator>
        </metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      CONTENT_OPF,
    )
    expect(opf.metadata.creators.map((person) => person.roles).flat()).toEqual([
      'author',
      'translator',
    ])
    expect(selectIdentifier(opf)?.value).toBe('9780000000000')
  })

  it.each([
    ['no package element', '<other/>'],
    ['no metadata', '<package version="3.0"><manifest/><spine/></package>'],
    ['no spine', '<package version="3.0"><metadata/><manifest/></package>'],
  ])('rejects a package document with %s', (_label, xml) => {
    expect(() => parseOpf(parseXml(xml), CONTENT_OPF)).toThrow(InvalidEpubError)
  })

  it('rejects an itemref pointing outside the manifest', () => {
    expect(() =>
      parseOpf(
        parseXml(`<package version="3.0"><metadata/><manifest/>
          <spine><itemref idref="ghost"/></spine></package>`),
        CONTENT_OPF,
      ),
    ).toThrow(/not in the manifest/)
  })
})

describe('selectIdentifier (§4.2 precedence)', () => {
  /** Wraps metadata in a *valid* package: an empty spine is rejected outright. */
  const build = (metadata: string, uniqueIdentifier?: string) => {
    const unique = uniqueIdentifier === undefined ? '' : ` unique-identifier="${uniqueIdentifier}"`
    return parseOpf(
      parseXml(`<package version="3.0"${unique}><metadata>${metadata}</metadata>
        <manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="a"/></spine></package>`),
      CONTENT_OPF,
    )
  }

  it('prefers the element unique-identifier points at', () => {
    const opf = build(
      `<dc:identifier id="first">urn:uuid:1111</dc:identifier>
       <dc:identifier id="second">urn:uuid:2222</dc:identifier>`,
      'second',
    )
    expect(selectIdentifier(opf)?.value).toBe('urn:uuid:2222')
  })

  it('falls back to an ISBN when unique-identifier does not resolve', () => {
    const opf = build(
      `<dc:identifier>urn:uuid:1111</dc:identifier>
       <dc:identifier>urn:isbn:9780000000000</dc:identifier>`,
      'missing',
    )
    expect(selectIdentifier(opf)?.value).toBe('urn:isbn:9780000000000')
  })

  it('falls back to the first identifier when nothing is marked', () => {
    const opf = build(
      `<dc:identifier>urn:uuid:first</dc:identifier>
       <dc:identifier>urn:uuid:second</dc:identifier>`,
    )
    expect(selectIdentifier(opf)?.value).toBe('urn:uuid:first')
  })

  it('returns undefined rather than inventing an identifier', () => {
    const opf = build('<dc:title>Untitled</dc:title>')
    expect(selectIdentifier(opf)).toBeUndefined()
  })
})
