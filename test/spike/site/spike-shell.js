/*
 * Phase 0 spike shell. Deliberately minimal: it exists only to test the two
 * assumptions the whole product rests on (spec §2, §14).
 *
 *   I1  location must already point at the chapter the moment content resolves
 *       its relative URLs -> htmx must pushState BEFORE it swaps.
 *   I2  every relative URL in the shell itself breaks after that pushState,
 *       because the document base moves with it -> shell links must be
 *       absolutized against a frozen SITE_ROOT.
 */
import htmx from './htmx.esm.js'

htmx.config.allowScriptTags = false
htmx.config.selfRequestsOnly = true
htmx.config.historyCacheSize = 10

// I4 / §5.2.2: frozen once, at module evaluation, when the shell is served at
// its own location.
const SITE_ROOT = new URL('.', location.href)

// I2, first path (§5.3): DOM attributes marked [data-shell].
function absolutizeShell() {
  for (const a of document.querySelectorAll('[data-shell][href]')) {
    if (a.dataset['abs']) continue
    a.setAttribute('href', new URL(a.getAttribute('href'), SITE_ROOT).href)
    a.dataset['abs'] = '1'
  }
}
absolutizeShell()

// Probe surface for the spec. Nothing in the product reads this.
const probe = {
  beforeSwapPath: null,
  pushedPath: null,
  contentAtPush: null,
  afterSwapPath: null,
  requests: [],
}
globalThis.__i1 = probe

document.body.addEventListener('htmx:beforeRequest', (evt) => {
  probe.requests.push(evt.detail.pathInfo.requestPath)
})

// NOTE: htmx:beforeSwap is the veto hook. It fires BEFORE htmx starts swapping,
// so `location` is legitimately still the old URL here. Do not assert on it.
document.body.addEventListener('htmx:beforeSwap', () => {
  probe.beforeSwapPath = location.pathname
})

// This is the precise moment I1 depends on: htmx pushes the URL inside swap()'s
// beforeSwapCallback, which doSwap() calls as its first statement, before the
// DOM is touched.
document.body.addEventListener('htmx:pushedIntoHistory', () => {
  probe.pushedPath = location.pathname
  probe.contentAtPush = document.querySelector('#epub-content')?.textContent ?? ''
})

document.body.addEventListener('htmx:afterSwap', () => {
  probe.afterSwapPath = location.pathname
})
