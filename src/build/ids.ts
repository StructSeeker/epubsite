/**
 * Identifiers for the JSON-LD graph (spec §7.4, §7.5).
 *
 * `@id` means **identity**, `url` means **location**, and the whole graph rests
 * on keeping them apart: a book keeps its `@id` when it moves to another domain,
 * and several mirrors of the same book can point at one node. That is why the
 * `@id` is derived from the book's own `dc:identifier` and never from where the
 * site happens to be deployed (§7.4).
 *
 * The complication is that `dc:identifier` is not required to be a valid IRI. It
 * is often a bare ISBN, sometimes a bare UUID, and occasionally free text. The
 * four normalisation rules below are §7.4's table; the last one deliberately
 * invents a namespace rather than emitting something that merely looks like an
 * identifier, and it warns, because a book whose identity is a hash of a
 * description will change its identity when that description is edited.
 */
import { createHash } from 'node:crypto'
import { warn, type Diagnostics } from './diagnostics'

/**
 * True for an absolute URL, which is a perfectly good identity.
 *
 * §7.4's table did not list this case, and real books supplied it: of the five
 * IDPF samples, four identify themselves with something other than a URN, and one
 * of those — Project Gutenberg's `http://www.gutenberg.org/ebooks/25545` — is an
 * IRI already. Hashing it into `urn:epubsite:…` would throw away an identity the
 * publisher chose, and §7.4's own reasoning for preferring `dc:identifier` is
 * that it is the book's own claim about what it is.
 *
 * Recorded as revision E.13.
 */
function isAbsoluteUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
}

/** The `@id` of the book node, and the prefix of every chapter's. */
export function normalizeBookId(raw: string, diagnostics: Diagnostics): string {
  const value = raw.trim()

  if (/^urn:(isbn|uuid):/i.test(value)) return value
  if (isAbsoluteUrl(value)) return value

  const isbn = normalizeIsbn(value)
  if (isbn !== undefined) return `urn:isbn:${isbn}`

  if (isUuid(value)) return `urn:uuid:${value.toLowerCase()}`

  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
  warn(
    diagnostics,
    'W_IDENTIFIER_UNPARSEABLE',
    `the book's dc:identifier is not a URN, ISBN or UUID, so its JSON-LD identity ` +
      `is derived from its text ("urn:epubsite:${digest}"). Editing that text will ` +
      'change the identity.',
    raw,
  )
  return `urn:epubsite:${digest}`
}

/**
 * `9780000000000` or `0-00-000000-0` → digits only, or `undefined`.
 *
 * Only the two lengths ISBN actually has are accepted. A ten-digit number that
 * is not an ISBN would otherwise be promoted to one, and an invented ISBN is
 * worse for a consumer than no ISBN at all.
 */
export function normalizeIsbn(value: string): string | undefined {
  const digits = value.replace(/^urn:isbn:/i, '').replace(/[\s-]/g, '')
  if (!/^\d{9}[\dXx]$|^\d{13}$/.test(digits)) return undefined
  return digits.toUpperCase()
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

/**
 * `{bookId}#ch-{position}` (§7.4).
 *
 * The fragment component of a URN, which RFC 8141 allows. Position rather than
 * path, so that a chapter's identity survives a rename of its file — the same
 * reasoning as the book's, one level down.
 */
export function chapterId(bookId: string, position: number): string {
  return `${bookId}#ch-${position}`
}
