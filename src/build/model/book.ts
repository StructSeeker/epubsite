/**
 * The normalised book model: the single place that decides reading order,
 * chapter positions, and presentation order (spec §4.2, §7.5, §12).
 *
 * Two facts drive this module:
 *
 *   - the spine is the *only* source of reading order (§4.2); and
 *   - a chapter's JSON-LD `position` is its 1-based spine index (§7.5).
 *
 * Both are easy to break by accident. An earlier draft of the parser took the
 * page-progression-direction as a parameter and reversed the spine for RTL
 * books, which would have silently inverted `readingOrder` and every `position` —
 * a bug that type-checks, produces a plausible-looking site, and is only visible
 * to a screen reader or a search engine.
 *
 * Correcting that by construction means three things:
 *
 *   1. the parser returns the spine in document order and nothing else;
 *   2. `position` is derived here, once, from the array index;
 *   3. presentation order (§12's "reverse the sidebar and prev/next for RTL") is
 *      a *differently named* function, so a caller has to state which order it
 *      wants and cannot receive the wrong one by accident.
 */
import { toUrlPath, type EntryPath } from '../../shared/paths'
import { selectIdentifier, type Contributor, type Identifier, type OpfPackage } from '../epub/opf'
import { EMPTY_NAV, navIndex, type NavNode, type NavTree } from '../epub/nav'

export type ReadingProgression = 'ltr' | 'rtl'

export interface Chapter {
  /** 0-based spine index. The only index anyone should ever do arithmetic on. */
  readonly index: number
  /** 1-based reading position: exactly `index + 1`, computed in one place. */
  readonly position: number
  readonly entryPath: EntryPath
  readonly idref: string
  /** Media type of the document actually used, for the manifest's `encodingFormat`. */
  readonly mediaType: string
  /** Spine `linear` flag; non-linear items stay in the reading order (§4.2). */
  readonly linear: boolean
  /**
   * Label from the navigation document (§4.3), when the book has one.
   *
   * Left exactly as the book wrote it. `label` below is the resolved display
   * string; this field exists so that code can tell "the book named this" from
   * "we fell back", which matters when deciding whether to report a finding.
   */
  readonly navLabel: string | undefined
  /**
   * The resolved display label: §12's whole chain, computed once.
   *
   * Every consumer reads this — the sidebar, `shell-data.json`, the browser tab
   * — so they cannot disagree by each running a slightly different fallback.
   */
  readonly label: string
  /**
   * The label of the parent entry in the navigation tree, for `articleSection`
   * (§7.5). `undefined` at the top level, which is why `articleSection` is
   * omitted rather than emitted empty.
   */
  readonly section: string | undefined
}

export interface BookModel {
  readonly opf: OpfPackage
  readonly identifier: Identifier | undefined
  /** Main title: `title-type=main` when declared, otherwise the first title. */
  readonly title: string
  readonly authors: readonly Contributor[]
  readonly translators: readonly Contributor[]
  readonly publisher: string | undefined
  readonly progression: ReadingProgression
  /**
   * Chapters in reading order. Presented as a `readonly` array so nothing
   * downstream can reorder the reading order in place.
   */
  readonly chapters: readonly Chapter[]
  /** The book's own table of contents, already normalised (§4.3). */
  readonly nav: NavTree
}

export function buildBookModel(opf: OpfPackage, nav: NavTree = EMPTY_NAV): BookModel {
  return {
    opf,
    identifier: selectIdentifier(opf),
    title: selectTitle(opf),
    authors: opf.metadata.creators.filter((person) => person.roles.includes('author')),
    translators: [
      ...opf.metadata.creators.filter((person) => person.roles.includes('translator')),
      ...opf.metadata.contributors.filter((person) => person.roles.includes('translator')),
    ],
    publisher: opf.metadata.publisher,
    progression: opf.pageProgressionDirection,
    chapters: toChapters(opf, nav),
    nav,
  }
}

/** Derives positions from spine order. The only place `position` is computed. */
function toChapters(opf: OpfPackage, nav: NavTree): Chapter[] {
  const labels = navIndex(nav)
  return opf.spine.map((item, index) => {
    const fromNav = labels.get(item.entryPath)
    const navLabel = fromNav?.label === '' ? undefined : fromNav?.label
    return {
      index,
      position: index + 1,
      entryPath: item.entryPath,
      idref: item.idref,
      mediaType: item.mediaType,
      linear: item.linear,
      navLabel,
      label: navLabel ?? `Chapter ${index + 1}`,
      section: fromNav?.section,
    }
  })
}

/**
 * Refines chapter labels with what each chapter's own head says (§12).
 *
 * §12's chain is navigation label → `<title>` → first `<h1>` → position. The
 * last step is already in place when this runs, so this only ever *raises* the
 * quality of a label: a chapter the book's own table of contents does not
 * mention gets the name it gives itself rather than "Chapter 7".
 *
 * Returns a new model rather than mutating: `Chapter` fields are readonly, and
 * a label that can change under a reader is exactly the kind of state the
 * model exists to prevent.
 */
export function withChapterHeads(
  model: BookModel,
  heads: ReadonlyMap<string, { title: string | null; h1: string | null }>,
): BookModel {
  return {
    ...model,
    chapters: model.chapters.map((chapter) => {
      if (chapter.navLabel !== undefined) return chapter
      const head = heads.get(chapter.entryPath)
      const label = head?.title ?? head?.h1 ?? chapter.label
      return label === chapter.label ? chapter : { ...chapter, label }
    }),
  }
}

/**
 * The order to *display* chapters in.
 *
 * RTL books read right to left, so §12 asks for the sidebar and prev/next
 * controls to be reversed. That is a presentation concern and must never be
 * applied to `BookModel.chapters`, which is the reading order that
 * `readingOrder` and `position` are derived from.
 */
export function presentationOrder(
  chapters: readonly Chapter[],
  progression: ReadingProgression,
): readonly Chapter[] {
  return progression === 'rtl' ? [...chapters].reverse() : chapters
}

/** Looks a chapter up by its entry path, for sidebar highlighting and routing. */
export function chapterFor(model: BookModel, entryPath: EntryPath): Chapter | undefined {
  return model.chapters.find((chapter) => chapter.entryPath === entryPath)
}

/**
 * Best available display label.
 *
 * §12's chain — navigation label → chapter `<title>` → first `<h1>` → position —
 * is resolved once, in the model, so the sidebar, `shell-data.json` and the
 * browser tab cannot each pick a different answer.
 */
export function displayTitle(chapter: Chapter): string {
  return chapter.label
}

/**
 * The table of contents to render.
 *
 * §12: a book with no navigation document still needs one, and the spine
 * already *is* one — it is the reading order, it is complete, and every entry
 * has a label through `displayTitle`. Falling back to it means the sidebar is
 * never empty, which is the difference between a degraded reader and a broken
 * one.
 */
export function tableOfContents(model: BookModel): readonly NavNode[] {
  if (model.nav.toc.length > 0) return model.nav.toc

  return model.chapters.map((chapter) => ({
    label: displayTitle(chapter),
    entryPath: chapter.entryPath,
    fragment: '',
    external: false,
    href: toUrlPath(chapter.entryPath),
    children: [],
  }))
}

/** `title-type=main` wins; otherwise the first `dc:title` in document order. */
function selectTitle(opf: OpfPackage): string {
  const { titles } = opf.metadata
  const main = titles.find((title) => title.type === 'main')
  return main?.value ?? titles[0]?.value ?? 'Untitled'
}
