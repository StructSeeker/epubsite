/**
 * End-to-end builds against synthetic books (spec §13.1, §14 P1).
 *
 * The acceptance criterion for P1 is fourfold, and each part is asserted from
 * the outside:
 *
 *   - any chapter opens on its own — the site is a real multi-page site, and a
 *     chapter's path on disk is its path in the book (§3.1);
 *   - the site's contents are the book's contents (§13.1);
 *   - a reserved-namespace collision fails with exit 4 (§3.2);
 *   - `--hosting rewrite` fails with exit 2 and a reason (§8.4).
 *
 * The zero-rewrite check is re-implemented here by walking the output directory
 * rather than by asking the build what it wrote. A test that asks the suspect to
 * testify is not evidence.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from '../../src/build/build'
import type { BuildOptions } from '../../src/build/options'
import { isEpubSiteError, type EpubSiteError } from '../../src/build/errors'
import { openEpub } from '../../src/build/epub/zip'
import { RESERVED_PATHS, SHELL_ASSETS } from '../../src/shared/paths'
import { sampleEpub, sampleOpf } from '../fixtures/zip-writer'
import { createTempRoot, readTree, removeTempRoot, writeEpub } from '../fixtures/tmp'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTempRoot(root)))
})

async function workspace(prefix: string): Promise<string> {
  const root = await createTempRoot(prefix)
  roots.push(root)
  return root
}

interface Site {
  root: string
  out: string
  epub: string
}

async function buildSite(
  bytes: Buffer = sampleEpub(),
  options: Partial<BuildOptions> = {},
): Promise<{ site: Site; result: Awaited<ReturnType<typeof build>> }> {
  const root = await workspace('build')
  const epub = await writeEpub(root, bytes)
  const out = join(root, 'site')
  const result = await build(epub, { out, ...options })
  return { site: { root, out, epub }, result }
}

async function failure(run: () => Promise<unknown>): Promise<EpubSiteError> {
  let caught: unknown
  try {
    await run()
  } catch (error) {
    caught = error
  }
  expect(isEpubSiteError(caught), `expected an EpubSiteError, got: ${String(caught)}`).toBe(true)
  return caught as EpubSiteError
}

/**
 * The shell's favicon `<link>`, as written.
 *
 * Extracted rather than compared whole because the tag's attribute set is
 * conditional (`data-shell` only under the SPA) and asserting a full literal
 * would make an ordering change look like a regression.
 */
function iconTag(shell: string): string {
  const match = /<link rel="icon"[^>]*>/.exec(shell)
  if (match === null) throw new Error('the shell carries no favicon link')
  return match[0]
}

