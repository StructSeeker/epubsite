/**
 * The shell runtime (spec §5.4.1, §5.7).
 *
 * The order of the statements below is correctness, not style. §5.4.1 spells it
 * out, and the reason each step precedes the next is that everything downstream
 * resolves URLs against whatever the document base is *at the moment it runs*:
 *
 *   1. freeze `SITE_ROOT`                — before anything can move the base
 *   2. absolutise the shell's own links  — before a navigation re-bases them
 *   3. entry decision + `replaceState`   — before any content is parsed
 *   4. load htmx and lock its config     — before any boosted request exists
 *   5. fetch `shell-data.json`           — by absolute URL, never relatively
 *   6. wire the runtime, then fetch the chapter if the entry named one
 */
import { absolutizeShell } from './absolutize'
import { keyFromLocation } from './location-key'
import { loadHtmx } from './htmx'
import { freezeSiteRoot } from './site-root'
import { wireDrawer } from './drawer'
import { loadShellData } from './data'
import { syncChapter, type ChapterSyncContext } from './chapter'
import { entryRequestUrl, entryUrl, resolveEntry } from './entry'
import { wireShare } from './share'
import { wireSearch } from './search'

// 1. Frozen once, at module evaluation, before any navigation can re-base it.
const SITE_ROOT = freezeSiteRoot()

// 2. The sidebar, the skip link and the toolbar are shell chrome: they must not
//    be resolved against a chapter's directory after a pushState.
absolutizeShell(SITE_ROOT)

// Independent of htmx and of the network, so it is wired first: a narrow-screen
// reader should be able to open the table of contents even if the htmx module
// never arrives.
wireDrawer()

void start()

/**
 * Set while the entry protocol's own request is in flight (§8.2).
 *
 * The same-chapter short-circuit in `wireNavigation` compares the request path
 * with the current one, and by the time the entry request is issued the
 * replacement of the URL has already made those equal. Without this flag the
 * reader would replace the address bar with a chapter and then cancel the
 * request that would have loaded it.
 */
let entryInFlight = false

/**
 * Set while htmx is restoring a history entry, i.e. the reader pressed Back.
 *
 * Going back is not opening a chapter: the reader is returning to somewhere they
 * already were, so the pane must not be forced back to the top. The flag is set
 * by `htmx:historyRestore` and consumed by the next `htmx:afterSettle`, which is
 * the only place it is read — and if a restore never settles, the module was
 * reloaded and the flag starts false again anyway.
 */
let restoringHistory = false

async function start(): Promise<void> {
  // 3. The entry decision and the state replacement, before any content is
  //    parsed. From here on the document base is the chapter's directory, which
  //    is exactly what the chapter's relative URLs need.
  const entry = resolveEntry(SITE_ROOT)
  const destination = entry === null ? null : entryUrl(SITE_ROOT, entry)
  if (destination !== null) history.replaceState(null, '', destination.href)

  // 4. Both config assignments happen inside `loadHtmx`, in the same synchronous
  //    resume as the module arriving — there must be no microtask boundary
  //    between them and a boosted request.
  let htmx: Awaited<ReturnType<typeof loadHtmx>> | null = null
  try {
    htmx = await loadHtmx(SITE_ROOT)
  } catch (error) {
    // The site still works as a multi-page one, so this is a degradation and not
    // a failure. Say so rather than dying quietly.
    console.error('[epubsite] htmx did not load; links will navigate normally.', error)
  }

  // 5. By absolute URL: step 3 has already replaced the document's URL, and a
  //    relative fetch would resolve under the chapter's directory.
  let context: ChapterSyncContext
  try {
    const data = await loadShellData(SITE_ROOT)
    context = {
      data,
      root: SITE_ROOT,
      shellDir: document.body.dir,
      shellLang: document.documentElement.lang,
    }
  } catch (error) {
    console.error('[epubsite] shell-data.json did not load; chapters will not be styled.', error)
    return
  }

  // 6. Wired before the first swap, so no chapter is ever shown without its
  //    styles or its sidebar highlight.
  wireChapterSync(context)
  wireShare(context)
  if (htmx !== null) {
    wireNavigation()
    wireSearch({ root: SITE_ROOT, data: context.data, htmx })
  }

  // A readiness flag for callers that must not race the enhanced navigation.
  //
  // It is not decoration: until htmx has loaded and processed the document, a
  // sidebar click is an ordinary link — the graceful degradation the multi-page
  // shell provides — so anything that needs the SPA has to wait for this. There
  // is no other observable: the ESM build exposes no global, and htmx's own
  // readiness is internal. `--no-spa` sites never set it, which is the honest
  // signal that there is nothing to wait for.
  document.documentElement.dataset.epubsite = htmx === null ? 'degraded' : 'ready'

  if (entry !== null && htmx !== null) {
    try {
      // The entry navigation is programmatic and must not be mistaken for a
      // reader clicking a link back into the chapter they are already reading.
      // It looks exactly like one: `replaceState` above has already put the
      // address bar on the chapter we are about to fetch, so the short-circuit
      // in `wireNavigation` would cancel the very request that gets us there.
      entryInFlight = true
      await htmx.ajax('GET', entryRequestUrl(SITE_ROOT, entry), {
        target: '#epub-content',
        swap: 'innerHTML show:top',
        push: false,
      })
    } catch (error) {
      console.error('[epubsite] the requested chapter did not load.', error)
    } finally {
      entryInFlight = false
    }
  }

  // Idempotent, and it is what clears the highlight on the landing page.
  syncChapter(context, keyFromLocation(SITE_ROOT))
}

