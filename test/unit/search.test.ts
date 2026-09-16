/**
 * Unit tests for the search index's two pure decisions (§D.2, §D.3).
 *
 * These exist because neither can be checked from the outside. Pagefind's index
 * is compressed, so "the shell is not in it" is not directly observable — but the
 * glob that is handed to Pagefind *is*, and that is the mechanism the whole
 * exclusion rests on. The spec's ban on `data-pagefind-body` (§5.1) exists
 * precisely so that this stays true: a site-wide switch would drop every chapter
 * instead of the four documents we actually want gone.
 */
import { describe, expect, it } from 'vitest'
import { searchGlob } from '../../src/build/search/pagefind'
import { RESERVED_PATHS, SHELL_ASSETS } from '../../src/shared/paths'
import type { Diagnostics } from '../../src/build/diagnostics'

function diagnostics(): Diagnostics {
  return { warnings: [], externalResources: [], outOfTreeLinks: [] }
}

const SPINE = ['text/ch01.xhtml', 'text/ch02.xhtml', 'text/deep/ch03.xhtml', 'nav.xhtml']

describe('searchGlob', () => {
  it('enumerates the spine exactly, and nothing else', () => {
    const glob = searchGlob(SPINE, diagnostics())
    for (const path of SPINE) expect(glob).toContain(path)

    // The documents *about* the book must never be indexed (§D.2). The command's
    // own default glob would sweep in all of these, because they are HTML files
    // in the same output tree.
    for (const excluded of [
      RESERVED_PATHS.shell,
      RESERVED_PATHS.transit,
      RESERVED_PATHS.guide,
      RESERVED_PATHS.manifest,
      `${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellData}`,
    ]) {
      expect(glob).not.toContain(excluded)
    }
  })

  it('falls back to a recursive glob, with a warning, when a book is too large', () => {
    const diagnostic = diagnostics()
    const many = Array.from({ length: 9000 }, (_, index) => `text/ch${index}.xhtml`)
    const glob = searchGlob(many, diagnostic)

    expect(glob).not.toContain('text/ch0.xhtml,')
    expect(diagnostic.warnings.map((warning) => warning.code)).toContain('W_SEARCH_GLOB_FALLBACK')
  })
})