describe('build — a site that is the book', () => {
  it('writes every entry of the container, at its own path, at its own length', async () => {
    const { site } = await buildSite()

    const archive = await openEpub(site.epub)
    const source = archive.entries.map((entry) => ({
      path: entry.entryPath as string,
      bytes: entry.uncompressedSize,
    }))
    await archive.close()

    const tree = await readTree(site.out)
    for (const entry of source) {
      const written = tree.get(entry.path)
      expect(written, `${entry.path} should have been copied`).toBeDefined()
      expect(written?.bytes, `${entry.path} should have the same length`).toBe(entry.bytes)
    }
  })

  it('adds nothing outside the reserved namespace (§13.1a)', async () => {
    const { site } = await buildSite()

    const archive = await openEpub(site.epub)
    const source = new Set<string>(archive.entries.map((entry) => entry.entryPath as string))
    await archive.close()

    // The namespace is the contract (§3.2), so it is stated here independently
    // of what the build happened to write: prefix matching means adding an asset
    // later cannot smuggle a file past this check.
    const inReservedNamespace = (path: string): boolean =>
      path === 'epubsite.html' ||
      path === RESERVED_PATHS.transit ||
      path === RESERVED_PATHS.guide ||
      path === RESERVED_PATHS.manifest ||
      path === RESERVED_PATHS.rootMarker ||
      path.startsWith(RESERVED_PATHS.assetsDir) ||
      path.startsWith(RESERVED_PATHS.hostingDir)

    const tree = await readTree(site.out)
    const unexpected = [...tree.keys()].filter(
      (path) => !source.has(path) && !inReservedNamespace(path),
    )
    expect(unexpected).toEqual([])
  })

  it('renders the shell with a table of contents pointing at real chapter paths', async () => {
    const { site } = await buildSite()
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''

    expect(shell.startsWith('<!doctype html>')).toBe(true)
    expect(shell).toContain('<title>Sample Book</title>')
    expect(shell).toContain('<nav id="toc" aria-label="Table of contents">')
    // Absolute paths in the markup would be wrong: the shell is served from the
    // site root, and a relative link keeps the artifact deployment-agnostic (I4).
    expect(shell).toContain('href="OEBPS/text/ch01.xhtml"')
    expect(shell).toContain('href="OEBPS/text/deep/ch03.xhtml"')
    // The description carries `<em>` in the source; it must arrive as text.
    expect(shell).toContain('<p class="description">A sample with markup.</p>')
    expect(shell).toContain('<p class="byline">Ada Lovelace</p>')
  })

  it('uses the book’s own navigation labels and nesting (§4.3)', async () => {
    const { site } = await buildSite()
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''

    // sampleEpub's nav.xhtml is nested: Chapter 1 contains Section 1.1.
    expect(shell).toContain('>Chapter 1</a>')
    expect(shell).toContain('>Section 1.1</a>')
    expect(shell).toContain('href="OEBPS/text/ch01.xhtml#sec1"')
    // The landmarks nav is kept as a secondary list (§4.3).
    expect(shell).toContain('<section id="landmarks"')
    expect(shell).toContain('>Start</a>')
  })

  it('wires the SPA layer: boost, an overridden target, and marked shell links', async () => {
    const { site } = await buildSite()
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''

    expect(shell).toContain('hx-boost="true"')
    // Without this override boost targets <body> and the sidebar is swapped away.
    expect(shell).toContain('hx-target="#epub-content"')
    expect(shell).toContain('hx-swap="innerHTML show:top"')
    // §5.3: shell links carry the marker the runtime absolutises.
    expect(shell).toContain('href="OEBPS/text/ch01.xhtml" data-shell')
    expect(shell).toContain('<script type="module" src="_epubsite_assets/shell.js"></script>')
  })

  it('ships the runtime, htmx and the shell data only when the SPA layer is on', async () => {
    const withSpa = await readTree((await buildSite()).site.out)
    expect(withSpa.has('_epubsite_assets/shell.js')).toBe(true)
    expect(withSpa.has('_epubsite_assets/htmx.esm.js')).toBe(true)
    expect(withSpa.has('_epubsite_assets/shell-data.json')).toBe(true)

    const { site } = await buildSite(sampleEpub(), { spa: false })
    const withoutSpa = await readTree(site.out)
    const shell = withoutSpa.get('epubsite.html')?.content.toString('utf8') ?? ''

    expect(withoutSpa.has('_epubsite_assets/shell.js')).toBe(false)
    expect(withoutSpa.has('_epubsite_assets/htmx.esm.js')).toBe(false)
    expect(withoutSpa.has('_epubsite_assets/shell-data.json')).toBe(false)
    expect(shell).not.toContain('hx-boost')
    expect(shell).not.toContain('data-shell')
    // No runtime module — but the book's JSON-LD stays: `--no-spa` removes
    // behaviour, not structured data (§7.2).
    expect(shell).not.toContain('<script type="module"')
    expect(shell).toContain('<script type="application/ld+json">')
    // Multi-page still works: the skip link is a plain fragment again.
    expect(shell).toContain('href="#epub-content"')
  })

  it('describes every spine chapter in shell-data.json (A.2)', async () => {
    const { site } = await buildSite()
    const raw = (await readTree(site.out))
      .get('_epubsite_assets/shell-data.json')
      ?.content.toString('utf8') ?? ''
    const data = JSON.parse(raw) as {
      book: { '@id': string | null; url?: string }
      byKey: Record<string, { title: string; bodyClass: string; headStyles: { links: string[]; imports: string[]; inline: string[] } }>
      nav: unknown[]
    }

    expect(data.book['@id']).toBe('urn:isbn:9780000000000')
    // A path-form base URL carries no origin, so `url` must be absent (§7.5).
    expect(data.book.url).toBeUndefined()
    expect(Object.keys(data.byKey).sort()).toEqual([
      'OEBPS/nav.xhtml',
      'OEBPS/text/ch01.xhtml',
      'OEBPS/text/ch02.xhtml',
      'OEBPS/text/deep/ch03.xhtml',
    ])

    const ch1 = data.byKey['OEBPS/text/ch01.xhtml']
    expect(ch1?.title).toBe('Chapter 1')
    // The book sets class="calibre" on <body>; an innerHTML swap would lose it.
    expect(ch1?.bodyClass).toBe('calibre')
    // Resolved against the chapter's own directory, not left relative: the
    // runtime only prefixes SITE_ROOT.
    expect(ch1?.headStyles.links).toEqual(['OEBPS/Styles/book.css'])
    // The inline <style> opened with @import, which cannot live inside @layer.
    expect(ch1?.headStyles.imports).toEqual(['OEBPS/Styles/extra.css'])
    expect(ch1?.headStyles.inline.join('')).toContain('text-indent')
    expect(ch1?.headStyles.inline.join('')).not.toContain('@import')

    expect(data.nav).toHaveLength(3)
  })

  it('adds the origin-dependent url to shell-data only for an absolute --base-url', async () => {
    const { site } = await buildSite(sampleEpub(), {
      baseUrl: { form: 'absolute', href: 'https://example.com/books/' },
    })
    const raw = (await readTree(site.out))
      .get('_epubsite_assets/shell-data.json')
      ?.content.toString('utf8') ?? ''

    expect((JSON.parse(raw) as { book: { url?: string } }).book.url).toBe(
      'https://example.com/books/epubsite.html',
    )
  })

  it('falls back to the chapter’s own <h1> when the book’s nav omits it (§12)', async () => {
    const navWithoutCh2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="text/ch01.xhtml">Chapter 1</a></li>
  <li><a href="text/deep/ch03.xhtml">Chapter 3</a></li>
</ol></nav></body>
</html>`
    // No <title> and no nav entry: only the <h1> is left before the position.
    const ch2WithH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head></head>
<body><h1>Second Chapter</h1><p>Body text two.</p></body></html>`

    const { site } = await buildSite(
      sampleEpub({ 'OEBPS/nav.xhtml': navWithoutCh2, 'OEBPS/text/ch02.xhtml': ch2WithH1 }),
    )
    const raw = (await readTree(site.out))
      .get('_epubsite_assets/shell-data.json')
      ?.content.toString('utf8') ?? ''
    const data = JSON.parse(raw) as { byKey: Record<string, { title: string; section: string | null }> }

    expect(data.byKey['OEBPS/text/ch02.xhtml']?.title).toBe('Second Chapter')
    // The nav's own label still wins for the chapters it does name.
    expect(data.byKey['OEBPS/text/ch01.xhtml']?.title).toBe('Chapter 1')
    // The nested nav gives chapter 1 a section; nothing else has one.
    expect(data.byKey['OEBPS/text/ch01.xhtml']?.section).toBeNull()
  })

  it('generates the transit page when the book has no top-level index.html', async () => {
    const { site } = await buildSite()
    const transit = (await readTree(site.out)).get('index.html')?.content.toString('utf8') ?? ''

    expect(transit).toContain('location.replace("epubsite.html" + location.search + location.hash);')
  })

  it('ships the shell stylesheet', async () => {
    const { site } = await buildSite()
    const css = (await readTree(site.out)).get('_epubsite_assets/shell.css')?.content.toString('utf8')

    // The cascade layer declaration is what keeps EPUB styles from breaking the
    // layout, so its presence is worth asserting rather than assuming.
    expect(css).toContain('@layer epub, shell;')
  })

  it('reports chapters and resources', async () => {
    const { result } = await buildSite()
    // Spine: ch1, ch2, deep, nav (linear="no" still counts as reading order).
    expect(result.stats.chapters).toBe(4)
    // 9 entries in the container, 4 of them chapters.
    expect(result.stats.resources).toBe(5)
    expect(result.stats.bytes).toBeGreaterThan(0)
  })

  it('returns an absolute outDir so nobody has to guess the cwd', async () => {
    const { site, result } = await buildSite()
    expect(result.outDir).toBe(resolve(site.out))
  })
})

