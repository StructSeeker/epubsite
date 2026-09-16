import { describe, expect, it } from 'vitest'
import { checkEntryPath, checkEntryPaths } from '../../src/build/host-safety'
import {
  EncryptedContentError,
  InvalidEpubError,
  OutputConflictError,
} from '../../src/build/errors'
import { toEntryPath } from '../../src/shared/paths'

/**
 * Every path reaching the validator goes through the smart constructor first,
 * exactly as it does in the build. That is not ceremony: it is what makes
 * "an entry path is normalised and root-relative" a property the type system
 * enforces rather than a rule someone has to remember.
 */
const p = toEntryPath

describe('checkEntryPath — what OCF itself forbids is an invalid EPUB (exit 3)', () => {
  it('accepts an ordinary path', () => {
    expect(checkEntryPath(p('OEBPS/text/ch01.xhtml'))).toBeNull()
  })

  it.each([
    ['colon', 'OEBPS/a:b.xhtml'],
    ['question mark', 'OEBPS/a?b.xhtml'],
    ['asterisk', 'OEBPS/a*b.xhtml'],
    ['quote', 'OEBPS/a"b.xhtml'],
    ['angle bracket', 'OEBPS/a<b.xhtml'],
    ['pipe', 'OEBPS/a|b.xhtml'],
    ['backslash', 'OEBPS/a\\b.xhtml'],
    ['C0 control', 'OEBPS/a\u0001b.xhtml'],
    ['private use', 'OEBPS/a\uE000b.xhtml'],
    ['noncharacter', 'OEBPS/a\uFDD0b.xhtml'],
  ])('rejects a file name containing a %s (OCF §4.2.3)', (_label, entryPath) => {
    expect(() => checkEntryPath(p(entryPath))).toThrow(InvalidEpubError)
  })

  it('rejects a trailing full stop', () => {
    expect(() => checkEntryPath(p('OEBPS/name.'))).toThrow(InvalidEpubError)
  })

  it('rejects paths that escape the container through .. or a drive letter', () => {
    // NOTE: a *leading slash* is absent from this list on purpose. `toEntryPath`
    // translates it to a root-relative path, which is correct for a manifest href
    // and would be a zip-slip hazard for an entry name — so that case is caught
    // in zip.ts, on the raw name, before branding. See epub.test.ts.
    expect(() => checkEntryPath(p('../outside.xhtml'))).toThrow(InvalidEpubError)
    expect(() => checkEntryPath(p('C:/windows/system32'))).toThrow(InvalidEpubError)
  })

  it('shows the laundering that makes the zip-layer check necessary', () => {
    // Not a bug in `toEntryPath`, but the reason zip.ts must check the RAW name.
    expect(p('/etc/passwd')).toBe('etc/passwd')
  })

  it('no longer needs a "is it normalised?" branch, because branding guarantees it', () => {
    // The old implementation threw here. The condition is now unreachable, so
    // the check is gone and the invariant lives in the type.
    expect(p('OEBPS/text/../ch01.xhtml')).toBe('OEBPS/ch01.xhtml')
    expect(checkEntryPath(p('OEBPS/text/../ch01.xhtml'))).toBeNull()
  })

  it('rejects a file name longer than 255 bytes', () => {
    expect(() => checkEntryPath(p(`OEBPS/${'a'.repeat(256)}.xhtml`))).toThrow(/255 bytes/)
  })
})

describe('checkEntryPath — what only the host forbids is an output conflict (exit 4)', () => {
  it('rejects a trailing space, which OCF allows but no host can represent reliably', () => {
    expect(() => checkEntryPath(p('OEBPS/name '))).toThrow(OutputConflictError)
  })

  it.each(['CON', 'CON.txt', 'nul.xhtml', 'COM1', 'lpt9.xhtml'])(
    'rejects the reserved device name %s',
    (name) => {
      expect(() => checkEntryPath(p(`OEBPS/${name}`))).toThrow(OutputConflictError)
    },
  )

  it('does not reject names that merely start with a device name', () => {
    expect(checkEntryPath(p('OEBPS/CONSOLE.xhtml'))).toBeNull()
    expect(checkEntryPath(p('OEBPS/COM10.xhtml'))).toBeNull()
  })

  it('advises, without failing, on very long paths', () => {
    // 110 nested directories puts the entry path well past the 200-char guard.
    const long = `OEBPS/${'d/'.repeat(110)}ch.xhtml`
    const warning = checkEntryPath(p(long))
    expect(typeof warning).toBe('string')
    expect(warning).toMatch(/very long/)
  })

  it('returns null, not a warning object, for a clean path', () => {
    expect(checkEntryPath(p('OEBPS/text/ch.xhtml'))).toBeNull()
  })
})

describe('checkEntryPaths', () => {
  const paths = (...values: string[]) => values.map(p)

  it('accepts a clean set', () => {
    const report = checkEntryPaths(paths('OEBPS/a.xhtml', 'OEBPS/b.xhtml'), [])
    expect(report.warnings).toEqual([])
  })

  it('rejects names that collide after case folding and canonical normalisation (OCF §4.2.3)', () => {
    expect(() => checkEntryPaths(paths('OEBPS/a.xhtml', 'OEBPS/A.xhtml'), [])).toThrow(
      /collide after normalisation/,
    )
  })

  it('rejects composed and decomposed spellings of the same name', () => {
    // U+00E9 vs U+0065 U+0301: one precomposed, one decomposed.
    expect(() =>
      checkEntryPaths(paths('OEBPS/caf\u00e9.xhtml', 'OEBPS/cafe\u0301.xhtml'), []),
    ).toThrow(/collide after normalisation/)
  })

  it('allows the same name in different directories', () => {
    expect(() =>
      checkEntryPaths(paths('OEBPS/a/ch.xhtml', 'OEBPS/b/ch.xhtml'), []),
    ).not.toThrow()
  })

  it('fails with exit code 4 when the book occupies a reserved path (§3.2)', () => {
    try {
      checkEntryPaths([], ['epubsite.html'])
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(OutputConflictError)
      expect((error as OutputConflictError).exitCode).toBe(4)
    }
  })

  it('lists reserved collisions in sorted order so the message is reproducible', () => {
    expect(() => checkEntryPaths([], ['publication.json', '404.html'])).toThrow(
      /404\.html, publication\.json/,
    )
  })

  it('distinguishes the encrypted-content exit code from the conflict code', () => {
    expect(new EncryptedContentError('drm').exitCode).toBe(5)
    expect(new OutputConflictError('clash').exitCode).toBe(4)
  })
})
