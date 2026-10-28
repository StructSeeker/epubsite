import { describe, expect, it } from 'vitest'
import { renderServiceWorker } from '../../src/build/pwa'
import { toEntryPath } from '../../src/shared/paths'

describe('renderServiceWorker', () => {
  it('routes only token document navigations through the cached 404 guide', () => {
    const worker = renderServiceWorker([
      toEntryPath('404.html'),
      toEntryPath('epubsite.html'),
      toEntryPath('OPS/chapter_001.xhtml'),
    ])

    expect(worker).toContain("request.mode === 'navigate'")
    expect(worker).toContain("basename.startsWith('@') && basename.length > 1")
    expect(worker).toContain("const GUIDE = './404.html'")
    expect(worker).toContain('cache.match(GUIDE, { ignoreVary: true })')
    expect(worker).toContain('status: 404')
  })

  it('keeps ordinary requests on cache-first fallback behavior', () => {
    const worker = renderServiceWorker([toEntryPath('404.html')])

    expect(worker).toContain('event.respondWith(cachedResponse(request, url))')
    expect(worker).toContain('if (cached === undefined) return fetch(request)')
  })

  it('matches cache entries without the Vary header or the query string', () => {
    // A navigation sends `Accept: text/html,…`; a precached entry was fetched
    // with `Accept: */*`. A host that sends `Vary: Accept` makes those two
    // requests unequal, so a request-object lookup misses and the site fails
    // offline while still looking installed.
    const worker = renderServiceWorker([toEntryPath('epubsite.html')])

    expect(worker).toContain('const key = new Request(url.origin + url.pathname)')
    expect(worker).toContain('cache.match(key, { ignoreVary: true })')
  })

  it('precaches each file independently, so one blocked file cannot disable offline support', () => {
    const worker = renderServiceWorker([toEntryPath('epubsite.html'), toEntryPath('.epubsite-root')])

    expect(worker).not.toContain('cache.addAll(')
    expect(worker).toContain('await store(cache, url)')
    expect(worker).toContain('failed.push(url)')
  })

  it('stores responses without Vary, which the cache rejects for Vary: *, and which caused navigation misses', () => {
    const worker = renderServiceWorker([toEntryPath('epubsite.html')])

    expect(worker).toContain("headers.delete('vary')")
    expect(worker).toContain('await cache.put(')
  })

  it('leaves subresource range requests to the origin', () => {
    const worker = renderServiceWorker([toEntryPath('epubsite.html')])

    expect(worker).toContain("if (request.headers.has('range')) return")
  })
})