describe('build — the reserved namespace (§3.2)', () => {
  it('fails with exit 4 when the book occupies the shell path', async () => {
    const error = await failure(() => buildSite(sampleEpub({ 'epubsite.html': '<html>mine</html>' })))
    expect(error).toMatchObject({ code: 'E_OUTPUT_CONFLICT', exitCode: 4 })
    expect(error.message).toContain('epubsite.html')
  })

  it('fails with exit 4 on an @-prefixed basename, so the token namespace stays free', async () => {
    const error = await failure(() =>
      buildSite(sampleEpub({ 'OEBPS/text/@ch01.xhtml': '<html></html>' })),
    )
    expect(error).toMatchObject({ exitCode: 4 })
    expect(error.message).toContain('@ch01.xhtml')
  })

  it('fails with exit 4 when the book occupies the 404 guide, the manifest or the root marker', async () => {
    expect((await failure(() => buildSite(sampleEpub({ '404.html': 'x' })))).exitCode).toBe(4)
    expect((await failure(() => buildSite(sampleEpub({ 'publication.json': '{}' })))).exitCode).toBe(4)
    expect((await failure(() => buildSite(sampleEpub({ '.epubsite-root': '' })))).exitCode).toBe(4)
  })

  it("keeps the book's own index.html byte-for-byte and skips the transit page", async () => {
    const own = '<html><body>the book\u2019s own root document</body></html>'
    const { site } = await buildSite(sampleEpub({ 'index.html': own }))

    const transit = (await readTree(site.out)).get('index.html')
    expect(transit?.content.toString('utf8')).toBe(own)
  })

  it('moves the reserved shell name when --name says so', async () => {
    const book = { 'epubsite.html': '<html>an ordinary file of the book</html>' }
    const { site } = await buildSite(sampleEpub(book), { name: 'reader.html' })

    const tree = await readTree(site.out)
    expect(tree.has('reader.html')).toBe(true)
    // With --name reader.html, epubsite.html is just another file in the book.
    expect(tree.get('epubsite.html')?.content.toString('utf8')).toBe(book['epubsite.html'])
  })
})

