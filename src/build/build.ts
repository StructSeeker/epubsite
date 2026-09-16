/**
 * The build pipeline (spec §4.1, §C.3.1).
 *
 * One function, `build`, that turns an EPUB into a directory. Everything it does
 * is a step of §4.1's diagram, in that order, and the order is load-bearing:
 *
 *   - Validation runs over the **whole** container before the first byte is
 *     written. A build that fails must not leave half a site behind, and asking
 *     for `--clean` and then failing halfway is exactly the state a user cannot
 *     recover from by hand.
 *   - The reserved-namespace check (§3.2) runs before extraction, so a colliding
 *     book fails with exit 4 instead of quietly overwriting the shell's own
 *     files.
 *   - The zero-rewrite assertion (§13.1) runs after extraction, on the evidence
 *     of what was actually written, not on the intention of what should be.
 *
 * The library never calls `process.exit`: it throws typed errors carrying an
 * `exitCode`, and the CLI maps them (§9.3, C.3.1).
 */
import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { ENCRYPTION_PATH, openEpub, type EpubArchive } from './epub/zip'
import { CONTAINER_PATH, parseContainer } from './epub/container'
import { parseOpf } from './epub/opf'
import { decodeXml, parseXml } from './epub/xml'
import { buildBookModel, withChapterHeads } from './model/book'
import { EMPTY_NAV, parseNavigation, parseNcx, type NavTree } from './epub/nav'
import { parseChapterHead, type ChapterHead } from './epub/head'
import { auditDocument } from './audit'
import { buildShellData, serializeShellData } from './model/shell-data'
import { buildStructuredData } from './model/structured-data'
import { extractVerbatim, verifyZeroRewrite } from './epub/extract'
import { checkEntryPaths } from './host-safety'
import { assertHostingImplemented } from './hosting/rewrite'
import { buildSearchIndex } from './search/pagefind'
import { createFileSink, prepareOutputDir } from './output'
import { renderShell } from './render/shell'
import { renderTransitPage } from './render/transit'
import { renderGuide404 } from './render/guide-404'
import { render } from './render/escape'
import { emptyDiagnostics, warn, type Diagnostics } from './diagnostics'
import { runtimeAsset, vendorAsset } from './assets/paths'
import { stableStringify } from './determinism'
import { EncryptedContentError, InvalidEpubError } from './errors'
import { resolveOptions, type BuildOptions } from './options'
import { RESERVED_PATHS, SHELL_ASSETS, collidesWithReserved, toEntryPath, type EntryPath } from '../shared/paths'

export interface BuildStats {
  /** Chapters in the spine — the reading order (§4.2). */
  chapters: number
  /** Container entries that are not chapters: images, styles, fonts, the OPF. */
  resources: number
  /** Everything written, in bytes. */
  bytes: number
}

export interface BuildResult {
  /** Absolute path of the site, so callers never have to guess the cwd. */
  outDir: string
  diagnostics: Diagnostics
  stats: BuildStats
}

/**
 * Builds a site from `epubPath`.
 *
 * @param epubPath Path to the source EPUB, resolved against the caller's cwd.
 * @param options  Partial options; anything omitted takes its §9 default.
 * @throws {EpubSiteError} every failure carries a stable `code` and the
 *   `exitCode` the CLI should exit with.
 */
export async function build(
  epubPath: string,
  options: Partial<BuildOptions> = {},
): Promise<BuildResult> {
  const resolved = resolveOptions(options)
  const outDir = resolvePath(process.cwd(), resolved.out)

  // Decide what we cannot do before doing anything else. `--hosting rewrite` is
  // the documented gap (§8.4, C.6.1) and fails with exit 2 and a message naming
  // the reason, rather than producing a site that looks right and is not.
  assertHostingImplemented(resolved.hosting)

  const diagnostics = emptyDiagnostics()
  const archive = await openEpub(epubPath)

  try {
    return await runBuild(archive, epubPath, resolved, outDir, diagnostics)
  } finally {
    await archive.close()
  }
}

