/**
 * The toolbar's previous/next controls (spec §5.7, §7.5).
 *
 * Two halves in one file, because they are two halves of one decision:
 *
 *   - `syncPager` owns the **state** — which chapter each control points at, and
 *     whether it points anywhere at all. It runs from `syncChapter`, which is the
 *     one place that knows where the reader is.
 *   - `wirePager` owns the **behaviour** — what a click does.
 *
 * ### Why the click is not htmx's boost
 *
 * Every other link in the shell is boosted and lets htmx do the work. These two
 * cannot be, and the reason is worth writing down because the alternative looks
 * fine and fails silently: `boostElement` reads the anchor's `href` **once**, when
 * htmx processes the node, and the click handler closes over that string (vendor
 * `boostElement`: `path = getRawAttribute(elt, 'href')`). A boosted pager would
 * therefore keep requesting whichever chapter it was first processed for — and
 * because `wireNavigation` cancels a request whose path is the current one, the
 * reader would see a click that does *nothing at all*, with no error anywhere.
 *
 * Spec §5.12 is the full record of that failure, of each part of the fix below,
 * and of the rule it generalises to.
 *
 * So the anchors carry `hx-boost="false"` and this module issues the swap through
 * `htmx.ajax` — the same public API the entry protocol uses (§8.2), with the same
 * target and swap spec the `body`'s boost attributes would have supplied.
 *
 * The `href` stays real and current regardless: middle-click, "open in a new tab",
 * copying the link and the no-JavaScript case all depend on it, and when htmx
 * never arrives the click is an ordinary navigation rather than a dead control.
 */
import { neighbours } from './reading-order'
import { toUrlPath, type EntryPath } from '../shared/paths'
import type { ShellData } from './data'
import type { Htmx } from './htmx'

/** The pager's controls, by id, in the order `shell-data.json` drives them. */
const PAGER_IDS = ['prev', 'next'] as const

/**
 * Points each control at its neighbour, or takes the target away.
 *
 * An unavailable control **loses its `href`** rather than gaining a handler: a
 * link with nowhere to go is not a link, so there is nothing to activate and
 * nothing for a middle-click to open. The ARIA trio keeps it announced as a link
 * that is unavailable, instead of as an unnamed box, and it keeps its tab stop on
 * purpose — a control that silently leaves the tab order is one a keyboard reader
 * cannot discover exists, and "there is nothing after this chapter" is worth
 * hearing once.
 */
export function syncPager(data: ShellData, key: string | null, root: URL): void {
  const { prev, next } = neighbours(data.readingOrder, key)
  setTarget('prev', prev, root)
  setTarget('next', next, root)
}

function setTarget(id: (typeof PAGER_IDS)[number], target: EntryPath | null, root: URL): void {
  // Absent under `--no-spa`, and in a shell built before this control existed.
  const control = document.getElementById(id)
  if (control === null) return

  if (target === null) {
    control.removeAttribute('href')
    control.setAttribute('role', 'link')
    control.setAttribute('aria-disabled', 'true')
    control.setAttribute('tabindex', '0')
    return
  }

  // Absolute, because after a `pushState` a relative href resolves against the
  // chapter's directory — the trap §5.3 exists for. Percent-encoded for the same
  // reason the build encodes: an entry path is a file name, not a URL (§7.5).
  control.setAttribute('href', new URL(toUrlPath(target), root).href)
  control.removeAttribute('role')
  control.removeAttribute('aria-disabled')
  control.removeAttribute('tabindex')
}

/**
 * Takes over clicks on both controls.
 *
 * Called only when htmx is available: without it the anchors are ordinary links
 * and a click loads the chapter as a page, which is the same degradation the
 * sidebar has.
 */
export function wirePager(htmx: Htmx): void {
  for (const id of PAGER_IDS) {
    const control = document.getElementById(id)
    if (control === null) continue
    control.addEventListener('click', (event) => {
      // A modified click is the reader asking their browser for a new tab or
      // window, and the `href` is exactly what makes that work — so it must reach
      // the browser untouched.
      if (!isPlainLeftClick(event)) return
      const href = control.getAttribute('href')
      // Unavailable, so there is nowhere to go and nothing to prevent: the
      // browser's own behaviour for an anchor without `href` is already right.
      if (href === null) return
      event.preventDefault()
      void navigate(htmx, href, control)
    })
  }
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  )
}

async function navigate(htmx: Htmx, href: string, source: Element): Promise<void> {
  try {
    await htmx.ajax('GET', href, {
      target: '#epub-content',
      swap: 'innerHTML show:top',
      // The URL to push, not a flag: htmx hands the string straight to
      // `history.pushState` (`Htmx.ajax` documents what passing `true` used to do).
      // Without it the address bar would stay on the chapter the reader is leaving,
      // because we are not a boosted element and htmx has nothing else to push.
      push: href,
      // The request's source, so the attributes this anchor *inherits* are found:
      // `hx-indicator` lives on `<body>`, and without a source there would be no
      // "Loading…" for a slow chapter — the one feedback a click needs.
      source,
    })
  } catch (error) {
    // A failed navigation leaves the reader where they were, with the copy they
    // already had. Say so rather than swapping in nothing.
    console.error('[epubsite] the next chapter did not load.', error)
  }
}