describe('build — refusals', () => {
  it('fails with exit 5 on encrypted content', async () => {
    const error = await failure(() =>
      buildSite(sampleEpub({ 'META-INF/encryption.xml': '<encryption/>' })),
    )
    expect(error).toMatchObject({ code: 'E_ENCRYPTED', exitCode: 5 })
  })

  it('fails with exit 2 on --hosting rewrite, naming the reason (the one documented gap)', async () => {
    for (const mode of ['rewrite', 'all'] as const) {
      const error = await failure(() => buildSite(sampleEpub(), { hosting: mode }))
      expect(error).toMatchObject({ code: 'E_NOT_IMPLEMENTED', exitCode: 2 })
      expect(error.message).toContain('hosting rewrite rules')
    }
  })

  it('implements --hosting none and 404 in full', async () => {
    for (const mode of ['none', '404'] as const) {
      const { result } = await buildSite(sampleEpub(), { hosting: mode })
      expect(result.stats.chapters).toBe(4)
    }
  })

  it('warns and still exits 0 when --search cannot be satisfied (D.3)', async () => {
    // Pagefind is a devDependency, so it *is* resolvable from the repository
    // root via the documented `npx` path. Point the explicit path at nothing to
    // force the unavailable branch instead.
    const { result } = await buildSite(sampleEpub(), {
      search: true,
      pagefind: join(await workspace('no-pagefind'), 'missing-pagefind'),
    })
    expect(result.stats.chapters).toBe(4)
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain(
      'W_SEARCH_UNAVAILABLE',
    )
    // The failure is reported, not fatal: the site is complete and usable.
    expect(await readFile(join(result.outDir, RESERVED_PATHS.shell), 'utf8')).toContain(
      'id="search-open"',
    )
  })

  it('produces a Pagefind index and a search control when it can (D.1, D.4)', async () => {
    const { site, result } = await buildSite(sampleEpub(), { search: true })
    expect(result.stats.chapters).toBe(4)

    const shell = await readFile(join(site.out, RESERVED_PATHS.shell), 'utf8')
    expect(shell).toContain('id="search-open"')

    // The bundle Pagefind writes, including the Component UI the runtime imports.
    const bundle = join(site.out, RESERVED_PATHS.assetsDir, 'pagefind')
    for (const file of [
      'pagefind.js',
      'pagefind-entry.json',
      'pagefind-component-ui.js',
      'pagefind-component-ui.css',
    ]) {
      expect(existsSync(join(bundle, file)), `expected ${file}`).toBe(true)
    }

    // Every indexed document comes from the spine, and the count can never
    // exceed it. The exclusion of the shell is asserted exactly, on the pattern
    // itself, in test/unit/search.test.ts — because here it can only be inferred,
    // and an inference is not evidence (§14).
    const entry = JSON.parse(await readFile(join(bundle, 'pagefind-entry.json'), 'utf8')) as {
      languages: Record<string, { page_count: number }>
    }
    const pages = Object.values(entry.languages).reduce(
      (total, language) => total + language.page_count,
      0,
    )
    expect(pages).toBeGreaterThan(0)
    expect(pages).toBeLessThanOrEqual(result.stats.chapters)
  })

  it('ships the icon and points the shell at it, with and without the SPA', async () => {
    for (const spa of [true, false]) {
      const { site } = await buildSite(sampleEpub(), { spa })
      const shell = await readFile(join(site.out, RESERVED_PATHS.shell), 'utf8')

      const tag = iconTag(shell)
      expect(tag).toContain('type="image/svg+xml"')
      expect(tag).toContain(`href="${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.iconSvg}"`)
      // Under the SPA the href must be absolutised once the runtime is up,
      // because a browser re-resolves `<link rel="icon">` after every
      // `pushState`; without the marker it 404s from the chapter's directory.
      // With `--no-spa` the URL never moves, so a relative href stays correct
      // and there is no runtime to rewrite it.
      expect(tag.includes('data-shell'), `data-shell for spa=${String(spa)}`).toBe(spa)

      // The reference is only worth anything if the file is really there: a
      // favicon 404s silently, so the browser shows nothing and nobody notices.
      const icon = join(site.out, RESERVED_PATHS.assetsDir, SHELL_ASSETS.iconSvg)
      expect(existsSync(icon), `expected icon for spa=${String(spa)}`).toBe(true)
      expect(await readFile(icon, 'utf8')).toContain('<svg')
    }
  })

  it('fails with exit 2 on an invalid option, before touching the file system', async () => {
    const error = await failure(() => buildSite(sampleEpub(), { name: 'index.html' }))
    expect(error).toMatchObject({ code: 'E_USAGE', exitCode: 2 })
  })

  it('fails with exit 3 on a file that is not a ZIP', async () => {
    const root = await workspace('garbage')
    const epub = await writeEpub(root, Buffer.from('this is not a zip file'))
    const error = await failure(() => build(epub, { out: join(root, 'site') }))
    expect(error).toMatchObject({ code: 'E_INVALID_EPUB', exitCode: 3 })
  })
})

