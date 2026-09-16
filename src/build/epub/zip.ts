/**
 * EPUB container reader (spec §4.2, §C.2).
 *
 * Reads the ZIP **central directory** rather than trusting the local file
 * headers, which is what OCF requires and what makes random access to a single
 * entry cheap. yauzl also gives us `validateFileName`, the zip-slip defence that
 * §10 insists on.
 *
 * Nothing here rewrites content: entries are surfaced verbatim so the caller can
 * hash them on the way out (§13.1).
 */
import type { Readable } from 'node:stream'
import * as yauzl from 'yauzl'
import { InvalidEpubError } from '../errors'
import { basename, isTokenBasename, toEntryPath, type EntryPath } from '../../shared/paths'

export interface ZipEntryInfo {
  /** Path inside the container, normalised, `/`-separated. */
  entryPath: EntryPath
  uncompressedSize: number
  /** True when the entry is a ZIP directory marker (name ends with `/`). */
  isDirectory: boolean
}

export interface EpubArchive {
  /** File entries only (no directory markers), sorted by path. */
  readonly entries: readonly ZipEntryInfo[]
  readonly warnings: readonly string[]
  has(entryPath: EntryPath): boolean
  /** Whole entry as a Buffer. For small files: XML, JSON, CSS. */
  read(entryPath: EntryPath): Promise<Buffer>
  /** Streams an entry, so large assets can be hashed without being buffered. */
  stream(entryPath: EntryPath): Promise<Readable>
  close(): Promise<void>
}

const MIMETYPE_PATH = toEntryPath('mimetype')
const MIMETYPE_VALUE = 'application/epub+zip'

/**
 * Opens an EPUB and indexes it.
 *
 * Throws `InvalidEpubError` (exit 3) when the file is not a readable ZIP, when
 * an entry name is unsafe, or when two entries claim the same path.
 */
export async function openEpub(filePath: string): Promise<EpubArchive> {
  let zipfile: yauzl.ZipFile
  try {
    zipfile = await yauzl.openPromise(filePath, {
      lazyEntries: true,
      // We keep the handle open to read entries after indexing, so we close it
      // ourselves in `close()`.
      autoClose: false,
      // Rejects names using characters the ZIP spec forbids (notably `\`), which
      // OCF §4.2.3 forbids too.
      strictFileNames: true,
      validateEntrySizes: true,
    })
  } catch (cause) {
    throw new InvalidEpubError(`not a readable EPUB (ZIP) file: ${filePath}`, { cause, where: filePath })
  }

  const warnings: string[] = []
  const files: ZipEntryInfo[] = []
  const byPath = new Map<string, yauzl.Entry>()
  const seen = new Set<string>()

  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: yauzl.Entry) => {
        try {
          indexEntry(entry, files, byPath, seen, warnings)
        } catch (error) {
          reject(error)
          return
        }
        zipfile.readEntry()
      })
      zipfile.on('end', () => resolve())
      zipfile.on('error', (cause) => {
        reject(
          new InvalidEpubError(`failed while reading the container: ${cause.message}`, {
            cause,
            where: filePath,
          }),
        )
      })
      zipfile.readEntry()
    })
  } catch (error) {
    zipfile.close()
    throw error
  }

  if (files.length === 0) {
    zipfile.close()
    throw new InvalidEpubError(`the container has no file entries: ${filePath}`, { where: filePath })
  }

  checkMimetype(files, byPath, warnings)

  // Sorted so every downstream loop is deterministic (spec C.5).
  files.sort((a, b) => (a.entryPath < b.entryPath ? -1 : a.entryPath > b.entryPath ? 1 : 0))

  return {
    entries: files,
    warnings,
    has: (entryPath) => byPath.has(entryPath),
    async read(entryPath) {
      const stream = await openStream(zipfile, byPath, entryPath)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      return Buffer.concat(chunks)
    },
    stream(entryPath) {
      return openStream(zipfile, byPath, entryPath)
    },
    async close() {
      zipfile.close()
    },
  }
}

