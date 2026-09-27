/**
 * The book's identity (spec §7.4).
 *
 * `@id` is identity, not location, so it is taken from the book's own
 * `dc:identifier` and never from where the site is deployed. Two rules govern how
 * that value is spelled, and they are deliberately different in kind:
 *
 *   - **A declared identifier is copied, not derived.** Only a bare ISBN and a
 *     bare UUID gain a scheme, because the prefix is lossless and makes an
 *     otherwise bare number unambiguous. Everything else — URN, URL, or text that
 *     is not an IRI at all — is emitted exactly as the book wrote it. The earlier
 *     design hashed and warned; copying is honest at the cost of IRI validity,
 *     and §7.4 records the trade.
 *   - **A title is our substitute for a claim the book did not make**, so it is
 *     *shaped* rather than copied: slugged, kebab-case, non-ASCII preserved.
 *
 * The properties worth pinning are therefore: a claim survives verbatim, the same
 * ISBN punctuated two ways is one book, and a title becomes the same slug however
 * it was spelled in the OPF.
 */
import { describe, expect, it } from 'vitest'
import { bookIdentity, chapterId, normalizeIsbn } from '../../src/build/ids'

const UUID = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'

/** The identity of a book that declares `identifier`. */
function id(identifier: string | undefined): string {
  return bookIdentity(identifier, 'Moby-Dick')
}

/** The identity of a book that declares nothing, so the title stands in. */
function fromTitle(title: string): string {
  return bookIdentity(undefined, title)
}

describe('bookIdentity', () => {
  it('copies a declared identifier as the book wrote it', () => {
    // A URN is the clean case, and an unknown scheme is none of our business:
    // `dc:identifier` is a claim, and rewriting a claim changes it.
    expect(id('urn:isbn:9780000000000')).toBe('urn:isbn:9780000000000')
    expect(id(`urn:uuid:${UUID}`)).toBe(`urn:uuid:${UUID}`)
    expect(id('urn:oid:1.3.6.1.4.1.55062')).toBe('urn:oid:1.3.6.1.4.1.55062')
  })

  it('keeps an absolute URL, which is an identity the publisher chose (E.13)', () => {
    // One of the five IDPF samples identifies itself with Project Gutenberg's own
    // URL. Hashing it away would discard a claim the book is entitled to make.
    expect(id('http://www.gutenberg.org/ebooks/25545')).toBe('http://www.gutenberg.org/ebooks/25545')
    expect(id('https://example.com/book')).toBe('https://example.com/book')
  })

  it('copies free text verbatim, instead of hashing and warning about it', () => {
    // The old rule hashed unparseable text into `urn:epubsite:…` and warned that
    // editing the text would change the identity. It was replaced because a hash
    // is an identity *we* invented, while this string is the identity the book
    // published. Note what is *not* done to it: no slugging, no lowercasing, no
    // inner whitespace collapsed.
    expect(id('a description, not an identifier')).toBe('a description, not an identifier')
    expect(id('The Whale')).toBe('The Whale')
    expect(id('code.google.com.epub-samples.moby-dick-basic')).toBe(
      'code.google.com.epub-samples.moby-dick-basic',
    )
  })

  it('gives a bare ISBN a scheme, because that prefix is lossless', () => {
    expect(id('9780000000000')).toBe('urn:isbn:9780000000000')
    // A hyphenated ISBN-10, with the check digit folded to upper case by the
    // existing `normalizeIsbn`.
    expect(id('0-00-000000-0')).toBe('urn:isbn:0000000000')
    expect(id('0-8044-2957-x')).toBe('urn:isbn:080442957X')
  })

  it('treats two punctuations of one ISBN as one book', () => {
    // Identity is the point of §7.4: the same book must not become two nodes
    // because a catalogue wrote the number differently.
    expect(id('978-0-00-000000-0')).toBe(id('9780000000000'))
  })

  it('gives a bare UUID a scheme, lowercased', () => {
    expect(id(UUID.toUpperCase())).toBe(`urn:uuid:${UUID}`)
  })

  it('trims the identifier, so stray whitespace in the OPF changes nothing', () => {
    expect(id('  urn:isbn:9780000000000  ')).toBe('urn:isbn:9780000000000')
    expect(id('\n978-0-00-000000-0\t')).toBe('urn:isbn:9780000000000')
  })

  it('treats an empty identifier as no identifier at all', () => {
    // `@id: ""` is worse than either alternative: it identifies nothing while
    // looking like a value. An empty element declares exactly nothing.
    expect(id(undefined)).toBe('moby-dick')
    expect(id('')).toBe('moby-dick')
    expect(id('   ')).toBe('moby-dick')
  })
})

