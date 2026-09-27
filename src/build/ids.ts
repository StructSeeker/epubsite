/**
 * Identifiers for the JSON-LD graph (spec §7.4, §7.5).
 *
 * `@id` means **identity**, `url` means **location**, and the whole graph rests
 * on keeping them apart: a book keeps its `@id` when it moves to another domain,
 * and several mirrors of the same book can point at one node. That is why the
 * `@id` is taken from the book's own `dc:identifier` and never from where the
 * site happens to be deployed (§7.4).
 *
 * **The identifier is copied, not normalised.** Two shapes still gain a scheme —
 * a bare ISBN and a bare UUID, because the prefix is lossless and makes an
 * otherwise bare number unambiguous — and everything else is emitted as the book
 * wrote it, including text that is not an IRI at all. The earlier design hashed
 * what it could not parse; that invented an identity and warned that editing the
 * text would change it. Copying is honest at the cost of IRI validity, and §7.4
 * records the trade.
 *
 * The title is a different kind of thing and is treated differently: it is our
 * *substitute* for a claim the book did not make, so it is shaped into something
 * an identifier can look like rather than copied.
 */

/** The `@id` of the book node, and the prefix of every chapter's. */
export function bookIdentity(identifier: string | undefined, title: string): string {
  const declared = identifier?.trim()
  // An empty `dc:identifier` is a declaration of nothing: treat it as absent
  // rather than emitting `@id: ""`, which is worse than either alternative.
  if (declared === undefined || declared === '') return slug(title)

  const isbn = normalizeIsbn(declared)
  if (isbn !== undefined) return `urn:isbn:${isbn}`

  if (isUuid(declared)) return `urn:uuid:${declared.toLowerCase()}`

  return declared
}

/**
 * A title shaped into an identifier: `Moby-Dick; or, The Whale` →
 * `moby-dick-or-the-whale`.
 *
 * Three details, each of which a plain `[^a-z0-9]` implementation gets wrong:
 *
 *   - **Non-ASCII survives.** The class is `\p{L}\p{M}\p{N}` (letters, marks,
 *     numbers), so `Café Society` keeps its `é` and a CJK title keeps its
 *     characters. `\p{M}` is the subtle half: XML tooling emits decomposed text,
 *     where the accent is a *combining mark* — without it, `e` + U+0301 would
 *     slug to `e-`, silently turning an accent into a separator.
 *   - **NFC first**, so the composed and decomposed spellings of one title give
 *     one identity.
 *   - **`toLowerCase`, not `toLocaleLowerCase`**: the identity of a book must not
 *     depend on the locale of the machine that built the site.
 *
 * A title with nothing alphanumeric in it (`...`, `《》`) slugs to nothing, and
 * falls back to the trimmed title rather than to an invented word: a useless
 * identifier that is true beats a tidy one that is not. The title itself is never
 * empty — `selectTitle` falls back to "Untitled" — so this never returns `""`.
 */
function slug(title: string): string {
  const slugged = title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slugged === '' ? title.trim() : slugged
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
