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

    expect(worker).toContain("event.request.mode === 'navigate'")
    expect(worker).toContain("basename.startsWith('@') && basename.length > 1")
    expect(worker).toContain("caches.match('./404.html')")
    expect(worker).toContain('status: 404')
    expect(worker).toContain("event.request.method === 'HEAD' ? new Request(url.href)")
    expect(worker).toContain("event.respondWith(caches.match(lookup)")
  })

  it('keeps ordinary requests on cache-first fallback behavior', () => {
    const worker = renderServiceWorker([toEntryPath('404.html')])

    expect(worker).toContain('caches.match(lookup).then((cached) => {')
    expect(worker).toContain('if (cached === undefined) return fetch(event.request)')
  })
})
