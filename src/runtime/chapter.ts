/**
 * Per-chapter synchronisation (spec §5.4.2, §5.7).
 *
 * Four pieces of state change together whenever the reader moves to another
 * chapter — styles, body attributes, the sidebar highlight, and the document
 * title — and they are keyed by the same thing, so they are done in one call.
 * Splitting them into separate listeners is how they drift: one fires on
 * `afterSwap`, another on `afterSettle`, and the page spends a frame or two in a
 * state nobody designed.
 *
 * `syncBodyAttrs` exists because of a detail that is easy to miss: htmx swaps the
 * chapter's **body content**, not its `<body>` element, so `class`, `dir` and
 * `lang` are silently lost. A book that sets `class="calibre"` or `dir="rtl"` on
 * its body would lose it on the second chapter and keep it on the first — the
 * kind of bug that looks like a stylesheet problem for a long time.
 */
import { clearStyles, syncJsonLd, syncStyles } from './head-slots'
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
    // chapter's fonts were last applied.
    clearStyles()
    syncJsonLd(undefined)
    document.body.className = ''
    document.body.dir = context.shellDir
    document.documentElement.lang = context.shellLang
    return
  }

  syncStyles(chapter, context.root)
  syncJsonLd(chapter.jsonld)
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
