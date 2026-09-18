/**
 * Per-chapter synchronisation (spec §5.4.2, §5.7).
 *
 * Five pieces of state change together whenever the reader moves to another
 * chapter — styles, the landing page's canonical link, body attributes, the
 * sidebar highlight, and the document title — and they are keyed by the same
 * thing, so they are done in one call. Splitting them into separate listeners is
 * how they drift: one fires on `afterSwap`, another on `afterSettle`, and the
 * page spends a frame or two in a state nobody designed.
 *
 * `syncBodyAttrs` exists because of a detail that is easy to miss: htmx swaps the
 * chapter's **body content**, not its `<body>` element, so `class`, `dir` and
 * `lang` are silently lost. A book that sets `class="calibre"` or `dir="rtl"` on
 * its body would lose it on the second chapter and keep it on the first — the
 * kind of bug that looks like a stylesheet problem for a long time.
 */
import { clearStyles, syncCanonical, syncJsonLd, syncStyles } from './head-slots'
import { withChapterUrls } from './chapter-urls'
import { revealCurrent } from './toc'
import type { ChapterData, ShellData } from './data'

export interface ChapterSyncContext {
  data: ShellData
  root: URL
  /** `dir` on the shell's own `<body>`, restored for chapters that do not say. */
  shellDir: string
  /** `lang` on the shell's `<html>`, restored for chapters that do not say. */
  shellLang: string
}

let highlighted: HTMLElement | null = null

export function syncChapter(context: ChapterSyncContext, key: string | null): void {
  highlight(key)

  const chapter = key === null ? undefined : context.data.byKey[key]
  if (chapter === undefined) {
    // The shell itself, or a path the book does not own: the landing page. The
    // book's styles must go, or the landing page would render in whichever
    // chapter's fonts were last applied — and the canonical comes back, because
    // this document is the landing page again (§5.4).
    clearStyles()
    syncJsonLd(undefined)
    syncCanonical(true)
    document.body.className = ''
    document.body.dir = context.shellDir
    document.documentElement.lang = context.shellLang
    return
  }

  // The document is a chapter now, so the landing page's canonical is a claim
  // about the wrong document. Nothing replaces it: a chapter is deliberately
  // given no canonical at all, in either of its addresses (§7.5, §8.5).
  syncCanonical(false)
  syncStyles(chapter, context.root)
  // The chapter node is decorated with the addresses the reader actually arrived
  // at (§7.3). It happens here rather than in `syncJsonLd`, which stays a DOM-slot
  // module that knows nothing about URLs, and here rather than at build time,
  // because where the site is being *served* is only knowable at runtime.
  syncJsonLd(
    chapter.jsonld === undefined
      ? undefined
      : withChapterUrls(chapter.jsonld, new URL(location.href)),
  )
  syncBodyAttrs(context, chapter)
  document.title = chapter.title
}

/**
 * Marks the current chapter in the sidebar (§5.7).
 *
 * Deliberately not driven by hrefs: `data-key` is the entry path, an exact key
 * comparison, and it keeps working for chapters whose names need percent-encoding
 * — where rebuilding URLs from attributes on every navigation is a small pile of
 * edge cases waiting to disagree with the build.
 */
function highlight(key: string | null): void {
  highlighted?.removeAttribute('aria-current')
  highlighted = null
  if (key === null) return

  for (const link of document.querySelectorAll<HTMLElement>('#toc [data-key]')) {
    if (link.dataset.key !== key) continue
    link.setAttribute('aria-current', 'page')
    highlighted = link
    // A chapter inside a collapsed branch would be marked and invisible, so the
    // sidebar would lose the one thing it is for. See `revealCurrent`.
    revealCurrent(link)
    return
  }
}

function syncBodyAttrs(context: ChapterSyncContext, chapter: ChapterData): void {
  document.body.className = chapter.bodyClass
  // A chapter that does not declare a direction inherits the book's, not the
  // previous chapter's: `dir` is inherited state, and leaving it set would flip
  // an LTR chapter that follows an RTL one.
  document.body.dir = chapter.dir ?? context.shellDir
  document.documentElement.lang = chapter.lang ?? context.shellLang
}