function indexEntry(
  entry: yauzl.Entry,
  files: ZipEntryInfo[],
  byPath: Map<string, yauzl.Entry>,
  seen: Set<string>,
  warnings: string[],
): void {
  // Entry-name safety is delegated to yauzl here, and the delegation is pinned
  // by tests rather than by an extra guard.
  //
  // This matters because `toEntryPath` below **launders** a leading '/' into a
  // root-relative path — correct for a manifest href (a legitimate container-root
  // reference), a zip-slip hazard for an entry name. So the name must be safe
  // *before* it is branded, and `validateFileName` is what guarantees that: it
  // rejects absolute names, drive letters, and `..` that escapes the root.
  //
  // There is deliberately no second `escapesContainer` check here. One existed
  // briefly and was unreachable — yauzl rejects those names during the entry read,
  // so the `entry` event never fires for them. A guard that cannot fire implies
  // protection it is not providing, so the guarantee is asserted in tests
  // instead: see `openEpub` in test/unit/epub.test.ts.
  const invalid = yauzl.validateFileName(entry.fileName)
  if (invalid !== null) {
    throw new InvalidEpubError(`unsafe entry name (${invalid}): ${entry.fileName}`, {
      where: entry.fileName,
    })
  }

  const isDirectory = entry.fileName.endsWith('/')
  const entryPath = toEntryPath(entry.fileName)
  if (entryPath === '') return

  if (entry.isEncrypted()) {
    throw new InvalidEpubError(
      `the container uses ZIP-level encryption, which OCF forbids (§4.3.2): ${entryPath}`,
      { where: entryPath },
    )
  }

  if (seen.has(entryPath)) {
    throw new InvalidEpubError(`two entries claim the same path: ${entryPath}`, { where: entryPath })
  }
  seen.add(entryPath)

  if (isDirectory) return

  if (isTokenBasename(basename(entryPath))) {
    // Recorded here so the caller can raise the §3.2 collision with a good
    // message; the token namespace must be free (§12).
    warnings.push(`entry is in the token namespace: ${entryPath}`)
  }

  files.push({ entryPath, uncompressedSize: entry.uncompressedSize, isDirectory: false })
  byPath.set(entryPath, entry)
}

/**
 * OCF §4.3.3 requires `mimetype` to be the first entry, stored uncompressed,
 * containing exactly `application/epub+zip`. Real books get this wrong often
 * enough that failing would reject usable books for a defect we do not depend
 * on — we copy the container verbatim, so a mislabelled archive still renders.
 * It is therefore a warning, not an error.
 */
function checkMimetype(
  files: readonly ZipEntryInfo[],
  byPath: Map<string, yauzl.Entry>,
  warnings: string[],
): void {
  const first = files[0]
  if (byPath.get(MIMETYPE_PATH) === undefined) {
    warnings.push(`container has no ${MIMETYPE_PATH} entry (OCF §4.3.3)`)
    return
  }
  if (first === undefined || first.entryPath !== MIMETYPE_PATH) {
    warnings.push(`${MIMETYPE_PATH} is not the first entry in the container (OCF §4.3.3)`)
  }
}

async function openStream(
  zipfile: yauzl.ZipFile,
  byPath: Map<string, yauzl.Entry>,
  entryPath: EntryPath,
): Promise<Readable> {
  const entry = byPath.get(entryPath)
  if (entry === undefined) {
    throw new InvalidEpubError(`no such entry in the container: ${entryPath}`, { where: entryPath })
  }
  try {
    return await zipfile.openReadStreamPromise(entry)
  } catch (cause) {
    throw new InvalidEpubError(`could not read entry: ${entryPath}`, { cause, where: entryPath })
  }
}

/** The `META-INF/encryption.xml` path, whose presence means DRM (§4.2, §12). */
export const ENCRYPTION_PATH = toEntryPath('META-INF/encryption.xml')

export { MIMETYPE_PATH, MIMETYPE_VALUE }
