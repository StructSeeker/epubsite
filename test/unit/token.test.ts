/**
 * The token transform (spec §8.2, §13.1).
 *
 * §13.1 lists "token transform is a bijection" as one of the four assertions that
 * are the only way to notice I1-class breakage in CI. The failure it guards
 * against is not a crash: the guide would rebuild a path, the path would be
 * slightly wrong, and the reader would land on a 404 that redirects to a 404.
 *
 * So the tests are written as round trips over the shapes that actually appear in
 * books — depth, spaces, non-ASCII, dots — plus the cases where the honest answer
 * is `null` rather than a plausible-looking path.
 */
import { describe, expect, it } from 'vitest'
import { fromToken, isTokenPath, toToken } from '../../src/shared/token'

/** Real chapter paths, of the shapes §12 says must round-trip. */
const REAL_PATHS = [
  '/OEBPS/text/ch01.xhtml',
  '/OEBPS/text/deep/nested/ch03.xhtml',
  '/ch01.xhtml',
  '/OEBPS/text/ch 01.xhtml',
  '/OEBPS/text/ch%2001.xhtml',
  '/OEBPS/text/caf%C3%A9.xhtml',
  '/OEBPS/text/dots.in.name.xhtml',
  '/a/b/c/d/e/f/g.xhtml',
  '/OEBPS/text/@not-a-token.xhtml'.replace('@not-a-token', 'not-at-token'),
]

describe('toToken / fromToken', () => {
  it('round-trips every real path shape', () => {
    for (const path of REAL_PATHS) {
      const token = toToken(path)
      expect(token, `${path} should be tokenisable`).not.toBeNull()
      expect(fromToken(token as string)).toBe(path)
    }
  })

  it('moves only the basename, never the directory', () => {
    // I1's hard requirement (§2.1): if the directory changed, every relative URL
    // in the chapter would resolve against the wrong base once the reader loaded.
    expect(toToken('/OEBPS/text/ch03.xhtml')).toBe('/OEBPS/text/@ch03.xhtml')
  })

  it('is a bijection in the other direction too', () => {
    for (const path of REAL_PATHS) {
      const token = toToken(path) as string
      expect(toToken(fromToken(token) as string)).toBe(token)
    }
  })

  it('preserves the fragment-free pathname exactly, including percent-encoding', () => {
    // The transform must not decode: the encoded form is what the server will be
    // asked for, and re-encoding it is the caller's decision, not this
    // function's.
    expect(toToken('/a%20b/c%20d.xhtml')).toBe('/a%20b/@c%20d.xhtml')
  })

  it('refuses a path with no basename', () => {
    // `/a/b/` addresses a directory, not a file. Returning `/a/b/@` would be a
    // token for nothing.
    expect(toToken('/a/b/')).toBeNull()
    expect(toToken('/')).toBeNull()
  })

  it('refuses to tokenise an already-tokenised path', () => {
    // `@@ch01.xhtml` is recognised by nothing, so double-tokenising must fail
    // loudly rather than produce a path that looks deliberate.
    expect(toToken('/OEBPS/text/@ch01.xhtml')).toBeNull()
  })

  it('does not treat a path without a leading slash as broken', () => {
    // Callers pass location.pathname, which always starts with `/`, but a
    // function that only works on one of its plausible inputs is a trap.
    expect(toToken('ch01.xhtml')).toBe('@ch01.xhtml')
    expect(fromToken('@ch01.xhtml')).toBe('ch01.xhtml')
  })
})

describe('fromToken', () => {
  it('returns null for a path that is not a token', () => {
    // Constraint 3 (§8.3): a missing image must produce a 404 page, not a
    // redirect into the reader.
    expect(fromToken('/OEBPS/Images/missing.png')).toBeNull()
    expect(fromToken('/OEBPS/text/ch01.xhtml')).toBeNull()
    expect(fromToken('/')).toBeNull()
  })

  it('returns null for a bare @', () => {
    expect(fromToken('/a/@')).toBeNull()
  })

  it('ignores an @ that is not at the start of the basename', () => {
    expect(fromToken('/a/b@c.xhtml')).toBeNull()
  })
})

describe('isTokenPath', () => {
  it('agrees with fromToken on every input shape', () => {
    for (const path of [...REAL_PATHS, '/a/@b.xhtml', '/', '/a/@', '/a/b@c']) {
      expect(isTokenPath(path)).toBe(fromToken(path) !== null)
    }
  })
})
