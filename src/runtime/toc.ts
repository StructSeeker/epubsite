/**
 * Collapsible sidebar sections (§11.4).
 *
 * A book's table of contents is often a tree, and a long one — a technical book
 * can nest hundreds of entries three levels deep, which makes the sidebar a wall
 * the reader scrolls past rather than a map. Collapsing a branch is how a tree
 * becomes navigable.
 *
 * The state is one attribute on the `<li>`, `data-collapsed`, and the stylesheet
 * hides the nested `<ol>` from it. Three consequences follow, and each is the
 * reason for the choice: the state survives being re-rendered because it is
 * markup rather than a JavaScript object; CSS owns the hiding, so there is no
 * moment where the DOM and the visual state disagree; and `aria-expanded` can be
 * derived from the same attribute instead of tracked separately.
 *
 * Nothing here persists. A reader who collapses a section and reloads gets it
 * back open, which is the same thing every other reader does and avoids inventing
 * a storage key whose lifetime nobody has thought about.
 */
/** `data-collapsed` is written as a string; this is the value that means hidden. */
const COLLAPSED = 'true'

/** The sidebar, which the shell renders with this id (§5.1). */
const SIDEBAR = 'toc'
const BRANCH = '[data-toc-branch]'
const DISCLOSURE = '.toc-disclosure'

export function wireTocCollapse(): void {
  const toc = document.getElementById(SIDEBAR)
  if (toc === null) return

  // One listener for the whole sidebar rather than one per disclosure button:
  // there can be hundreds of them, and delegated clicks do not need re-binding
  // when the tree changes.
  toc.addEventListener('click', (event) => {
    const target = event.target
    const button = target instanceof Element ? target.closest(DISCLOSURE) : null
    if (button === null) return

    const branch = button.closest(BRANCH)
    if (branch === null) return

    setCollapsed(branch, !isCollapsed(branch))
    syncAllButton()
  })

  const all = document.getElementById('toc-collapse')
  if (all === null) return

  all.addEventListener('click', () => {
    const branches = allBranches()
    // Expanding when everything is already collapsed is what makes this a toggle
    // rather than a one-way action: after one press the button would otherwise
    // have nothing left to do.
    const collapse = !branches.every(isCollapsed)
    for (const branch of branches) setCollapsed(branch, collapse)
    syncAllButton()
  })

  syncAllButton()
}

/**
 * Expands whatever contains `element`.
 *
 * Called when the reader arrives at a chapter, because a chapter inside a
 * collapsed branch would be marked with `aria-current` and be invisible — the
 * sidebar would lose the one thing it is for. A deliberate collapse of the
 * *current* branch is therefore undone by navigating into it, which is the
 * behaviour to prefer: being unable to see where you are is worse than a section
 * reopening.
 */
export function revealCurrent(element: Element | null): void {
  let branch = element?.closest(BRANCH) ?? null
  while (branch !== null) {
    setCollapsed(branch, false)
    branch = branch.parentElement?.closest(BRANCH) ?? null
  }
  syncAllButton()
}

function allBranches(): HTMLElement[] {
  const toc = document.getElementById(SIDEBAR)
  return toc === null ? [] : [...toc.querySelectorAll<HTMLElement>(BRANCH)]
}

function isCollapsed(branch: Element): boolean {
  return branch.getAttribute('data-collapsed') === COLLAPSED
}

function setCollapsed(branch: Element, collapsed: boolean): void {
  branch.setAttribute('data-collapsed', collapsed ? COLLAPSED : 'false')
  // `aria-expanded` is a string. `setAttribute(name, false)` would write the
  // literal text "false", which assistive technology reads as *expanded* — the
  // exact opposite of the intent.
  branch.querySelector(DISCLOSURE)?.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
}

/**
 * Keeps the collapse-all button's name true to what it will do next.
 *
 * A symbol button has no text to update, so the only thing that can describe the
 * change is its accessible name; leaving it as "Collapse all sections" while
 * everything is already collapsed would be a lie.
 */
function syncAllButton(): void {
  const all = document.getElementById('toc-collapse')
  if (all === null) return

  const branches = allBranches()
  const collapsed = branches.length > 0 && branches.every(isCollapsed)
  all.setAttribute('aria-label', collapsed ? 'Expand all sections' : 'Collapse all sections')
}
