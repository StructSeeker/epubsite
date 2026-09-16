/**
 * Zero-rewrite extraction (spec §3.1, §13.1).
 *
 * Every entry in the container is copied out byte for byte, under its own path,
 * with nothing removed, re-encoded, prettified or added. This is not an
 * optimisation of some other design — it *is* the design: the site root is the
 * EPUB root, so the book's own files are already the site's files, and the whole
 * link-resolution story (I1, I2) depends on them being at exactly the paths the
 * book believes they are at.
 *
 * Because that property is the one thing the entire architecture rests on, and
 * because it is the kind of property that breaks silently — a decoder that
 * normalises line endings, a size check that drops a truncated entry — it is
 * asserted rather than assumed. See {@link verifyZeroRewrite}.
 *
 * The assertion is deliberately **not** a byte comparison. Spec §13.1 was
 * amended in v1.2: hashing every file proves the same thing a length comparison
 * proves for the failures that actually occur (truncation, re-encoding,
 * omission, invention), costs a full second pass over the archive, and turns
 * every test into a hash fixture. The two checks below are the ones that fail
 * loudly on a real defect.
 */
import { InternalError } from '../errors'
import type { EntryPath } from '../../shared/paths'
import type { EpubArchive, ZipEntryInfo } from './zip'
import type { FileSink } from '../output'

export interface ExtractedFile {
  entryPath: EntryPath
  bytes: number
}

export interface ExtractionReport {
  files: ExtractedFile[]
  bytes: number
}

/**
 * Copies every entry out verbatim.
 *
 * Entries are streamed rather than buffered, so a book with a 200 MB video does
 * not have to fit in memory, and the byte count comes from the same pass that
 * wrote the bytes — which is what makes it evidence rather than a second
 * opinion.
 */
export async function extractVerbatim(
  archive: EpubArchive,
  sink: FileSink,
): Promise<ExtractionReport> {
  const files: ExtractedFile[] = []
  let bytes = 0

  for (const entry of archive.entries) {
    const written = await sink.writeStream(entry.entryPath, await archive.stream(entry.entryPath))
    files.push({ entryPath: entry.entryPath, bytes: written })
    bytes += written
  }

  return { files, bytes }
}

export interface ZeroRewriteInput {
  /** Every file entry in the container's central directory (spec §4.2). */
  source: readonly ZipEntryInfo[]
  /** What the sink actually holds, with byte counts. */
  written: readonly ExtractedFile[]
  /** Paths this build generated: the reserved namespace (§3.2). */
  generated: ReadonlySet<string>
}

export interface ZeroRewriteReport {
  /** Number of entries copied from the book. */
  copied: number
  /** Total bytes copied from the book. */
  bytes: number
}

/**
 * Asserts that the site's contents are the book's contents (spec §13.1).
 *
 * Two independent statements, because they catch different defects:
 *
 *   (a) **Path set.** Outside the reserved namespace, the set of paths on the
 *       site is *exactly* the set of entries in the container — no file dropped,
 *       none invented, no name translated. This catches the whole family of
 *       "helpfully normalised the path" bugs, which are invisible at runtime
 *       until a link 404s.
 *
 *   (b) **Byte length.** Every copied file has the same length as the entry it
 *       came from. This catches truncation and re-encoding, which (a) cannot see
 *       because the path is unchanged.
 *
 * A violation means *we* are broken, not the book, so it raises
 * `InternalError` (exit 1) rather than blaming the user's file. The distinction
 * matters: an exit-3 "invalid EPUB" would send someone off to inspect a book
 * that is perfectly fine.
 */
export function verifyZeroRewrite(input: ZeroRewriteInput): ZeroRewriteReport {
  const writtenByPath = new Map<string, number>()
  for (const file of input.written) {
    writtenByPath.set(file.entryPath, file.bytes)
  }

  const expected = new Set<string>(input.source.map((entry) => entry.entryPath))
  const actual = new Set<string>()
  for (const path of writtenByPath.keys()) {
    if (!input.generated.has(path)) actual.add(path)
  }

  const missing = [...expected].filter((path) => !actual.has(path)).sort()
  const invented = [...actual].filter((path) => !expected.has(path)).sort()

  if (missing.length > 0 || invented.length > 0) {
    const parts: string[] = ['the site does not match the book: zero-rewrite violated (§13.1a).']
    if (missing.length > 0) {
      parts.push(`not written: ${summarise(missing)}`)
    }
    if (invented.length > 0) {
      parts.push(`written but not in the book: ${summarise(invented)}`)
    }
    throw new InternalError(parts.join(' '), { where: 'extract' })
  }

  let bytes = 0
  for (const entry of input.source) {
    const written = writtenByPath.get(entry.entryPath)
    if (written === undefined) continue // already reported by the path-set check
    if (written !== entry.uncompressedSize) {
      throw new InternalError(
        `the copied file is not the same size as the entry it came from (§13.1b): ` +
          `${entry.entryPath} is ${written} bytes, the container declares ` +
          `${entry.uncompressedSize}`,
        { where: entry.entryPath },
      )
    }
    bytes += written
  }

  return { copied: input.source.length, bytes }
}

/** Keeps an assertion message readable when a thousand paths disagree. */
function summarise(paths: readonly string[]): string {
  const shown = paths.slice(0, 5).join(', ')
  return paths.length <= 5 ? shown : `${shown} (and ${paths.length - 5} more)`
}