async function runBuild(
  archive: EpubArchive,
  epubPath: string,
  options: BuildOptions,
  outDir: string,
  diagnostics: Diagnostics,
): Promise<BuildResult> {
  if (archive.has(ENCRYPTION_PATH)) {
    throw new EncryptedContentError(
      'the book contains META-INF/encryption.xml, so its content is encrypted ' +
        '(§4.2, §12). A site built from it would be a site nobody can read.',
      { where: epubPath },
    )
  }

  for (const message of archive.warnings) {
    warn(diagnostics, 'W_CONTAINER', message, epubPath)
  }

  const container = parseContainer(
    parseXml(decodeXml(await archive.read(CONTAINER_PATH))),
    CONTAINER_PATH,
  )
  const opfPath = container.opfPath
  if (!archive.has(opfPath)) {
    throw new InvalidEpubError(
      `container.xml points at a package document that is not in the container: ${opfPath}`,
      { where: opfPath },
    )
  }

  const opf = parseOpf(parseXml(decodeXml(await archive.read(opfPath))), opfPath)
  const nav = await readNavigation(archive, opfPath, opf.navPath, opf.ncxPath, opf.spine, diagnostics)

  // Heads are parsed before the model is finalised, because they are the second
  // step of §12's label chain and the source of every chapter's styles.
  const heads = await readChapterHeads(archive, opf.spine.map((item) => item.entryPath), diagnostics)
  const model = withChapterHeads(buildBookModel(opf, nav), heads)

  // One pass over the model produces the shell's static book JSON-LD, every
  // chapter node, and the publication manifest (C.7). Nothing downstream builds
  // a field map of its own.
  const structured = buildStructuredData({
    model,
    baseUrl: options.baseUrl,
    shellName: options.name,
    jsonLd: options.jsonLd,
    diagnostics,
  })

  for (const other of container.otherRootfiles) {
    warn(
      diagnostics,
      'W_EXTRA_ROOTFILE',
      `the container declares more than one package document; using ${opfPath}`,
      other,
    )
  }

  // §12: a fixed pixel viewport cannot coexist with a responsive shell, so the
  // SPA layer is dropped automatically. The user is told rather than asked: the
  // combination is not merely inadvisable, it does not render, and quietly
  // producing a broken reader would be worse than producing a plain site.
  const fixedLayout = opf.layout === 'pre-paginated'
  const spa = options.spa && !fixedLayout
  if (fixedLayout && options.spa) {
    warn(
      diagnostics,
      'W_PRE_PAGINATED',
      'the book declares rendition:layout=pre-paginated, so the htmx layer is ' +
        'disabled and a plain multi-page site is built instead. A fixed pixel ' +
        'viewport and a responsive shell cannot coexist (§12).',
      opfPath,
    )
  }

  const entryPaths = archive.entries.map((entry) => entry.entryPath)

  // §3.2. The shell's own name is the one reserved path that `--name` moves, so
  // it is passed in rather than assumed — otherwise `--name custom.html` would
  // both miss the real collision and report a bogus one.
  const collisions = entryPaths.filter((entryPath) => collidesWithReserved(entryPath, options.name))
  const report = checkEntryPaths(entryPaths, collisions)
  for (const issue of report.warnings) {
    warn(diagnostics, 'W_ENTRY_PATH', issue.message, issue.entryPath)
  }

  // The book's own `index.html` wins; the transit page is then simply not
  // generated (§3.2, §8.2).
  const hasTransit = !archive.has(toEntryPath(RESERVED_PATHS.transit))

  // Every file this build writes itself, listed in one place. `verifyZeroRewrite`
  // excludes exactly these and nothing else, so the check cannot drift away from
  // reality by someone adding a generated file and forgetting to declare it —
  // declaration *is* the mechanism.
  const generated: Array<{ entryPath: EntryPath; content: string | Buffer }> = [
    {
      entryPath: toEntryPath(options.name),
      content: render(
        renderShell({
          model,
          shellName: options.name,
          baseUrl: options.baseUrl,
          spa,
          theme: options.theme,
          notices: fixedLayout ? [FIXED_LAYOUT_NOTICE] : [],
          search: options.search,
          bookJsonLd: structured.book,
        }),
      ),
    },
    {
      entryPath: toEntryPath(`${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellCss}`),
      content: await readFile(runtimeAsset(SHELL_ASSETS.shellCss)),
    },
    // The favicon is shell chrome, not runtime: it is referenced from the shell's
    // `<head>` and has to be there under `--no-spa` too, where nothing else in
    // this directory except the stylesheet is shipped.
    {
      entryPath: toEntryPath(`${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.iconSvg}`),
      content: await readFile(runtimeAsset(SHELL_ASSETS.iconSvg)),
    },
    // The manifest is emitted in both modes and under every `--json-ld` setting:
    // that flag governs `<script>` blocks, not the manifest's descriptive
    // properties (A.1).
    {
      entryPath: toEntryPath(RESERVED_PATHS.manifest),
      content: `${stableStringify(structured.publication)}\n`,
    },
    // The guide is emitted in both modes. `--no-spa` sites have no share button
    // to create token links, but a token link shared from an earlier SPA build
    // should still land somewhere sensible rather than on a bare 404.
    {
      entryPath: toEntryPath(RESERVED_PATHS.guide),
      content: render(
        renderGuide404({
          shellName: options.name,
          tokenScript: await readFile(runtimeAsset(TOKEN_IIFE_ASSET), 'utf8'),
        }),
      ),
    },
    // The root marker §8.3's probe looks for. It exists so the guide can find
    // the site root at any deployment path without knowing one; see the note on
    // its contents below.
    { entryPath: toEntryPath(RESERVED_PATHS.rootMarker), content: ROOT_MARKER_CONTENT },
  ]
  if (spa) {
    // The runtime module, its data and the library it drives are only shipped
    // when there is a runtime: `--no-spa` produces a site with no JavaScript at
    // all, and copying it in would be a lie about what the site does.
    generated.push(
      {
        entryPath: toEntryPath(`${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellJs}`),
        content: await readFile(runtimeAsset(SHELL_ASSETS.shellJs)),
      },
      {
        entryPath: toEntryPath(`${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.htmx}`),
        content: await readFile(vendorAsset(SHELL_ASSETS.htmx)),
      },
      {
        entryPath: toEntryPath(`${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellData}`),
        content: serializeShellData(
          buildShellData({
            model,
            heads,
            baseUrl: options.baseUrl,
            shellName: options.name,
            structured,
          }),
        ),
      },
    )
  }
  if (hasTransit) {
    generated.push({
      entryPath: toEntryPath(RESERVED_PATHS.transit),
      content: render(renderTransitPage(options.name)),
    })
  }

  const chapterPaths = new Set<string>(model.chapters.map((chapter) => chapter.entryPath))
  const sourceSizes = new Map<string, number>(
    archive.entries.map((entry) => [entry.entryPath, entry.uncompressedSize]),
  )

  if (options.dryRun) {
    // `--dry-run` still parses and validates everything — a dry run that skips
    // the failures is a dry run that tells you nothing you could not have
    // guessed. Only the writes are skipped.
    let planned = 0
    for (const size of sourceSizes.values()) planned += size
    for (const file of generated) planned += byteLength(file.content)

    return {
      outDir,
      diagnostics,
      stats: {
        chapters: model.chapters.length,
        resources: entryPaths.filter((entryPath) => !chapterPaths.has(entryPath)).length,
        bytes: planned,
      },
    }
  }

  await prepareOutputDir(outDir, { clean: options.clean, force: options.force })
  const sink = createFileSink(outDir)

  const extraction = await extractVerbatim(archive, sink)
  verifyZeroRewrite({
    source: archive.entries,
    written: extraction.files,
    generated: new Set(generated.map((file) => file.entryPath)),
  })

  let generatedBytes = 0
  for (const file of generated) {
    generatedBytes += await sink.write(file.entryPath, file.content)
  }

  // Search runs **last** (D.3): it indexes what the build produced, so anything
  // written afterwards would be invisible to it. Its failures are warnings, so
  // they are collected rather than thrown, and they cannot leave a half-written
  // site behind — everything else is already on disk and correct.
  if (options.search) {
    const outcome = await buildSearchIndex(
      {
        siteDir: outDir,
        explicitPath: options.pagefind,
        chapterPaths: model.chapters.map((chapter) => chapter.entryPath),
        cwd: process.cwd(),
      },
      diagnostics,
    )
    if (!outcome.indexed) generatedBytes += 0
  }

  return {
    outDir,
    diagnostics,
    stats: {
      chapters: model.chapters.length,
      resources: extraction.files.filter((file) => !chapterPaths.has(file.entryPath)).length,
      bytes: extraction.bytes + generatedBytes,
    },
  }
}

