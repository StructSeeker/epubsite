/**
 * The chapter node's `url` decoration (spec §7.3, §8.5).
 *
 * These cases exist because they are the ones a browser test cannot reach
 * cheaply: a URL that is already present and must not be duplicated, a token
 * transform that has nothing to transform, a stray fragment. Each is a branch
 * the runtime takes on an ordinary book, and none of them is visible in a
 * screenshot.
 */
import { describe, expect, it } from 'vitest'
import { withChapterUrls } from '../../src/runtime/chapter-urls'

const CHAPTER = { '@type': ['Chapter', 'Article'], '@id': 'urn:isbn:9780000000000#ch-3' }
const REAL = 'https://example.com/OEBPS/text/ch3.xhtml'
const TOKEN = 'https://example.com/OEBPS/text/@ch3.xhtml'

describe('withChapterUrls', () => {
  it('lists both addresses when the node carries none', () => {
    const node = withChapterUrls(CHAPTER, new URL(REAL))

    expect(node['url']).toEqual([REAL, TOKEN])
    // The rest of the node is untouched: this adds a field, it does not rebuild one.
    expect(node['@id']).toBe(CHAPTER['@id'])
    expect(node['@type']).toEqual(['Chapter', 'Article'])
  })

  it('keeps the deployment sub-path in both addresses', () => {
    const node = withChapterUrls(
      CHAPTER,
      new URL('https://example.com/books/moby/OEBPS/text/ch3.xhtml'),
    )

    expect(node['url']).toEqual([
      'https://example.com/books/moby/OEBPS/text/ch3.xhtml',
      'https://example.com/books/moby/OEBPS/text/@ch3.xhtml',
    ])
  })

  it('does not duplicate the address the build already emitted', () => {
    // An absolute `--base-url` makes the build write `url` as a single string, and
    // it is the same address the runtime is about to compute. Appending blindly
    // would list the real URL twice and claim the chapter lives in two places.
    const node = withChapterUrls({ ...CHAPTER, url: REAL }, new URL(REAL))

    expect(node['url']).toEqual([REAL, TOKEN])
  })

  it('preserves an existing list and appends only what is missing', () => {
    const node = withChapterUrls({ ...CHAPTER, url: [REAL, 'https://mirror.example/ch3'] }, new URL(REAL))

    expect(node['url']).toEqual([REAL, 'https://mirror.example/ch3', TOKEN])
  })

  it('strips the query and the fragment from both addresses', () => {
    // A reader can be partway down a chapter, at an anchor, with a tracking
    // parameter on the URL. None of that is part of the chapter's identity, and
    // the build-time `url` never carries either.
    const node = withChapterUrls(CHAPTER, new URL(`${REAL}?utm_source=x#fn1`))

    expect(node['url']).toEqual([REAL, TOKEN])
  })

  it('emits one address when there is nothing to tokenise', () => {
    // `toToken` declines a path with no basename and a path that is already a
    // token. Both are ordinary, and neither should produce a second entry.
    const dir = withChapterUrls(CHAPTER, new URL('https://example.com/OEBPS/text/'))
    expect(dir['url']).toEqual(['https://example.com/OEBPS/text/'])

    const already = withChapterUrls(CHAPTER, new URL(TOKEN))
    expect(already['url']).toEqual([TOKEN])
  })

  it('ignores a url of the wrong shape rather than throwing', () => {
    // The node arrives as untyped JSON from `shell-data.json`, so its `url` is
    // whatever the file happens to contain.
    for (const value of [undefined, null, 42, { href: REAL }, ['', 7]]) {
      const node = withChapterUrls({ ...CHAPTER, url: value }, new URL(REAL))
      expect(node['url']).toEqual([REAL, TOKEN])
    }
  })

  it('recognises the build’s address even when it is spelled differently', () => {
    // The build writes the entry path as it is stored in the zip; the browser
    // writes `location.href` percent-encoded. `a b.xhtml` and `a%20b.xhtml` name
    // the same document, and listing both would claim otherwise.
    const node = withChapterUrls(
      { ...CHAPTER, url: 'https://example.com/OEBPS/text/a b.xhtml' },
      new URL('https://example.com/OEBPS/text/a%20b.xhtml'),
    )

    expect(node['url']).toEqual([
      // Kept exactly as the build wrote it; only the comparison is normalised.
      'https://example.com/OEBPS/text/a b.xhtml',
      'https://example.com/OEBPS/text/@a%20b.xhtml',
    ])
  })

  it('keeps a relative or malformed url rather than guessing at it', () => {
    // Not a URL, so there is nothing it can be equal to. It stays, and both real
    // addresses are still appended.
    const node = withChapterUrls({ ...CHAPTER, url: 'not a url' }, new URL(REAL))

    expect(node['url']).toEqual(['not a url', REAL, TOKEN])
  })

  it('does not mutate the node it was given', () => {
    // The node belongs to the `shell-data.json` object the runtime fetched once
    // and keeps for the life of the page. Mutating it would make the result depend
    // on how many times the reader had visited the chapter.
    const original: Record<string, unknown> = { ...CHAPTER }
    withChapterUrls(original, new URL(REAL))

    expect(original['url']).toBeUndefined()
  })
})