describe('the title substitute', () => {
  it('slugs the title when the book declares no identifier', () => {
    expect(fromTitle('Moby-Dick')).toBe('moby-dick')
    expect(fromTitle('Moby-Dick; or, The Whale')).toBe('moby-dick-or-the-whale')
  })

  it('is the same for either spelling of one title', () => {
    // Case, spacing and punctuation are spelling, not identity.
    expect(fromTitle('MOBY-DICK')).toBe(fromTitle('moby-dick'))
    expect(fromTitle('  Moby   Dick  ')).toBe('moby-dick')
    expect(fromTitle('A Book -- of  Things')).toBe(fromTitle('A Book... of Things'))
  })

  it('keeps non-ASCII letters and numbers', () => {
    expect(fromTitle('Café Society')).toBe('café-society')
    expect(fromTitle('Дом')).toBe('дом')
    expect(fromTitle('銀河鉄道の夜')).toBe('銀河鉄道の夜')
    expect(fromTitle('Volume 2')).toBe('volume-2')
  })

  it('folds the composed and decomposed spellings of an accented title together', () => {
    // XML tooling emits decomposed text, where the accent is a *combining mark*
    // (U+0301). A slug class of `\p{L}\p{N}` would treat that mark as a
    // separator and turn `Café` into `cafe-`, so `\p{M}` here is load-bearing.
    const composed = 'Caf\u00e9' // é as one code point
    const decomposed = 'Cafe\u0301' // e + combining acute
    expect(composed).not.toBe(decomposed) // different input …
    expect(fromTitle(composed)).toBe('café')
    expect(fromTitle(decomposed)).toBe('café') // … one identity
  })

  it('trims separator runs from the edges', () => {
    expect(fromTitle('  The Whale  ')).toBe('the-whale')
    expect(fromTitle('«The Whale»')).toBe('the-whale')
    expect(fromTitle('《The Whale》')).toBe('the-whale')
    expect(fromTitle('—Moby—Dick—')).toBe('moby-dick')
  })

  it('falls back to the title itself when there is nothing to slug', () => {
    // A useless identifier that is true beats a tidy one that is not: inventing
    // `untitled` here would merge every such book into one node.
    expect(fromTitle('...')).toBe('...')
    expect(fromTitle('《》')).toBe('《》')
    expect(fromTitle('---')).toBe('---')
  })

  it('does not re-examine the substitute as an identifier', () => {
    // The title is shaped, never parsed. A title that happens to look like an ISBN
    // must not be promoted into a claim the book never made.
    expect(fromTitle('9780000000000')).toBe('9780000000000')
    expect(fromTitle('urn:isbn:9780000000000')).toBe('urn-isbn-9780000000000')
  })
})

describe('normalizeIsbn', () => {
  it('accepts the two ISBN shapes and rejects everything else', () => {
    // Check digits are deliberately not verified: the real algorithm would reject
    // books whose metadata is merely sloppy, and a mis-shaped number that arrives
    // as a declared identifier is copied verbatim anyway.
    expect(normalizeIsbn('1234567890')).toBe('1234567890')
    expect(normalizeIsbn('978-0-00-000000-0')).toBe('9780000000000')
    expect(normalizeIsbn('12345')).toBeUndefined()
    expect(normalizeIsbn('not a number')).toBeUndefined()
    expect(normalizeIsbn('12345678901234')).toBeUndefined()
  })
})

describe('chapterId', () => {
  it('is the book id with a fragment naming the spine position (§7.4)', () => {
    expect(chapterId('urn:isbn:9780000000000', 3)).toBe('urn:isbn:9780000000000#ch-3')
  })

  it('carries whatever the book id is, including a title slug', () => {
    // A book with no identifier propagates its substitute into every chapter's
    // `@id`, which is why the substitute has to be usable as a fragment prefix.
    expect(chapterId('moby-dick', 1)).toBe('moby-dick#ch-1')
    expect(chapterId('The Whale', 7)).toBe('The Whale#ch-7')
  })

  it('does not depend on the chapter’s path, so a renamed file keeps its identity', () => {
    // The same reasoning as the book's: identity is not location.
    expect(chapterId('urn:isbn:1', 1)).toBe(chapterId('urn:isbn:1', 1))
  })
})
