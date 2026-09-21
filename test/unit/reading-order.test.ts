/**
 * The pager's lookup in the reading sequence (spec §5.7, §7.5).
 *
 * These cases exist because they are the ones a browser test can only reach
 * expensively: the two ends of a book, the landing page, and a document the book
 * keeps out of the reading sequence. Each is one line here and a whole fixture
 * there.
 */
import { describe, expect, it } from 'vitest'
import { neighbours } from '../../src/runtime/reading-order'
import { toEntryPath } from '../../src/shared/paths'

const ORDER = ['a.xhtml', 'b.xhtml', 'c.xhtml'].map(toEntryPath)

describe('neighbours', () => {
  it('names the chapters on either side', () => {
    expect(neighbours(ORDER, 'b.xhtml')).toEqual({ prev: 'a.xhtml', next: 'c.xhtml' })
  })

  it('has nothing before the first chapter, and nothing after the last', () => {
    expect(neighbours(ORDER, toEntryPath('a.xhtml'))).toEqual({ prev: null, next: 'b.xhtml' })
    expect(neighbours(ORDER, toEntryPath('c.xhtml'))).toEqual({ prev: 'b.xhtml', next: null })
  })

  it('treats the landing page as standing before the reading order', () => {
    // `key === null` is the landing page. There is nothing to go back to, and
    // "next" is how a reader starts the book without reaching for the sidebar —
    // which is what makes the control useful on the first screen instead of inert.
    expect(neighbours(ORDER, null)).toEqual({ prev: null, next: 'a.xhtml' })
  })

  it('treats a page outside the sequence the same way', () => {
    // A `linear="no"` document — the navigation document, a cover — is in the
    // spine but not in the reading order. Paging back from it into the reading
    // sequence would be a route to content the book deliberately excluded from
    // the sequence, so it is "before the beginning" like the landing page.
    expect(neighbours(ORDER, 'nav.xhtml')).toEqual({ prev: null, next: 'a.xhtml' })
  })

  it('has nowhere to go in an empty sequence', () => {
    expect(neighbours([], null)).toEqual({ prev: null, next: null })
    expect(neighbours([], 'a.xhtml')).toEqual({ prev: null, next: null })
  })
})