function byteLength(content: string | Buffer): number {
  return typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength
}

/**
 * How many chapters are parsed at once.
 *
 * Bounded rather than unlimited because a thousand-chapter book would otherwise
 * open a thousand read streams on one ZIP handle. It is also, per C.5, allowed
 * to be concurrent at all *only* because the results are stored by key and the
 * output order comes from the spine — completion order never reaches the
 * artifact.
 */
const HEAD_PARSE_CONCURRENCY = 8

/** The compiled IIFE form of `src/shared/token.ts` (§C.4.2). */
const TOKEN_IIFE_ASSET = 'token-iife.js'

/**
 * What goes in `.epubsite-root`.
 *
 * A comment rather than an empty file, because this file is served publicly and
 * someone will eventually find it in a directory listing or a crawler report.
 * Its *existence* is the entire mechanism (§8.3 constraint 2); its contents are
 * for the person who goes looking.
 */
const ROOT_MARKER_CONTENT =
  'This file marks the site root built by epubsite.\n' +
  'It exists so the 404 guide can find the reader at any deployment path.\n'

/**
 * Shown on the landing page of a fixed-layout book (§12).
 *
 * The spec asks for the degradation to be explained, not just performed. A
 * reader who expected a reader and got a plain site deserves to know that this
 * is the book's shape rather than a failure.
 */
