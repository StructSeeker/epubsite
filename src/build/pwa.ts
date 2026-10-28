import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import {
  RESERVED_PATHS,
  SHELL_ASSETS,
  toEntryPath,
  toUrlPath,
  type EntryPath,
} from '../shared/paths'

export function renderPwaManifest(title: string): string {
  return `${JSON.stringify(
    {
      name: title,
      short_name: title,
      start_url: `./${RESERVED_PATHS.shell}`,
      scope: './',
      display: 'standalone',
      icons: [
        {
          src: `${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.iconSvg}`,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    },
    null,
    2,
  )}\n`
}

export async function siteFiles(root: string): Promise<EntryPath[]> {
  const files: EntryPath[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else files.push(toEntryPath(relative(root, full).split('\\').join('/')))
    }
  }
  await walk(root)
  files.sort()
  return files
}

export function renderServiceWorker(files: readonly EntryPath[]): string {
  const urls = files.map((file) => `./${toUrlPath(file)}`)
  return `'use strict'

const CACHE = 'epubsite-v1'
const GUIDE = './${RESERVED_PATHS.guide}'
const PRECACHE = ${JSON.stringify(urls)}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' && request.method !== 'HEAD') return
  // A range request needs a 206 from the origin; answering it with a whole cached
  // file breaks media seeking instead of helping it.
  if (request.headers.has('range')) return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  const basename = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  if (request.mode === 'navigate' && basename.startsWith('@') && basename.length > 1) {
    // The token protocol is a 404 by construction, so answer with the cached
    // guide and let it redirect into the reader. Only documents do this: a
    // missing image must stay a missing image.
    event.respondWith(guideResponse())
    return
  }

  event.respondWith(cachedResponse(request, url))
})

async function precache() {
  const cache = await caches.open(CACHE)
  // Not addAll(): it is all-or-nothing, so a host that refuses one entry (a
  // dotfile, say) would leave the whole site with no offline support. A small
  // pool keeps the install from opening one connection per book file.
  const queue = PRECACHE.slice()
  const failed = []
  const drain = async () => {
    for (;;) {
      const url = queue.shift()
      if (url === undefined) return
      try {
        await store(cache, url)
      } catch {
        failed.push(url)
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, drain))
  if (failed.length > 0) {
    console.warn('epubsite: ' + failed.length + ' file(s) could not be precached; offline reading may be incomplete')
  }
}

async function store(cache, url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(url + ': ' + response.status)
  // Dropping Vary is what makes the stored copy usable. A host that sends
  // "Vary: *" (or varies on Accept) makes Cache.put reject the response, and a
  // cached copy keyed by headers would not match the next request anyway. There
  // is exactly one representation of a static file, so there is nothing to
  // negotiate.
  const headers = new Headers(response.headers)
  headers.delete('vary')
  await cache.put(
    url,
    new Response(response.body, { status: response.status, statusText: response.statusText, headers }),
  )
}

async function guideResponse() {
  const cache = await caches.open(CACHE)
  const guide = await cache.match(GUIDE, { ignoreVary: true })
  if (guide === undefined) return fetch(GUIDE)
  const body = await guide.clone().arrayBuffer()
  return new Response(body, { status: 404, statusText: 'Not Found', headers: guide.headers })
}

async function cachedResponse(request, url) {
  const cache = await caches.open(CACHE)
  // Look the entry up by URL, never by the request object. Cache matching honours
  // the response's Vary header against the *request's* headers, and a navigation
  // (Accept: text/html, …) never matches a precached entry (Accept: */*) when a
  // host sends Vary: Accept — the site then fails offline while looking installed.
  // There is exactly one stored variant per URL, so ignoring Vary is not a
  // trade-off, and neither is dropping the query: a query never selects a
  // different file, and epubsite.html?p=… must still find the shell.
  const key = new Request(url.origin + url.pathname)
  const cached = await cache.match(key, { ignoreVary: true })
  if (cached === undefined) return fetch(request)
  if (request.method !== 'HEAD') return cached
  return new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers })
}
`
}
