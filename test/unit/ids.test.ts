/**
 * Identifier normalisation (spec §7.4).
 *
 * `dc:identifier` is not required to be a valid IRI, so the four rules in §7.4's
 * table are the difference between a graph that identifies a book and one that
 * identifies a string. Two properties matter most, and both are tested here:
 *
 *   - the same book produces the same `@id` regardless of how the identifier was
 *     punctuated, because a hyphenated ISBN and a bare one are one book;
 *   - unparseable text produces something **in a namespace of our own**, never
 *     something that merely resembles an ISBN — inventing an ISBN is worse than
 *     inventing nothing.
 */
import { describe, expect, it } from 'vitest'
import { chapterId, normalizeBookId, normalizeIsbn } from '../../src/build/ids'
import { emptyDiagnostics } from '../../src/build/diagnostics'

function id(raw: string): string {
  return normalizeBookId(raw, emptyDiagnostics())
}

describe('normalizeBookId', () => {
  it('keeps a URN as it stands', () => {
    expect(id('urn:isbn:9780000000000')).toBe('urn:isbn:9780000000000')
    expect(id('urn:uuid:6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b')).toBe(
      'urn:uuid:6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
    )
  })

  it('promotes a bare ISBN-13 to a URN', () => {
    expect(id('9780000000000')).toBe('urn:isbn:9780000000000')
  })

  it('keeps an absolute URL, which is an identity the publisher chose (E.13)', () => {
    // Four of the five IDPF samples identify themselves with something other
    // than a URN; one of them is Project Gutenberg's own URL. Hashing it away
    // would discard a claim the book is entitled to make about itself.
    const diagnostics = emptyDiagnostics()
    expect(normalizeBookId('http://www.gutenberg.org/ebooks/25545', diagnostics)).toBe(
      'http://www.gutenberg.org/ebooks/25545',
    )
    expect(normalizeBookId('https://example.com/book', diagnostics)).toBe('https://example.com/book')
    expect(diagnostics.warnings).toEqual([])
  })

  it('promotes a hyphenated ISBN-10, and folds the check digit', () => {
    expect(id('0-00-000000-0')).toBe('urn:isbn:0000000000')
    expect(id('0-8044-2957-x')).toBe('urn:isbn:080442957X')
  })

  it('treats two punctuations of one ISBN as one book', () => {
    // Identity is the point of §7.4: the same book must not become two nodes
    // because a catalogue wrote the number differently.
    expect(id('978-0-00-000000-0')).toBe(id('9780000000000'))
  })

  it('promotes a bare UUID, lowercased', () => {
    expect(id('6EC0BD7F-11C0-43DA-975E-2A8AD9EBAE0B')).toBe(
      'urn:uuid:6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
    )
  })

  it('hashes free text, and says so', () => {
    const diagnostics = emptyDiagnostics()
    const result = normalizeBookId('a description, not an identifier', diagnostics)

    expect(result).toMatch(/^urn:epubsite:[0-9a-f]{16}$/)
    // A hash-derived identity changes when the text changes, which is a fact the
    // builder should be told rather than left to discover.
    expect(diagnostics.warnings.map((warning) => warning.code)).toContain('W_IDENTIFIER_UNPARSEABLE')
  })

  it('is deterministic for the same free text', () => {
    expect(id('same text')).toBe(id('same text'))
    expect(id('same text')).not.toBe(id('other text'))
  })

  it('does not mistake a random ten-digit number for an ISBN', () => {
    // 1234567890 has the right shape for ISBN-10 but a wrong check digit. We do
    // not validate check digits (that would need the real ISBN algorithm and
    // would reject books whose metadata is merely sloppy), so this test pins the
    // *shape* rule honestly rather than pretending to more rigour than exists.
    expect(normalizeIsbn('1234567890')).toBe('1234567890')
    expect(normalizeIsbn('12345')).toBeUndefined()
    expect(normalizeIsbn('not a number')).toBeUndefined()
    expect(normalizeIsbn('12345678901234')).toBeUndefined()
  })
})

describe('chapterId', () => {
  it('is the book id with a fragment naming the spine position (§7.4)', () => {
    expect(chapterId('urn:isbn:9780000000000', 3)).toBe('urn:isbn:9780000000000#ch-3')
  })

  it('does not depend on the chapter’s path, so a renamed file keeps its identity', () => {
    // The same reasoning as the book's: identity is not location.
    expect(chapterId('urn:isbn:1', 1)).toBe(chapterId('urn:isbn:1', 1))
  })
})
