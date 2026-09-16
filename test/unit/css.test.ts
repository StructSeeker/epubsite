/**
 * `@import` extraction (spec §4.4, §5.5).
 *
 * The failure this prevents is silent: an `@import` left inside a `@layer` block
 * is dropped by the browser, so the chapter's stylesheet never loads and the page
 * looks *almost* right. There is no error anywhere to notice.
 *
 * The scanner exists rather than a regular expression because `@import` can
 * appear inside a comment, inside a string, or nested in a block — so the tests
 * are mostly about the places it must **not** be found.
 */
import { describe, expect, it } from 'vitest'
import { splitTopLevelImports } from '../../src/build/css'

describe('splitTopLevelImports', () => {
  it('leaves a stylesheet with no imports untouched', () => {
    const css = 'p { color: red }'
    expect(splitTopLevelImports(css)).toEqual({ imports: [], body: css })
  })

  it('extracts the url() form, in either quoting style', () => {
    expect(splitTopLevelImports('@import url("a.css");\np{}').imports).toEqual(['@import url("a.css")'])
    expect(splitTopLevelImports("@import url('a.css');p{}").imports).toEqual(["@import url('a.css')"])
    expect(splitTopLevelImports('@import url(a.css);p{}').imports).toEqual(['@import url(a.css)'])
  })

  it('extracts the bare-string form', () => {
    expect(splitTopLevelImports('@import "a.css";p{}').imports).toEqual(['@import "a.css"'])
  })

  it('keeps a media query on the rule, and removes it from the body', () => {
    const split = splitTopLevelImports('@import url("print.css") print;\np{}')
    expect(split.imports).toEqual(['@import url("print.css") print'])
    expect(split.body.trim()).toBe('p{}')
  })

  it('extracts several imports and preserves the rest in order', () => {
    const split = splitTopLevelImports('@import "a.css";\nbody{x:1}\n@import "b.css";\np{y:2}')
    expect(split.imports).toEqual(['@import "a.css"', '@import "b.css"'])
    expect(split.body.replace(/\s+/g, '')).toBe('body{x:1}p{y:2}')
  })

  it('does not touch an @import nested inside a block', () => {
    // Illegal in CSS anyway, but rewriting it would move a rule the author wrote
    // somewhere else — worse than leaving a broken rule where it can be seen.
    const css = '@media print { @import "a.css"; }'
    expect(splitTopLevelImports(css)).toEqual({ imports: [], body: css })
  })

  it('does not touch an @import inside a comment', () => {
    const css = '/* @import "a.css"; */\np{}'
    expect(splitTopLevelImports(css)).toEqual({ imports: [], body: css })
  })

  it('does not touch an @import inside a string', () => {
    const css = 'p::after { content: "@import \\"a.css\\";" }'
    expect(splitTopLevelImports(css)).toEqual({ imports: [], body: css })
  })

  it('is not fooled by an at-rule whose name merely starts with @import', () => {
    // `@importsomething` is not `@import`; moving it into a layer block would
    // turn a live rule into an ignored one.
    const css = '@importx "a.css";'
    expect(splitTopLevelImports(css)).toEqual({ imports: [], body: css })
  })

  it('is not fooled by braces or semicolons inside strings', () => {
    const split = splitTopLevelImports('p::after { content: "} ; {" }\n@import "a.css";')
    expect(split.imports).toEqual(['@import "a.css"'])
    expect(split.body).toContain('content: "} ; {"')
  })

  it('is not fooled by a brace inside a comment', () => {
    const split = splitTopLevelImports('/* } */\n@import "a.css";\np{}')
    expect(split.imports).toEqual(['@import "a.css"'])
    expect(split.body).toContain('/* } */')
  })

  it('counts nested braces, so a later top-level import is still found', () => {
    const split = splitTopLevelImports('@media x { p { a: 1 } }\n@import "a.css";')
    expect(split.imports).toEqual(['@import "a.css"'])
  })

  it('handles an escaped quote inside a string', () => {
    const css = 'p { content: "a\\"@import b"; }\n@import "c.css";'
    expect(splitTopLevelImports(css).imports).toEqual(['@import "c.css"'])
  })

  it('leaves a malformed trailing import in the body rather than truncating the sheet', () => {
    const css = 'p{}\n@import "a.css"'
    const split = splitTopLevelImports(css)
    expect(split.imports).toEqual([])
    expect(split.body).toBe(css)
  })
})
