/**
 * The search UI (spec §D.4, §11.1).
 *
 * Pagefind ships a Component UI — custom elements that bring their own focus
 * trap, Escape handling and `mod+k` for free. That is the whole reason it is used
 * here rather than a hand-written modal: §11.1 asks for those behaviours, and
 * they are exactly the kind of thing that is easy to get subtly wrong.
 *
 * Two decisions carry the weight:
 *
 * **Everything is loaded lazily, on the first open.** The bundle is a quarter of
 * a megabyte and most readers never search. A reader who does pays one round trip
 * at the moment they ask for it, which is the right place for the cost.
 *
 * **Result clicks are intercepted, and they have to be.** A result points at a
 * chapter's *real* path, so letting the browser follow it would leave the reader
 * on a bare page with no sidebar — the very failure §8 exists to prevent, arriving
 * through a door nobody was watching. The interception runs in the capture phase
 * and uses `composedPath()`, because the Component UI renders its results inside a
 * shadow root where an ordinary `closest('a')` sees nothing.
 *
 * The stylesheet is injected as an **unlayered** `<link>`. `shell.css` declares
 * `@layer epub, shell`, and unlayered rules outrank every layer regardless of
 * specificity — which is what keeps the search UI's own classes from being
 * flattened by the reader's layout rules (§D.4).
 */
import { RESERVED_PATHS, SHELL_ASSETS } from '../shared/paths'
import type { Htmx } from './htmx'
import type { ShellData } from './data'

const BUNDLE = `${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.pagefindDir}`
const UI_SCRIPT = `${BUNDLE}pagefind-component-ui.js`
const UI_STYLE = `${BUNDLE}pagefind-component-ui.css`

export interface SearchContext {
  readonly root: URL
  readonly data: ShellData
  readonly htmx: Htmx
}

let prepared: Promise<void> | null = null

export function wireSearch(context: SearchContext): void {
  const trigger = document.getElementById('search-open')
  if (trigger === null) return

  trigger.addEventListener('click', () => {
    void open(context)
  })

  wireResultClicks(context)
}

async function open(context: SearchContext): Promise<void> {
  prepared ??= prepare(context.root)
  try {
    await prepared
  } catch (error) {
    // A failed index or a missing bundle degrades the site; it does not break it.
    // Saying so beats a button that appears to work and does nothing.
    console.error(
      '[epubsite] search could not be loaded. The index may be missing from this build.',
      error,
    )
    return
  }

  const modal = modalElement()
  if (modal === null) return
  modal.open?.()
}

/**
 * The Component UI's modal, which keeps its own open state.
 *
 * That private state is the reason this file no longer touches the `<dialog>`:
 * calling `showModal()` directly opened the dialog while leaving the component
 * believing it was closed, so its own close button — the one it renders, labels
 * "close" and styles — did nothing when clicked. The component's `open()` sets
 * the flag and then opens the dialog, which is the only ordering that keeps the
 * two in agreement.
 *
 * Optional methods because they belong to a third-party element: if a future
 * Pagefind renames them the search UI fails to *open*, which is visible, rather
 * than opening into a state nothing can close, which is not.
 */
interface PagefindModal extends HTMLElement {
  open?: () => void
  close?: () => void
}

function modalElement(): PagefindModal | null {
  return document.getElementById('search-modal') as PagefindModal | null
}

async function prepare(root: URL): Promise<void> {
  const style = document.createElement('link')
  style.rel = 'stylesheet'
  style.href = new URL(UI_STYLE, root).href
  document.head.appendChild(style)

  // The specifier is anchored to the site root for the same reason `htmx.esm.js`
  // is: a relative one would resolve under the chapter's directory after a
  // navigation, and a static `import './…'` cannot be typed honestly because the
  // file does not exist next to the source.
  await import(new URL(UI_SCRIPT, root).href)

  const config = document.createElement('pagefind-config')
  // Absolute, not relative: `bundle-path` is resolved against the *page*, and
  // pushState moves the page.
  config.setAttribute('bundle-path', new URL(BUNDLE, root).href)
  config.setAttribute('base-url', root.href)
  document.head.appendChild(config)

  const modal = document.createElement('pagefind-modal')
  modal.id = 'search-modal'
  document.body.appendChild(modal)
}

function wireResultClicks(context: SearchContext): void {
  document.addEventListener(
    'click',
    (event) => {
      const link = event
        .composedPath()
        .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
      if (link === undefined) return

      const href = link.getAttribute('href')
      if (href === null) return
      const url = new URL(href, location.href)

      // Only our own chapters are routed through the reader. An external link in
      // a result, or the bundle's own files, must behave normally.
      if (url.origin !== context.root.origin) return
      if (!url.pathname.startsWith(context.root.pathname)) return
      const key = url.pathname.slice(context.root.pathname.length)
      if (context.data.byKey[key] === undefined) return

      event.preventDefault()
      closeModal()
      void context.htmx
        .ajax('GET', url.href, {
          target: '#epub-content',
          swap: 'innerHTML show:top',
          // Unlike the entry protocol, a search result *is* a navigation the
          // reader will expect to be able to go Back from — so it pushes, with
          // the result's own address rather than the branch they were reading.
          push: url.href,
        })
        .catch((error: unknown) => {
          console.error('[epubsite] could not open the search result.', error)
        })
    },
    true,
  )
}

function closeModal(): void {
  modalElement()?.close?.()
}
