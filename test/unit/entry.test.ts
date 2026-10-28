/**
 * The entry protocol's stale-response rule (§8.2, I1).
 *
 * The entry load is asynchronous by necessity: the address bar must name the
 * chapter *before* its markup is parsed, or every relative URL in it resolves
 * against the old base. The cost of that order is that a fast reader can outrun
 * the load, and the late response must then be declined instead of swapped.
 */
import { describe, expect, it } from 'vitest'
import { isStaleEntryResponse } from '../../src/runtime/entry'

const ENTRY_URL = 'https://example.com/OEBPS/text/ch01.xhtml'

describe('isStaleEntryResponse', () => {
  it('declines the entry chapter when the reader has navigated elsewhere', () => {
    expect(
      isStaleEntryResponse({
        entryKey: 'OEBPS/text/ch01.xhtml',
        entryUrl: ENTRY_URL,
        responseUrl: ENTRY_URL,
        currentKey: 'OEBPS/text/deep/ch03.xhtml',
      }),
    ).toBe(true)
  })

  it('accepts it when the reader is still on the chapter it names', () => {
    expect(
      isStaleEntryResponse({
        entryKey: 'OEBPS/text/ch01.xhtml',
        entryUrl: ENTRY_URL,
        responseUrl: ENTRY_URL,
        currentKey: 'OEBPS/text/ch01.xhtml',
      }),
    ).toBe(false)
  })

  it('declines it on the landing page, where no chapter belongs', () => {
    expect(
      isStaleEntryResponse({
        entryKey: 'OEBPS/text/ch01.xhtml',
        entryUrl: ENTRY_URL,
        responseUrl: ENTRY_URL,
        currentKey: 'epubsite.html',
      }),
    ).toBe(true)
  })

  it('never touches a response that is not the entry chapter', () => {
    // A reader who clicked back into the entry chapter later is a real
    // navigation, even though the URL is the same one the entry used.
    expect(
      isStaleEntryResponse({
        entryKey: 'OEBPS/text/ch01.xhtml',
        entryUrl: ENTRY_URL,
        responseUrl: 'https://example.com/OEBPS/text/ch02.xhtml',
        currentKey: 'OEBPS/text/ch01.xhtml',
      }),
    ).toBe(false)
  })
})