const FIXED_LAYOUT_NOTICE =
  'This book declares a fixed page layout. Fixed layouts and a responsive ' +
  'reading view cannot work together, so this site is a plain multi-page ' +
  'one: every chapter opens on its own, with no script.'

/**
 * Parses every chapter's head (spec §4.4).
 *
 * Failures are warnings, not errors. A chapter we cannot read the head of is a
 * chapter without its styles — noticeably worse, but readable — and failing the
 * whole build over it would trade a cosmetic defect for a total one.
 */
async function readChapterHeads(
  archive: EpubArchive,
  chapterPaths: readonly EntryPath[],
  diagnostics: Diagnostics,
): Promise<Map<string, ChapterHead>> {
  const heads = new Map<string, ChapterHead>()
  // A path can appear twice in the spine; parsing it once is both faster and
  // avoids reporting the same finding twice.
  const queue: EntryPath[] = [...new Set(chapterPaths)]
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      const path = queue[index]
      if (path === undefined) return

      try {
        const doc = parseXml(decodeXml(await archive.read(path)))
        heads.set(path, parseChapterHead(doc, path))

        // The same parse feeds the reference audit (§12): reading every chapter
        // once is the only way to keep the cost of a thousand-chapter book
        // linear.
        const audit = auditDocument(doc, path)
        for (const url of audit.externalRefs) diagnostics.externalResources.push(url)
        for (const link of audit.outOfTreeRefs) diagnostics.outOfTreeLinks.push(link)
      } catch (cause) {
        warn(
          diagnostics,
          'W_HEAD_UNREADABLE',
          `could not read this chapter's head, so its styles will be missing: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          path,
        )
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(HEAD_PARSE_CONCURRENCY, queue.length) }, () => worker()),
  )

  // The worker pool appends in completion order, which for a report meant to be
  // read is not an order at all. C.5's discipline applies to diagnostics too.
  diagnostics.externalResources = [...new Set(diagnostics.externalResources)].sort()
  diagnostics.outOfTreeLinks = [...new Set(diagnostics.outOfTreeLinks)].sort()

  return heads
}

/**
 * Reads the book's table of contents, whichever format it ships (§4.3).
 *
 * EPUB 3's nav document is preferred when both are present — it is the one the
 * format designates as authoritative, and the NCX in such a book is a legacy
 * compatibility copy that can be stale.
 *
 * Every failure here is a warning, never an error. A missing or unreadable
 * navigation document is a degraded reader, not a broken book: §12's fallback is
 * the spine, which is already the reading order, so the sidebar still works. The
 * one thing that would be wrong is failing a build over an optional file.
 */
async function readNavigation(
  archive: EpubArchive,
  opfPath: EntryPath,
  navPath: EntryPath | undefined,
  ncxPath: EntryPath | undefined,
  spine: readonly { entryPath: EntryPath }[],
  diagnostics: Diagnostics,
): Promise<NavTree> {
  const spinePaths = new Set<string>(spine.map((item) => item.entryPath))

  for (const [path, parse] of [
    [navPath, parseNavigation],
    [ncxPath, parseNcx],
  ] as const) {
    if (path === undefined) continue
    if (!archive.has(path)) {
      warn(
        diagnostics,
        'W_NAV_MISSING',
        'the manifest declares a navigation document that is not in the container; ' +
          'falling back to the spine',
        path,
      )
      continue
    }
    return parse(parseXml(decodeXml(await archive.read(path))), path, spinePaths)
  }

  if (navPath === undefined && ncxPath === undefined) {
    warn(
      diagnostics,
      'W_NAV_ABSENT',
      'the book has no navigation document; the spine is being used as the table of ' +
        'contents (§12)',
      opfPath,
    )
  }

  return EMPTY_NAV
}
