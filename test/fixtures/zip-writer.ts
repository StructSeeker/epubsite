/**
 * Minimal ZIP writer for test fixtures.
 *
 * Fixtures are synthesised rather than committed as binaries for two reasons:
 * the edge cases in spec §12 (reserved-namespace collisions, `encryption.xml`,
 * pre-paginated, RTL, missing nav, token-namespace names) are much easier to
 * express as code than as a pile of checked-in archives, and a synthetic book is
 * byte-identical on every machine, which the determinism assertions need.
 *
 * Entries are STORED (method 0, no compression) so `mimetype` is genuinely
 * uncompressed, as OCF §4.3.3 requires.
 */

const SIGNATURE_LOCAL = 0x04034b50
const SIGNATURE_CENTRAL = 0x02014b50
const SIGNATURE_EOCD = 0x06054b50

/** 1980-01-01 00:00:00 in MS-DOS format: a fixed timestamp keeps builds stable. */
const DOS_DATE = 0x0021
const DOS_TIME = 0x0000

/** Bit 11: the file name is UTF-8, so non-ASCII fixture names survive. */
const FLAG_UTF8 = 0x0800

export interface ZipEntrySpec {
  /** Path inside the archive, `/`-separated. */
  path: string
  content: string | Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Builds a ZIP archive from the given entries, in the order supplied. */
export function buildZip(entries: readonly ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const data = typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIGNATURE_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length

    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIGNATURE_CENTRAL, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(0, 10) // stored
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42)

    centralParts.push(central, name)
    offset += local.length + name.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIGNATURE_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, eocd])
}

/**
 * The package document used by {@link sampleEpub}, exposed so a test can vary a
 * single property without restating the whole document — which is the point of
 * having a fixture at all.
 */
export function sampleOpf(
  options: { progression?: 'ltr' | 'rtl'; withoutNav?: boolean } = {},
): string {
  const progression = options.progression ?? 'ltr'
  const withoutNav = options.withoutNav === true
  const navItem = withoutNav
    ? ''
    : '\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
  const navRef = withoutNav ? '' : '\n    <itemref idref="nav" linear="no"/>'
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:isbn:9780000000000</dc:identifier>
    <dc:title>Sample Book</dc:title>
    <dc:language>en</dc:language>
    <dc:creator id="creator">Ada Lovelace</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:contributor id="translator">Grace Hopper</dc:contributor>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
    <dc:publisher>Analytical Engines</dc:publisher>
    <dc:description>A sample with &lt;em&gt;markup&lt;/em&gt;.</dc:description>
    <dc:date>2024-01-01</dc:date>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>${navItem}
    <item id="ch1" href="text/ch01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch02.xhtml" media-type="application/xhtml+xml"/>
    <item id="deep" href="text/deep/ch03.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="Styles/book.css" media-type="text/css"/>
    <item id="cover-image" href="Images/cover.png" media-type="image/png"/>
  </manifest>
  <spine page-progression-direction="${progression}">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="deep"/>${navRef}
  </spine>
</package>`
}

/**
 * A minimal, valid EPUB 3 that exercises the interesting paths: nested
 * navigation, a chapter with styles and a fragment link, an `@`-free manifest,
 * and a cover image reached through `cover-image`.
 */
export function sampleEpub(
  overrides: Partial<Record<string, string | Buffer | undefined>> = {},
): Buffer {
  const files: Record<string, string | Buffer> = {
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    'OEBPS/content.opf': sampleOpf(),
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="text/ch01.xhtml">Chapter 1</a>
        <ol><li><a href="text/ch01.xhtml#sec1">Section 1.1</a></li></ol>
      </li>
      <li><a href="text/ch02.xhtml">Chapter 2</a></li>
      <li><a href="text/deep/ch03.xhtml">Chapter 3</a></li>
    </ol>
  </nav>
  <nav epub:type="landmarks">
    <ol><li><a epub:type="bodymatter" href="text/ch01.xhtml">Start</a></li></ol>
  </nav>
</body>
</html>`,
    'OEBPS/text/ch01.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Chapter 1</title>
  <link rel="stylesheet" href="../Styles/book.css"/>
  <style>@import url("../Styles/extra.css"); p { text-indent: 2em; }</style>
</head>
<body class="calibre">
  <h1>Chapter 1</h1>
  <p id="sec1">Body text one.</p>
  <p><a href="#sec1">note</a></p>
</body>
</html>`,
    'OEBPS/text/ch02.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body><h1>Chapter 2</h1><p>Body text two.</p></body>
</html>`,
    'OEBPS/text/deep/ch03.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 3</title></head>
<body><h1>Chapter 3</h1><p>Body text three.</p></body>
</html>`,
    'OEBPS/Styles/book.css': 'body { font-family: serif; }',
    'OEBPS/Images/cover.png': 'not-a-real-png',
  }

  for (const [path, content] of Object.entries(overrides)) {
    if (content === undefined) delete files[path]
    else files[path] = content
  }

  return buildZip([
    // `mimetype` must be the first entry and uncompressed (OCF §4.3.3).
    { path: 'mimetype', content: 'application/epub+zip' },
    ...Object.entries(files).map(([path, content]) => ({ path, content })),
  ])
}
