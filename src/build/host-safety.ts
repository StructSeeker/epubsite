/**
 * Host-filesystem safety for entry paths.
 *
 * Two failure classes, deliberately mapped to different exit codes:
 *
 *   - What OCF itself forbids (§4.2.3) is an *invalid EPUB*             -> exit 3
 *   - What only a host filesystem forbids is an *output conflict*      -> exit 4
 *
 * Validation is unconditional, never `process.platform`-dependent. Spec C.5
 * requires byte-identical output for identical input, and a build that accepts a
 * book on Linux but rejects it on Windows would break that promise — and, worse,
 * would make a book that builds fine locally fail on someone else's machine.
 */
import { InvalidEpubError, OutputConflictError } from './errors'
import { basename, escapesContainer, isTokenBasename, type EntryPath } from '../shared/paths'

/** OCF §4.2.3: file names must not use these code points. */
function isOcfForbiddenCodePoint(cp: number): boolean {
  if (cp === 0x2f) return true // SOLIDUS
  if (cp === 0x22) return true // QUOTATION MARK
  if (cp === 0x2a) return true // ASTERISK
  if (cp === 0x3a) return true // COLON
  if (cp === 0x3c) return true // LESS-THAN SIGN
  if (cp === 0x3e) return true // GREATER-THAN SIGN
  if (cp === 0x3f) return true // QUESTION MARK
  if (cp === 0x5c) return true // REVERSE SOLIDUS
  if (cp === 0x7c) return true // VERTICAL LINE
  if (cp === 0x7f) return true // DEL
  if (cp <= 0x1f) return true // C0
  if (cp >= 0x80 && cp <= 0x9f) return true // C1
  if (cp >= 0xe000 && cp <= 0xf8ff) return true // Private Use Area
  if (cp >= 0xf0000) return true // Supplementary Private Use Area A and B
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true // Noncharacters
  if ((cp & 0xfffe) === 0xfffe) return true // Last two of every plane
  if (cp >= 0xfff0) return true // Specials
  return false
}

/** Windows refuses these as file names, with or without an extension. */
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * Above this the *absolute* output path risks the host's path limit (260 on
 * Windows without long-path support). We measure the entry path rather than the
 * absolute path on purpose: the verdict must not depend on where the user put
 * `--out`, or determinism is lost.
 */
const ENTRY_PATH_ADVISORY_LIMIT = 200

/** A poor-man's full case fold; JS has no direct Unicode full-case-folding API. */
function caseFold(name: string): string {
  return name.normalize('NFC').toUpperCase().toLowerCase()
}

export interface EntryPathIssue {
  entryPath: string
  message: string
}

/**
 * Checks a single entry path. Throws on the first hard failure; returns a
 * warning string when the path is legal but risky.
 */
export function checkEntryPath(entryPath: EntryPath): string | null {
  if (escapesContainer(entryPath)) {
    throw new InvalidEpubError(
      `entry escapes the container root: ${entryPath}`,
      { where: entryPath },
    )
  }

  // NOTE: there is no "is it normalised?" check here any more, and that is
  // deliberate. `EntryPath` can only be produced by `toEntryPath`, which
  // normalises, so the condition became unreachable — the invariant now lives in
  // the type instead of in a branch nobody can trigger.

  for (const segment of entryPath.split('/')) {
    if (segment === '') {
      throw new InvalidEpubError(`entry path has an empty segment: ${entryPath}`, {
        where: entryPath,
      })
    }

    const bytes = Buffer.byteLength(segment, 'utf8')
    if (bytes > 255) {
      throw new InvalidEpubError(
        `file name exceeds 255 bytes (${bytes}): ${segment}`,
        { where: entryPath },
      )
    }

    for (const char of segment) {
      const cp = char.codePointAt(0) ?? 0
      if (isOcfForbiddenCodePoint(cp)) {
        throw new InvalidEpubError(
          `file name contains a character OCF forbids (U+${cp.toString(16).toUpperCase().padStart(4, '0')}): ${segment}`,
          { where: entryPath },
        )
      }
    }

    if (segment.endsWith('.')) {
      throw new InvalidEpubError(
        `file name may not end with a full stop: ${segment}`,
        { where: entryPath },
      )
    }
    // A trailing space is legal in OCF but cannot be represented reliably on
    // Windows or in a URL, so it is an output-side conflict rather than a
    // malformed book.
    if (segment.endsWith(' ')) {
      throw new OutputConflictError(
        `file name ends with a space, which cannot be written portably: ${segment}`,
        { where: entryPath },
      )
    }
    if (WINDOWS_RESERVED_STEM.test(segment.split('.')[0] ?? '')) {
      throw new OutputConflictError(
        `file name is a reserved device name on Windows: ${segment}`,
        { where: entryPath },
      )
    }
  }

  if (Buffer.byteLength(entryPath, 'utf8') > 65535) {
    throw new InvalidEpubError(`file path exceeds 65535 bytes: ${entryPath}`, { where: entryPath })
  }
  if (entryPath.length > ENTRY_PATH_ADVISORY_LIMIT) {
    return `entry path is very long (${entryPath.length} chars) and may exceed the host path limit: ${entryPath}`
  }
  return null
}

export interface EntryPathReport {
  /** Non-fatal findings, surfaced through `Diagnostics.warnings`. */
  warnings: EntryPathIssue[]
}

/**
 * Validates every entry path, then checks the two OCF uniqueness rules that need
 * the whole set: names unique within a directory after canonical normalisation
 * and case folding, and no collision with the reserved namespace.
 */
export function checkEntryPaths(entryPaths: readonly EntryPath[], reservedCollisions: readonly string[]): EntryPathReport {
  const warnings: EntryPathIssue[] = []
  const byDirectory = new Map<string, Map<string, string>>()

  for (const entryPath of entryPaths) {
    const warning = checkEntryPath(entryPath)
    if (warning !== null) warnings.push({ entryPath, message: warning })

    const slash = entryPath.lastIndexOf('/')
    const directory = slash === -1 ? '' : entryPath.slice(0, slash)
    const name = basename(entryPath)
    const folded = caseFold(name)

    let seen = byDirectory.get(directory)
    if (seen === undefined) {
      seen = new Map()
      byDirectory.set(directory, seen)
    }
    const previous = seen.get(folded)
    if (previous !== undefined && previous !== name) {
      throw new InvalidEpubError(
        `file names collide after normalisation and case folding (OCF §4.2.3): ` +
          `${directory === '' ? '' : `${directory}/`}${previous} and ${name}`,
        { where: entryPath },
      )
    }
    seen.set(folded, name)
  }

  if (reservedCollisions.length > 0) {
    const list = [...reservedCollisions].sort()
    throw new OutputConflictError(
      `the book occupies paths the build needs (spec §3.2): ${list.join(', ')}. ` +
        'Rename them in the source book, or ask for a subdirectory layout.',
    )
  }

  return { warnings }
}

/** True when a basename sits in the token namespace (§12), for diagnostics. */
export function isReservedTokenName(entryPath: EntryPath): boolean {
  return isTokenBasename(basename(entryPath))
}
