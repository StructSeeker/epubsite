/**
 * The zero-rewrite assertion (spec §13.1).
 *
 * This is the check that guards the property the whole architecture rests on, so
 * it is tested from the direction that matters: **can a violation get past it?**
 * A test that only feeds it a correct site would pass against a function that
 * returned a constant.
 */
import { describe, expect, it } from 'vitest'
import { verifyZeroRewrite, type ExtractedFile } from '../../src/build/epub/extract'
import { toEntryPath, type EntryPath } from '../../src/shared/paths'
import type { ZipEntryInfo } from '../../src/build/epub/zip'

function source(...specs: Array<[string, number]>): ZipEntryInfo[] {
  return specs.map(([path, uncompressedSize]) => ({
    entryPath: toEntryPath(path),
    uncompressedSize,
    isDirectory: false,
  }))
}

function written(...specs: Array<[string, number]>): ExtractedFile[] {
  return specs.map(([path, bytes]) => ({ entryPath: toEntryPath(path) as EntryPath, bytes }))
}

describe('verifyZeroRewrite', () => {
  it('accepts a site that is exactly the book', () => {
    const report = verifyZeroRewrite({
      source: source(['mimetype', 20], ['OEBPS/text/ch01.xhtml', 300]),
      written: written(['mimetype', 20], ['OEBPS/text/ch01.xhtml', 300]),
      generated: new Set(),
    })

    expect(report).toEqual({ copied: 2, bytes: 320 })
  })

  it('ignores files the build generated, without ignoring anything else', () => {
    const report = verifyZeroRewrite({
      source: source(['mimetype', 20]),
      written: written(
        ['mimetype', 20],
        ['epubsite.html', 999],
        ['index.html', 120],
        ['_epubsite_assets/shell.css', 40],
      ),
      generated: new Set(['epubsite.html', 'index.html', '_epubsite_assets/shell.css']),
    })

    expect(report.copied).toBe(1)
  })

  it('rejects a dropped entry — the silent-corruption case', () => {
    expect(() =>
      verifyZeroRewrite({
        source: source(['mimetype', 20], ['OEBPS/Images/cover.png', 4000]),
        written: written(['mimetype', 20]),
        generated: new Set(),
      }),
    ).toThrow(/not written: OEBPS\/Images\/cover.png/)
  })

  it('rejects an invented file, unless it is one we declared', () => {
    expect(() =>
      verifyZeroRewrite({
        source: source(['mimetype', 20]),
        written: written(['mimetype', 20], ['OEBPS/text/extra.xhtml', 5]),
        generated: new Set(),
      }),
    ).toThrow(/written but not in the book: OEBPS\/text\/extra\.xhtml/)
  })

  it('rejects a truncated file, which the path-set check cannot see', () => {
    expect(() =>
      verifyZeroRewrite({
        source: source(['OEBPS/text/ch01.xhtml', 300]),
        written: written(['OEBPS/text/ch01.xhtml', 299]),
        generated: new Set(),
      }),
    ).toThrow(/not the same size/)
  })

  it('rejects a re-encoded file that happens to be longer', () => {
    expect(() =>
      verifyZeroRewrite({
        source: source(['OEBPS/text/ch01.xhtml', 300]),
        written: written(['OEBPS/text/ch01.xhtml', 320]),
        generated: new Set(),
      }),
    ).toThrow(/§13\.1b/)
  })

  it('blames itself, not the book: a violation is an internal error, exit 1', () => {
    try {
      verifyZeroRewrite({ source: source(['a', 1]), written: [], generated: new Set() })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toMatchObject({ code: 'E_INTERNAL', exitCode: 1 })
    }
  })

  it('lists at most five paths before summarising, so a big failure stays readable', () => {
    const many = Array.from({ length: 9 }, (_, i) => [`OEBPS/f${i}.xhtml`, 1] as [string, number])
    expect(() =>
      verifyZeroRewrite({ source: source(...many), written: [], generated: new Set() }),
    ).toThrow(/and 4 more/)
  })
})
