import { describe, expect, it } from 'vitest'
import {
  basename,
  collidesWithReserved,
  dirOf,
  escapesContainer,
  extname,
  isTokenBasename,
  normalize,
  resolveRef,
  splitFragment,
  toEntryPath,
  toUrlPath,
} from '../../src/shared/paths'

/** Entry paths always come from the smart constructor, as they do in the build. */
const p = toEntryPath

describe('normalize', () => {
  it('collapses . and .. segments', () => {
    expect(normalize('OEBPS/./text/../text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml')
    expect(normalize('OEBPS/text/../..')).toBe('')
  })

  it('drops leading .. on absolute paths but keeps it on relative ones', () => {
    expect(normalize('/a/../b')).toBe('/b')
    expect(normalize('a/../../b')).toBe('../b')
  })

  it('ignores duplicate and trailing separators', () => {
    expect(normalize('a//b//')).toBe('a/b')
  })
})

describe('toEntryPath (the smart constructor)', () => {
  it('normalises and strips a leading slash, so an absolute URL path cannot slip through', () => {
    expect(p('/OEBPS/a.xhtml')).toBe('OEBPS/a.xhtml')
    expect(p('OEBPS/./a.xhtml')).toBe('OEBPS/a.xhtml')
    expect(p('OEBPS/x/../a.xhtml')).toBe('OEBPS/a.xhtml')
  })

  it('never returns a value starting with a slash', () => {
    for (const input of ['/a', '//a', '/./a']) expect(p(input).startsWith('/')).toBe(false)
  })
})

describe('dirOf / basename / extname', () => {
  it('returns the directory with a trailing slash, because URL resolution needs it', () => {
    expect(dirOf(p('OEBPS/text/ch1.xhtml'))).toBe('OEBPS/text/')
    expect(dirOf(p('top.xhtml'))).toBe('')
  })

  it('extracts the final segment', () => {
    expect(basename(p('OEBPS/text/ch1.xhtml'))).toBe('ch1.xhtml')
    expect(basename(p('top.xhtml'))).toBe('top.xhtml')
  })

  it('lowercases extensions and ignores dotfiles', () => {
    expect(extname(p('a/ch1.XHTML'))).toBe('.xhtml')
    expect(extname(p('.gitignore'))).toBe('')
    expect(extname(p('noext'))).toBe('')
  })
})

describe('splitFragment', () => {
  it('separates the fragment', () => {
    expect(splitFragment('a.xhtml#fn1')).toEqual({ path: 'a.xhtml', fragment: 'fn1' })
    expect(splitFragment('a.xhtml')).toEqual({ path: 'a.xhtml', fragment: '' })
    expect(splitFragment('#fn1')).toEqual({ path: '', fragment: 'fn1' })
  })
})

describe('resolveRef', () => {
  const from = p('OEBPS/text/ch01.xhtml')

  it('resolves a sibling path against the containing directory', () => {
    expect(resolveRef(from, 'ch02.xhtml')).toEqual({
      kind: 'file',
      path: 'OEBPS/text/ch02.xhtml',
      fragment: '',
    })
  })

  it('resolves .. segments', () => {
    expect(resolveRef(from, '../Styles/book.css')).toEqual({
      kind: 'file',
      path: 'OEBPS/Styles/book.css',
      fragment: '',
    })
    expect(resolveRef(from, '../../Images/x.png')).toEqual({
      kind: 'file',
      path: 'Images/x.png',
      fragment: '',
    })
  })

  it('reports a pure fragment as its own variant, not as an empty path', () => {
    expect(resolveRef(from, '#fn1')).toEqual({ kind: 'fragment-only', fragment: 'fn1' })
  })

  it('honours a leading slash but still yields a root-relative entry path', () => {
    // Regression: this used to come back as '/OEBPS/text/ch02.xhtml'.
    const ref = resolveRef(from, '/OEBPS/text/ch02.xhtml')
    expect(ref).toEqual({ kind: 'file', path: 'OEBPS/text/ch02.xhtml', fragment: '' })
    expect(ref.kind === 'file' && ref.path.startsWith('/')).toBe(false)
  })

  it('keeps the fragment alongside the resolved path', () => {
    expect(resolveRef(p('OEBPS/nav.xhtml'), 'text/ch01.xhtml#sec1')).toEqual({
      kind: 'file',
      path: 'OEBPS/text/ch01.xhtml',
      fragment: 'sec1',
    })
  })
})

describe('escapesContainer', () => {
  it('rejects absolute paths, drive letters and escaping ..', () => {
    expect(escapesContainer('/etc/passwd')).toBe(true)
    expect(escapesContainer('C:/windows')).toBe(true)
    expect(escapesContainer('../outside.xhtml')).toBe(true)
  })

  it('accepts .. that stays inside the container', () => {
    expect(escapesContainer('OEBPS/text/../ch01.xhtml')).toBe(false)
  })
})

describe('toUrlPath', () => {
  it('escapes each segment but keeps the separators', () => {
    expect(toUrlPath(p('OEBPS/text/ch 1.xhtml'))).toBe('OEBPS/text/ch%201.xhtml')
    expect(toUrlPath(p('OEBPS/中文/ch1.xhtml'))).toBe('OEBPS/%E4%B8%AD%E6%96%87/ch1.xhtml')
  })
})

describe('reserved namespace (spec §3.2)', () => {
  it('reserves the shell, guide, manifest, assets and root marker', () => {
    expect(collidesWithReserved(p('epubsite.html'))).toBe(true)
    expect(collidesWithReserved(p('404.html'))).toBe(true)
    expect(collidesWithReserved(p('publication.json'))).toBe(true)
    expect(collidesWithReserved(p('_epubsite_assets/shell.js'))).toBe(true)
    expect(collidesWithReserved(p('.epubsite-root'))).toBe(true)
  })

  it('reserves every @-prefixed basename at any depth (§12)', () => {
    expect(collidesWithReserved(p('@ch1.xhtml'))).toBe(true)
    expect(collidesWithReserved(p('OEBPS/text/@ch1.xhtml'))).toBe(true)
    expect(isTokenBasename('@ch1.xhtml')).toBe(true)
    expect(isTokenBasename('ch@1.xhtml')).toBe(false)
  })

  it('lets the book keep its own index.html, so the transit page is simply skipped', () => {
    expect(collidesWithReserved(p('index.html'))).toBe(false)
    expect(collidesWithReserved(p('OEBPS/index.html'))).toBe(false)
  })

  it('does not collide on reserved names nested deeper than the site root', () => {
    expect(collidesWithReserved(p('OEBPS/epubsite.html'))).toBe(false)
    expect(collidesWithReserved(p('OEBPS/404.html'))).toBe(false)
  })
})
