/**
 * The share button (spec §5.8).
 *
 * It converts the chapter the reader is on into a **token path** and puts that on
 * the clipboard. This is the token path's only purpose anywhere in the system: it
 * is not in `readingOrder`, not in `canonical`, not in Open Graph, and not in the
 * address bar (§8.5, C.7). A token URL returned 404 under the default hosting
 * mode, so pointing a search engine at one would be pointing it at a failure.
 *
 * On the landing page there is no chapter, so it copies the reader's own address
 * instead — a link that opens the book, which is what a reader on the landing
 * page is looking at. The button is never disabled: see `isChapter`.
 *
 * What that buys is the one thing a real path cannot do: a link that, when
 * opened, produces the *reader* at that chapter rather than a bare page with no
 * sidebar and no navigation.
 *
 * The fragment is preserved, because a shared footnote reference should land on
 * the footnote.
 */
import { toToken } from '../shared/token'
import { keyFromLocation } from './location-key'
import type { ShellData } from './data'

export interface ShareContext {
  readonly data: ShellData
  readonly root: URL
}

/** Captured once: the label is copy, and re-reading it after a flash would
 * capture the flash text as the label. */
let label = ''

export function wireShare(context: ShareContext): void {
  const button = document.getElementById('share')
  if (button === null) return
  label = button.textContent ?? ''

  button.addEventListener('click', () => {
    void copy(context, button)
  })

  syncEnabled(button)
  // The button's label has to come back after a flash if the reader navigates
  // while it is showing, so it follows the same events the chapter sync does.
  document.body.addEventListener('htmx:afterSwap', () => syncEnabled(button))
  document.body.addEventListener('htmx:historyRestore', () => syncEnabled(button))
}

async function copy(context: ShareContext, button: HTMLElement): Promise<void> {
  const url = new URL(location.href)

  if (isChapter(context)) {
    const token = toToken(url.pathname)
    if (token !== null) url.pathname = token
  } else {
    // The landing page: there is no chapter to tokenise, so the link is the
    // reader's own address — "here is the book".
    url.search = ''
    url.hash = ''
  }

  try {
    await navigator.clipboard.writeText(url.href)
    flash(button, 'Link copied')
  } catch (error) {
    // Clipboard access needs a secure context and a user gesture. Both hold for
    // any real deployment, so a failure here is worth saying out loud rather
    // than swallowing — a button that appears to work and copies nothing is
    // worse than one that admits it failed.
    console.error('[epubsite] could not write to the clipboard.', error)
    flash(button, 'Copy failed')
  }
}

/**
 * Whether the reader is currently on a chapter, as opposed to the landing page.
 *
 * The distinction decides *what* gets copied, and it is also the fix for a real
 * defect: the button used to be disabled unless this returned true, which left it
 * dead on the landing page — the first thing every reader sees. A control that
 * does nothing on first use reads as a broken control, and there is always
 * something worth sharing: a chapter's token path, or the book itself.
 */
function isChapter(context: ShareContext): boolean {
  const key = keyFromLocation(context.root)
  return key !== null && context.data.byKey[key] !== undefined
}

/** Enabled from the moment the runtime is running, on every page. */
function syncEnabled(button: HTMLElement): void {
  button.removeAttribute('disabled')
  button.textContent = label
}

let restore: number | undefined

function flash(button: HTMLElement, message: string): void {
  button.textContent = message
  window.clearTimeout(restore)
  restore = window.setTimeout(() => {
    button.textContent = label
  }, 1500)
}
