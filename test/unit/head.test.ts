/**
 * Chapter head extraction (spec §4.4, §5.4).
 *
 * Two things are being tested. The obvious one is that the styles come out. The
 * less obvious one is that they come out **resolved**: the runtime only prefixes
 * `SITE_ROOT`, so a href that stayed relative to the chapter would 404 on every
 * chapter but the first — and only in a browser, only after a navigation.
 */
import { describe, expect, it } from 'vitest'
import { parseChapterHead } from '../../src/build/epub/head'
import { parseXml } from '../../src/build/epub/xml'
import { toEntryPath } from '../../src/shared/paths'

const CHAPTER = toEntryPath('OEBPS/text/ch01.xhtml')

function head(inner: string, chapter = CHAPTER) {
  return parseChapterHead(
    parseXml(`<html xmlns="http://www.w3.org/1999/xhtml"><head>${inner}</head><body></body></html>`),
    chapter,
  )
}

describe('parseChapterHead — stylesheets', () => {
  it('resolves a link href against the chapter directory', () => {
    const result = head('<link rel="stylesheet" href="../Styles/book.css"/>')
    expect(result.links).toEqual([{ kind: 'path', path: 'OEBPS/Styles/book.css' }])
  })

  it('matches `stylesheet` as a token, not as the whole rel attribute', () => {
    // `alternate stylesheet` and `preload stylesheet` both occur in real books;
    // comparing the whole attribute would skip them.
    expect(head('<link rel="alternate stylesheet" href="a.css"/>').links).toHaveLength(1)
    expect(head('<link rel="preload stylesheet" href="a.css"/>').links).toHaveLength(1)
  })

  it('ignores links that are not stylesheets', () => {
    const result = head('<link rel="icon" href="icon.png"/><link rel="next" href="ch02.xhtml"/>')
    expect(result.links).toEqual([])
  })

  it('keeps an absolute URL external rather than re-basing it against the site', () => {
    const result = head('<link rel="stylesheet" href="https://fonts.example/x.css"/>')
    expect(result.links).toEqual([{ kind: 'external', href: 'https://fonts.example/x.css' }])
  })

  it('ignores a link with no href', () => {
    expect(head('<link rel="stylesheet"/>').links).toEqual([])
  })
})

describe('parseChapterHead — inline styles', () => {
  it('lifts a top-level @import out and keeps the rest as a body', () => {
    const result = head('<style>@import url("../Styles/extra.css"); p { text-indent: 2em }</style>')
    expect(result.imports).toEqual([{ kind: 'path', path: 'OEBPS/Styles/extra.css' }])
    expect(result.inline).toHaveLength(1)
    expect(result.inline[0]).toContain('text-indent')
    expect(result.inline[0]).not.toContain('@import')
  })

  it('resolves the bare-string @import form too', () => {
    const result = head('<style>@import "../Styles/extra.css";</style>')
    expect(result.imports).toEqual([{ kind: 'path', path: 'OEBPS/Styles/extra.css' }])
  })

  it('drops a style element that contained nothing but an import', () => {
    // Otherwise the runtime would inject an empty `@layer epub {}` for it.
    expect(head('<style>@import "a.css";</style>').inline).toEqual([])
  })

  it('keeps several style elements separate, in document order', () => {
    const result = head('<style>a{}</style><style>b{}</style>')
    expect(result.inline).toEqual(['a{}', 'b{}'])
  })

  it('leaves an external @import as an absolute URL', () => {
    const result = head('<style>@import url("https://fonts.example/x.css");</style>')
    expect(result.imports).toEqual([{ kind: 'external', href: 'https://fonts.example/x.css' }])
  })

  it('discards an @import that is only a fragment', () => {
    // `@import url(#x)` is meaningless, and a fragment reaching the file resolver
    // would be laundered into a path and 404 with no explanation.
    expect(head('<style>@import url("#x");</style>').imports).toEqual([])
  })
})

describe('parseChapterHead — body facts', () => {
  it('captures class, dir and lang from the body', () => {
    const result = parseChapterHead(
      parseXml(
        '<html><head></head><body class="calibre" dir="rtl" lang="ar"><p>x</p></body></html>',
      ),
      CHAPTER,
    )
    expect(result).toMatchObject({ bodyClass: 'calibre', dir: 'rtl', lang: 'ar' })
  })

  it('falls back to the html element for dir and lang', () => {
    const result = parseChapterHead(
      parseXml('<html dir="rtl" lang="he"><head></head><body>x</body></html>'),
      CHAPTER,
    )
    expect(result).toMatchObject({ dir: 'rtl', lang: 'he' })
  })

  it('reports null rather than empty when the chapter does not say', () => {
    // `null` and `''` mean different things to the runtime: the first inherits
    // the shell's value, the second would clear it.
    expect(head('').dir).toBeNull()
    expect(head('').lang).toBeNull()
    expect(head('').bodyClass).toBe('')
  })

  it('captures the title and the first h1, for §12’s label chain', () => {
    const result = parseChapterHead(
      parseXml('<html><head><title> Chapter One </title></head><body><h1>A <em>Heading</em></h1></body></html>'),
      CHAPTER,
    )
    expect(result.title).toBe('Chapter One')
    expect(result.h1).toBe('A Heading')
  })

  it('survives a document with no head at all', () => {
    expect(parseChapterHead(parseXml('<html><body>x</body></html>'), CHAPTER)).toMatchObject({
      links: [],
      inline: [],
      title: null,
    })
  })
})
