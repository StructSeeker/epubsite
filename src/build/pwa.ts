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
  return `const CACHE = 'epubsite-v1'\nconst PRECACHE = ${JSON.stringify(urls)}\n\n` +
    `self.addEventListener('install', (event) => {\n` +
    `  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))\n` +
    `})\n\n` +
    `self.addEventListener('activate', (event) => {\n` +
    `  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))))\n` +
    `})\n\n` +
    `self.addEventListener('fetch', (event) => {\n` +
    `  if (event.request.method !== 'GET') return\n` +
    `  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)))\n` +
    `})\n`
}
