/**
 * Escaping and the tag template (spec §10, §4.6).
 *
 * The property under test is not "does `escapeHtml` escape `<`" — it is "can a
 * book's metadata reach our markup unescaped". So the tests are written as
 * injections: hostile values go in, and the assertion is that they come out
 * inert.
 */
import { describe, expect, it } from 'vitest'
import {
  attr,
  escapeHtml,
  html,
  markSafe,
  render,
  scriptJson,
  scriptString,
  serializeJson,
} from '../../src/build/render/escape'
import { renderTransitPage } from '../../src/build/render/transit'

describe('escapeHtml', () => {
  it('escapes the four characters that can change the meaning of markup', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;')
  })

  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })

  it('leaves apostrophes alone, because every attribute we emit is double quoted', () => {
    expect(escapeHtml("it's")).toBe("it's")
  })
})

describe('html tag template', () => {
  it('escapes interpolated values but not the literal markup', () => {
    const out = render(html`<p>${'<script>'}</p>`)
    expect(out).toBe('<p>&lt;script&gt;</p>')
  })

  it('inserts SafeHtml verbatim, so nested templates compose', () => {
    const inner = html`<em>${'&'}</em>`
    expect(render(html`<div>${inner}</div>`)).toBe('<div><em>&amp;</em></div>')
  })

  it('flattens arrays without joining by hand', () => {
    const items = ['a', 'b']
    expect(render(html`<ul>${items.map((item) => html`<li>${item}</li>`)}</ul>`)).toBe(
      '<ul><li>a</li><li>b</li></ul>',
    )
  })

  it('renders null and undefined as nothing rather than as text', () => {
    expect(render(html`<p>${null}${undefined}x</p>`)).toBe('<p>x</p>')
  })

  it('does not let a hostile value close the element it was placed in', () => {
    const hostile = '"><script>alert(1)</script>'
    const out = render(html`<meta name="description" content="${hostile}">`)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&quot;&gt;&lt;script&gt;')
  })
})

describe('attr', () => {
  it('emits a quoted attribute', () => {
    expect(render(html`<span${attr('dir', 'rtl')}>`)).toBe('<span dir="rtl">')
  })

  it('omits the attribute entirely for undefined, null, false and empty string', () => {
    for (const value of [undefined, null, false, ''] as const) {
      expect(render(html`<span${attr('dir', value)}>`)).toBe('<span>')
    }
  })

  it('escapes the value', () => {
    expect(render(html`<span${attr('title', '"quoted"')}>`)).toBe('<span title="&quot;quoted&quot;">')
  })
})

describe('serializeJson', () => {
  it('escapes < so a value cannot end the script element early', () => {
    expect(serializeJson({ name: '</script><img>' })).toBe(
      '{"name":"\\u003c/script>\\u003cimg>"}',
    )
  })

  it('round-trips: the escape is an escape, not a mutation', () => {
    const value = { a: '<b>', b: ['</script>'] }
    expect(JSON.parse(serializeJson(value))).toEqual(value)
  })

  it('leaves > alone, because it cannot end the element', () => {
    expect(serializeJson('>')).toBe('">"')
  })

  it('scriptString marks the literal as code, so the escaper cannot touch it', () => {
    // HTML script content is raw text: `&quot;` there is not a quote, so an
    // escaped JavaScript string is simply a syntax error. This is the bug the
    // transit page had, and the wrapper exists so it cannot come back.
    expect(render(html`${scriptString('</script>')}`)).toBe('"\\u003c/script>"')
    expect(render(html`${scriptJson({ a: '<b>' })}`)).toBe('{"a":"\\u003cb>"}')
  })
})

describe('markSafe', () => {
  it('is the only way to bypass escaping, and says so at the call site', () => {
    expect(render(html`${markSafe('<hr>')}`)).toBe('<hr>')
  })
})

describe('renderTransitPage', () => {
  const page = render(renderTransitPage('epubsite.html'))

  it('is a complete document', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<meta charset="utf-8">')
  })

  it('forwards the query string and the fragment (§8.3 constraint 5)', () => {
    // Dropping `?p=` is the single mistake that silently degrades a shared token
    // link into the landing page, with nothing reporting a failure.
    expect(page).toContain('location.search')
    expect(page).toContain('location.hash')
  })

  it('uses location.replace, so Back does not bounce off it forever (§8.3 constraint 4)', () => {
    expect(page).toContain('location.replace(')
    expect(page).not.toMatch(/location\.href\s*=/)
    expect(page).not.toContain('http-equiv="refresh"')
  })

  it('targets the configured shell name with a relative URL', () => {
    expect(page).toContain('location.replace("epubsite.html"')
    expect(render(renderTransitPage('reader.html'))).toContain('location.replace("reader.html"')
  })

  it('has no external references at all (§8.3 constraint 1)', () => {
    expect(page).not.toMatch(/<script[^>]+src=/)
    expect(page).not.toMatch(/<link[^>]+href=/)
    expect(page).not.toContain('http://')
    expect(page).not.toContain('https://')
  })

  it('still gets the reader to the reader without JavaScript', () => {
    expect(page).toContain('<a href="epubsite.html">')
  })
})
