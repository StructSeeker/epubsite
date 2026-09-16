/**
 * The narrow-screen drawer (spec §5.1, §11.1).
 *
 * Wired here rather than deferred to the accessibility pass, because the shell
 * markup contains the toggle button: a button that does nothing is worse than no
 * button, and "we will make it work later" is how inert controls ship.
 *
 * The state lives on `document.documentElement` as `data-drawer-open` rather
 * than as an inline style or a class on the panel, for three reasons: a single
 * attribute is one thing to keep in sync, the stylesheet can respond to it at
 * any breakpoint without JavaScript knowing about layout, and `aria-expanded`
 * can be derived from it instead of tracked separately.
 *
 * `aria-expanded` is a string, not a boolean. Setting `"true"`/`"false"` is not
 * pedantry — `setAttribute(name, false)` writes the literal text "false", which
 * assistive technology reads as *expanded*, the exact opposite of the intent.
 */
export function wireDrawer(): void {
  const toggle = document.getElementById('toc-toggle')
  if (toggle === null) return

  const root = document.documentElement

  const isOpen = (): boolean => root.hasAttribute('data-drawer-open')

  const sync = (): void => {
    toggle.setAttribute('aria-expanded', isOpen() ? 'true' : 'false')
  }

  toggle.addEventListener('click', () => {
    if (isOpen()) root.removeAttribute('data-drawer-open')
    else root.setAttribute('data-drawer-open', '')
    sync()
  })

  sync()
}
