/**
 * The 404 guide (spec §8.3).
 *
 * This page is the most constrained file the build produces: served at an
 * arbitrary depth, with no manifest, no control over where it lands, and five
 * constraints that each break something different when violated. The tests are
 * shaped around those constraints rather than around the markup.
 */
import { describe, expect, it } from 'vitest'
import { renderGuide404 } from '../../src/build/render/guide-404'
import { render } from '../../src/build/render/escape'

const TOKEN_IIFE = 'var epubsiteToken=(function(){return{fromToken:function(){},isTokenPath:function(){}}})();'
const page = render(renderGuide404({ shellName: 'epubsite.html', tokenScript: TOKEN_IIFE }))

describe('renderGuide404 — constraint 1: self-contained', () => {
  it('has no external references at all', () => {
    // It is served *at* the missing path, so a relative src would be requested
    // from the deep directory and 404 again.
    expect(page).not.toMatch(/<script[^>]+src=/i)
    expect(page).not.toMatch(/<link[^>]+href=/i)
    expect(page).not.toContain('http://')
    expect(page).not.toContain('https://')
  })

  it('inlines the compiled token transform rather than a second implementation', () => {
    // §C.4.2: hand-copying the transform into the guide would make the bijection
    // test meaningless, so the build pastes in the same source compiled once.
    expect(page).toContain('var epubsiteToken=')
    // …inside a script element. Inlining it as text renders it as visible prose
    // and leaves the global undefined, which is exactly what happened the first
    // time this was written.
    expect(page).toMatch(/<script>var epubsiteToken=/)
  })
})

describe('renderGuide404 — constraint 2: it must find the site root', () => {
  it('probes for the uniquely named marker rather than counting ../', () => {
    expect(page).toContain('.epubsite-root')
  })

  it('probes deepest first and stops at the first hit', () => {
    // The deepest candidate is the origin root, which is where the site root is
    // for the common case of a deployment at the origin — so the common case
    // costs one request and produces no failed ones. Probing every candidate at
    // once would fire one deliberate 404 per level on every missing path, which
    // is what makes a zero-4xx detector useless.
    expect(page).toContain('var candidate = depth')
    expect(page).toContain('candidate -= 1')
    expect(page).toContain('if (response.ok) done(new URL(repeatUp(level), location.href))')
    expect(page).not.toContain('Promise.all')
  })

  it('falls back to the naive count when no marker answers', () => {
    // A site built before this feature, or a host that does not serve dotfiles.
    expect(page).toContain('done(new URL(repeatUp(depth), location.href))')
  })
})

describe('renderGuide404 — constraint 3: only token paths redirect', () => {
  it('guards the redirect behind the token check', () => {
    expect(page).toContain('if (!epubsiteToken.isTokenPath(location.pathname)) return')
  })

  it('does not redirect before that check', () => {
    const replaceAt = page.indexOf('location.replace(')
    const guardAt = page.indexOf('isTokenPath(location.pathname)')
    expect(guardAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(replaceAt)
  })
})

describe('renderGuide404 — constraint 4: replace, never assign', () => {
  it('uses location.replace', () => {
    expect(page).toContain('location.replace(url.href)')
  })

  it('never assigns location.href, and never uses a meta refresh', () => {
    // Assigning href leaves the 404 in history, so Back lands on it and it
    // bounces forward again — a loop the user cannot escape.
    expect(page).not.toMatch(/location\.href\s*=/)
    expect(page).not.toContain('http-equiv="refresh"')
  })
})

describe('renderGuide404 — the redirect target', () => {
  it('points straight at the shell, never through index.html (§8.2)', () => {
    // Routing a `?p=` entry through the transit page is the one mistake that
    // silently degrades every shared link into the landing page.
    expect(page).toContain("var SHELL = \"epubsite.html\"")
    expect(page).not.toContain('index.html')
  })

  it('follows --name, so a renamed shell is still the target', () => {
    const renamed = render(renderGuide404({ shellName: 'reader.html', tokenScript: TOKEN_IIFE }))
    expect(renamed).toContain('var SHELL = "reader.html"')
  })

  it('encodes the parameters instead of splicing them into a query string', () => {
    // A book whose file names contain `&` or `=` would otherwise split the query.
    expect(page).toContain('url.searchParams.set(')
  })

  it('carries the fragment across as h', () => {
    expect(page).toContain("url.searchParams.set('h',")
  })

  it('strips the deployment prefix from the recovered path', () => {
    expect(page).toContain('realPath.slice(root.pathname.length)')
  })
})

describe('renderGuide404 — the page itself', () => {
  it('is a complete, noindex document', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<meta charset="utf-8">')
    expect(page).toContain('name="robots" content="noindex"')
  })

  it('escapes a script body that would otherwise end the element early', () => {
    const hostile = render(
      renderGuide404({ shellName: 'x.html', tokenScript: 'var a="</script>";' }),
    )
    expect(hostile).not.toContain('</script>";')
    expect(hostile).toContain('<\\/script>')
  })
})