describe('build — the output directory', () => {
  it('refuses a non-empty directory unless --force or --clean is given', async () => {
    const root = await workspace('occupied')
    const epub = await writeEpub(root, sampleEpub())
    const out = join(root, 'site')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'something-important.txt'), 'do not lose me')

    const error = await failure(() => build(epub, { out }))
    expect(error).toMatchObject({ code: 'E_OUTPUT_CONFLICT', exitCode: 4 })
    expect(error.message).toContain('--clean')
  })

  it('writes into a non-empty directory with --force and leaves the other files alone', async () => {
    const root = await workspace('forced')
    const epub = await writeEpub(root, sampleEpub())
    const out = join(root, 'site')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'something-important.txt'), 'do not lose me')

    await build(epub, { out, force: true })

    const tree = await readTree(out)
    expect(tree.get('something-important.txt')?.content.toString('utf8')).toBe('do not lose me')
    expect(tree.has('epubsite.html')).toBe(true)
  })

  it('removes stale content with --clean', async () => {
    const root = await workspace('cleaned')
    const epub = await writeEpub(root, sampleEpub())
    const out = join(root, 'site')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'stale.txt'), 'from a previous build')

    await build(epub, { out, clean: true })

    expect((await readTree(out)).has('stale.txt')).toBe(false)
  })

  it('writes nothing at all with --dry-run, but still validates', async () => {
    const { site, result } = await buildSite(sampleEpub(), { dryRun: true })

    expect(result.stats.chapters).toBe(4)
    await expect(readTree(site.out)).rejects.toThrow()

    // A dry run that skips the failures tells you nothing you could not guess.
    const error = await failure(() => buildSite(sampleEpub(), { hosting: 'rewrite', dryRun: true }))
    expect(error.exitCode).toBe(2)
  })

  it('refuses an output path that is an existing file', async () => {
    const root = await workspace('file-out')
    const epub = await writeEpub(root, sampleEpub())
    const out = join(root, 'site')
    await writeFile(out, 'I am a file')

    expect((await failure(() => build(epub, { out }))).exitCode).toBe(4)
  })
})

describe('build — the token protocol (§8.2, §8.3)', () => {
  it('emits a self-contained 404 guide that inlines the compiled token transform', async () => {
    const { site } = await buildSite()
    const guide = (await readTree(site.out)).get('404.html')?.content.toString('utf8') ?? ''

    expect(guide.startsWith('<!doctype html>')).toBe(true)
    // Constraint 1: served at the missing path, so nothing may be external.
    expect(guide).not.toMatch(/<script[^>]+src=/i)
    expect(guide).not.toMatch(/<link[^>]+href=/i)
    // C.4.2: the same source as the reader's, compiled once — never a hand copy.
    expect(guide).toContain('var epubsiteToken=')
    expect(guide).toContain('isTokenPath')
    expect(guide).toContain('location.replace(')
  })

  it('emits a root marker whose name no book may occupy (§3.2)', async () => {
    const { site } = await buildSite()
    const marker = (await readTree(site.out)).get('.epubsite-root')
    expect(marker).toBeDefined()
    expect((marker?.bytes ?? 0) > 0).toBe(true)
  })

  it('refuses a book that contains the root marker, which would break the probe', async () => {
    const error = await failure(() => buildSite(sampleEpub({ '.epubsite-root': 'mine' })))
    expect(error).toMatchObject({ exitCode: 4 })
  })
})