/** §5.4.2: the four pieces of per-chapter state, updated together. */
function wireChapterSync(context: ChapterSyncContext): void {
  const sync = (): void => syncChapter(context, keyFromLocation(SITE_ROOT))

  document.body.addEventListener('htmx:afterSwap', () => {
    sync()
    focusContent()
  })

  // Restoring from htmx's history cache re-creates the old DOM without a
  // request, so nothing else would re-apply the chapter's styles.
  document.body.addEventListener('htmx:historyRestore', sync)
}

/**
 * The anchor that most recently received a click.
 *
 * htmx's `htmx:beforeRequest` detail does carry the trigger element
 * (`detail.elt`), and that is the primary source for the fragment below. This
 * capture is the fallback for the paths where it is not an anchor — htmx's
 * `ajax()` and form triggers — so the short-circuit still knows what was asked
 * for rather than silently doing nothing.
 */
let lastClicked: HTMLAnchorElement | null = null

function wireNavigation(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      lastClicked = target instanceof Element ? target.closest('a') : null
    },
    true,
  )

  // §5.7: a link back into the current chapter is not a navigation. EPUB tables
  // of contents are full of `./ch01.xhtml#sec3`, and without this every one of
  // them re-requests and repaints the chapter the reader is already reading.
  //
  // **The short-circuit must perform the jump itself.** htmx's `shouldCancel`
  // cancels the browser's default action for any link whose raw href is not a
  // bare `#fragment`, so by the time this runs the browser's own fragment
  // navigation has already been prevented. Cancelling the request and returning
  // would close both paths at once, and clicking a footnote would do nothing at
  // all — a failure that looks like a broken link rather than a missing line.
  document.body.addEventListener('htmx:beforeRequest', (event) => {
    if (entryInFlight) return

    const detail = (
      event as CustomEvent<{
        elt?: Element
        pathInfo?: { finalRequestPath?: string; anchor?: string }
      }>
    ).detail

    const anchor = detail.elt instanceof HTMLAnchorElement ? detail.elt : lastClicked
    const href = anchor?.getAttribute('href') ?? null
    const target = href ?? detail.pathInfo?.finalRequestPath
    if (target === null || target === undefined) return

    const url = new URL(target, location.href)
    if (url.pathname !== location.pathname) return

    event.preventDefault()
    const fragment = url.hash !== '' ? url.hash : (detail.pathInfo?.anchor ?? '')
    if (fragment !== '') location.hash = fragment.startsWith('#') ? fragment : `#${fragment}`
    // Setting a hash that is already set does not scroll, so the jump is done
    // explicitly rather than left to the browser.
    scrollToFragment()
  })

  // §5.7: a fragment does not participate in a swap, so the browser never
  // scrolls to it on its own after a cross-chapter jump.
  //
  // §5.10: and with **no** fragment the chapter has to start at its own top. This
  // cannot be left to htmx's `show:top`, which the swap spec asks for: `show`
  // scrolls the *document*, and the document never scrolls here — the chapter
  // scrolls inside its own pane. So the pane simply kept whatever offset the
  // previous chapter was left at, and opening a chapter from partway down another
  // one landed the reader partway down it too.
  document.body.addEventListener('htmx:historyRestore', () => {
    restoringHistory = true
  })

  document.body.addEventListener('htmx:afterSettle', () => {
    if (restoringHistory) {
      restoringHistory = false
      scrollToFragment()
      return
    }

    if (location.hash.length >= 2) {
      scrollToFragment()
      return
    }

    const pane = document.getElementById('epub-content')
    if (pane !== null) pane.scrollTop = 0
  })
}

/**
 * §5.7: move the reader's focus to the content.
 *
 * Without it a keyboard or screen-reader user follows a sidebar link and stays
 * focused in the sidebar, so Tab walks back through the reader's chrome before
 * reaching the chapter they just opened. `preventScroll` keeps this from
 * fighting the scroll position the navigation settles on.
 */
function focusContent(): void {
  document.getElementById('epub-content')?.focus({ preventScroll: true })
}

function scrollToFragment(): void {
  const hash = location.hash
  if (hash.length < 2) return
  const target = document.getElementById(decodeURIComponent(hash.slice(1)))
  target?.scrollIntoView()
}