describe('build — structured data (§7, A.1, C.7)', () => {
  interface BookGraph {
    '@context': string
    '@type': string
    '@id': string
    name: string
    isbn?: string
    hasPart: { '@id': string; name: string; position: number; url?: string }[]
  }

  async function readJson(dir: string, path: string): Promise<Record<string, unknown>> {
    const raw = (await readTree(dir)).get(path)?.content.toString('utf8') ?? ''
    return JSON.parse(raw) as Record<string, unknown>
  }

  function bookNodeOf(shell: string): BookGraph {
    const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(shell)
    expect(match, 'the shell should carry a JSON-LD block').not.toBeNull()
    return JSON.parse((match as RegExpExecArray)[1] as string) as BookGraph
  }

  it('puts a complete Book node in the shell head, with every chapter in hasPart', async () => {
    const { site } = await buildSite()
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    const book = bookNodeOf(shell)

    expect(book['@context']).toBe('https://schema.org')
    expect(book['@type']).toBe('Book')
    expect(book['@id']).toBe('urn:isbn:9780000000000')
    expect(book.name).toBe('Sample Book')
    // §7.5: identifiers split by scheme — the ISBN here, and no `identifier`
    // field, because the book declares no second identifier.
    expect(book.isbn).toBe('9780000000000')
    // §7.7: a crawler that runs no JavaScript must still find the chapters, which
    // is the entire reason `hasPart` is on the static node.
    expect(book.hasPart.map((part) => part.position)).toEqual([1, 2, 3, 4])
    expect(book.hasPart[0]?.name).toBe('Chapter 1')
  })

  it('omits url everywhere for a path-form --base-url, and emits it for an absolute one', async () => {
    const relative = await buildSite()
    const relativeShell =
      (await readTree(relative.site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(relativeShell).not.toContain('"url"')

    const { site } = await buildSite(sampleEpub(), {
      baseUrl: { form: 'absolute', href: 'https://example.com/books/' },
    })
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    const book = bookNodeOf(shell)

    expect(book['@id']).toBe('urn:isbn:9780000000000')
    expect((book as unknown as { url: string }).url).toBe('https://example.com/books/epubsite.html')
    expect(book.hasPart[0]?.url).toBe('https://example.com/books/OEBPS/text/ch01.xhtml')
  })

  it('emits a REC-conformant manifest, with descriptive properties at the top level', async () => {
    const { site } = await buildSite()
    const publication = await readJson(site.out, 'publication.json')

    // A.1: the two-element context in this exact order, or the manifest is
    // rejected outright by the REC's own processing.
    expect(publication['@context']).toEqual([
      'https://schema.org',
      'https://www.w3.org/ns/pub-context',
    ])
    expect(publication.conformsTo).toBe('https://www.w3.org/TR/pub-manifest/')
    // There is no nested `metadata` object in the REC.
    expect(publication.metadata).toBeUndefined()
    expect(publication.name).toBe('Sample Book')
    expect(publication.isbn).toBe('9780000000000')

    const readingOrder = publication.readingOrder as { url: string; name: string }[]
    // Three, not four: sampleEpub's nav.xhtml is a spine item marked
    // linear="no", and the manifest has no way to say so, so it belongs in
    // `resources` with rel="contents" rather than in the reading order.
    expect(readingOrder).toHaveLength(3)
    // C.7: real paths. A token path answers 404 under the default hosting mode,
    // so a third-party consumer pointed at one would give up on the book.
    expect(readingOrder[0]?.url).toBe('OEBPS/text/ch01.xhtml')
    expect(readingOrder.some((entry) => entry.url.includes('@'))).toBe(false)
  })

  it('files relational resources under resources, never under links (A.1)', async () => {
    const { site } = await buildSite()
    const publication = await readJson(site.out, 'publication.json')
    const resources = publication.resources as { url: string; rel?: string; name?: string }[]

    // The REC strips `contents` and `cover` out of `links`, so putting them there
    // is a manifest that fails validation.
    expect(publication.links ?? []).toEqual([])
    expect(resources.find((entry) => entry.rel === 'contents')?.url).toBe('OEBPS/nav.xhtml')
    const cover = resources.find((entry) => entry.rel === 'cover')
    expect(cover?.url).toBe('OEBPS/Images/cover.png')
    // A cover with an `image/*` encodingFormat must carry a name.
    expect(cover?.name).toBe('Sample Book')
  })

  it('keeps the three artifacts consistent, because one function produced them', async () => {
    const { site } = await buildSite()
    const tree = await readTree(site.out)
    const shell = tree.get('epubsite.html')?.content.toString('utf8') ?? ''
    const data = JSON.parse(tree.get('_epubsite_assets/shell-data.json')?.content.toString('utf8') ?? '') as {
      byKey: Record<string, { jsonld?: { '@id': string; name: string; position: number } }>
      book: { '@id': string | null }
    }
    const book = bookNodeOf(shell)
    const publication = await readJson(site.out, 'publication.json')

    // §4.5 / C.7: the same property, in all three, must be the same value. This
    // is the assertion that would catch a second field map appearing.
    expect(data.book['@id']).toBe(book['@id'])
    expect(publication.name).toBe(book.name)
    for (const part of book.hasPart) {
      const fromShellData = Object.values(data.byKey).find((entry) => entry.jsonld?.['@id'] === part['@id'])
      expect(fromShellData?.jsonld?.name).toBe(part.name)
      expect(fromShellData?.jsonld?.position).toBe(part.position)
    }
  })

  it('gives each chapter node its own @context, and the book’s hasPart none', async () => {
    const { site } = await buildSite()
    const tree = await readTree(site.out)
    const data = JSON.parse(tree.get('_epubsite_assets/shell-data.json')?.content.toString('utf8') ?? '') as {
      byKey: Record<string, { jsonld?: Record<string, unknown> }>
    }

    const anyChapter = Object.values(data.byKey)[0]?.jsonld
    expect(anyChapter?.['@context']).toBe('https://schema.org')
    expect(anyChapter?.['isPartOf']).toEqual({ '@type': 'Book', '@id': 'urn:isbn:9780000000000' })

    const shell = tree.get('epubsite.html')?.content.toString('utf8') ?? ''
    // Repeating the context in every nested node would be bytes saying nothing.
    const nested = /"hasPart":\s*\[\s*\{([^}]*)\}/.exec(shell)
    expect(nested?.[1] ?? '').not.toContain('@context')
  })

  it('drops every JSON-LD block under --json-ld none but keeps the manifest descriptive', async () => {
    const { site } = await buildSite(sampleEpub(), { jsonLd: 'none' })
    const tree = await readTree(site.out)
    const shell = tree.get('epubsite.html')?.content.toString('utf8') ?? ''

    expect(shell).not.toContain('application/ld+json')

    const data = JSON.parse(tree.get('_epubsite_assets/shell-data.json')?.content.toString('utf8') ?? '') as {
      byKey: Record<string, { jsonld?: unknown }>
    }
    expect(Object.values(data.byKey).some((entry) => entry.jsonld !== undefined)).toBe(false)

    // A.1: `--json-ld` governs `<script>` blocks, not the manifest.
    const publication = await readJson(site.out, 'publication.json')
    expect(publication.name).toBe('Sample Book')
    expect(publication.readingOrder).toHaveLength(3)
  })

  it('thins hasPart under --json-ld thin, keeping what identifies and orders', async () => {
    const { site } = await buildSite(sampleEpub(), { jsonLd: 'thin' })
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    const book = bookNodeOf(shell)

    expect(book.hasPart).toHaveLength(4)
    expect(book.hasPart[0]).toMatchObject({
      '@id': 'urn:isbn:9780000000000#ch-1',
      name: 'Chapter 1',
      position: 1,
    })
    // The full node also carries headline, isPartOf and articleSection.
    expect('headline' in (book.hasPart[0] as object)).toBe(false)
    expect('isPartOf' in (book.hasPart[0] as object)).toBe(false)
  })
})

describe('build — edge cases and presentation (§11, §12)', () => {
  it('drops the SPA layer for a fixed-layout book and says so on the landing page', async () => {
    const fixed = sampleEpub({
      'OEBPS/content.opf': sampleOpf().replace(
        '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>',
        '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>' +
          '<meta property="rendition:layout">pre-paginated</meta>',
      ),
    })

    const { site, result } = await buildSite(fixed)
    const tree = await readTree(site.out)
    const shell = tree.get('epubsite.html')?.content.toString('utf8') ?? ''

    // A fixed pixel viewport and a responsive shell cannot coexist, so the
    // runtime is not merely discouraged — it is absent.
    expect(shell).not.toContain('hx-boost')
    expect(tree.has('_epubsite_assets/shell.js')).toBe(false)
    // §12 asks for the degradation to be explained, not just performed.
    expect(shell).toContain('class="notice"')
    expect(shell).toContain('fixed page layout')
    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain('W_PRE_PAGINATED')
  })

  it('emits data-theme only for an explicit choice (§11.2)', async () => {
    const dark = await buildSite(sampleEpub(), { theme: 'dark' })
    const darkShell =
      (await readTree(dark.site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(darkShell).toContain('data-theme="dark"')

    const light = await buildSite(sampleEpub(), { theme: 'light' })
    const lightShell =
      (await readTree(light.site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(lightShell).toContain('data-theme="light"')

    // `auto` emits nothing: `prefers-color-scheme` then decides, and keeps
    // deciding, rather than being frozen at load time.
    const auto = await buildSite(sampleEpub(), { theme: 'auto' })
    const autoShell =
      (await readTree(auto.site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(autoShell).not.toContain('data-theme')
  })

  it('reports external and out-of-tree references without failing the build (§12)', async () => {
    const withRefs = sampleEpub({
      'OEBPS/text/ch02.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head>
<body>
  <p><img src="https://cdn.example.com/cover.png" alt="remote"/></p>
  <p><a href="../../../outside.html">out of tree</a></p>
  <p><a href="#local">a local anchor</a></p>
  <p><a href="mailto:someone@example.com">mail</a></p>
</body></html>`,
    })

    const { result } = await buildSite(withRefs)

    expect(result.diagnostics.externalResources).toEqual(['https://cdn.example.com/cover.png'])
    expect(result.diagnostics.outOfTreeLinks).toEqual(['../../../outside.html'])
    // A book with a broken link is still readable; failing the build would trade
    // a cosmetic defect for a total one.
    expect(result.stats.chapters).toBe(4)
  })
})

describe('build — presentation that must not leak into reading order', () => {
  it('falls back to the spine when the book has no navigation document (§12)', async () => {
    const { site } = await buildSite(
      sampleEpub({
        'OEBPS/content.opf': sampleOpf({ withoutNav: true }),
        'OEBPS/nav.xhtml': undefined,
      }),
    )
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''

    // No nav document: the sidebar is the spine, and it is not empty.
    expect(shell).toContain('Chapter 1')
    expect(shell).toContain('Chapter 3')
  })

  it('marks an RTL book with dir="rtl" and reverses only the sidebar', async () => {
    const rtl = sampleEpub({ 'OEBPS/content.opf': sampleOpf({ progression: 'rtl' }) })
    const { site } = await buildSite(rtl)
    const shell = (await readTree(site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''

    expect(shell).toContain('<html lang="en" dir="rtl">')
    // presentationOrder reverses the list; model.chapters does not.
    expect(shell.indexOf('OEBPS/nav.xhtml')).toBeLessThan(shell.indexOf('OEBPS/text/ch01.xhtml'))
  })

  it('emits canonical only for an absolute --base-url (§9, §7.5)', async () => {
    const absolute = await buildSite(sampleEpub(), { baseUrl: { form: 'absolute', href: 'https://example.com/books/' } })
    const withCanonical =
      (await readTree(absolute.site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(withCanonical).toContain('<link rel="canonical" href="https://example.com/books/epubsite.html">')

    const pathForm = await buildSite(sampleEpub())
    const without =
      (await readTree(pathForm.site.out)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(without).not.toContain('rel="canonical"')
  })
})

describe('build — ordering discipline (C.5)', () => {
  it('produces the same paths and the same shell on two runs, without asserting byte equality', async () => {
    // v1.2 dropped byte-identity as a promise (§9.2, C.5). What is still
    // promised is that iteration and serialization are order-stable, so a diff
    // between two builds is worth reading.
    const first = await buildSite()
    const second = await buildSite()

    const paths = async (dir: string): Promise<string[]> => [...(await readTree(dir)).keys()].sort()
    expect(await paths(second.site.out)).toEqual(await paths(first.site.out))

    const shellOf = async (dir: string): Promise<string> =>
      (await readTree(dir)).get('epubsite.html')?.content.toString('utf8') ?? ''
    expect(await shellOf(second.site.out)).toBe(await shellOf(first.site.out))
  })
})
