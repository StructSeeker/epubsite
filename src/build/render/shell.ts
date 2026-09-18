/**
 * The reader shell (spec §3.1, §5.1, §4.6).
 *
 * Rendered by tag template rather than a template engine: two generated files do
 * not justify a dependency and the indirection that comes with it (§4.6).
 *
 * The three attributes that make this a reader rather than a page of links are
 * load-bearing, and each has a plausible wrong alternative (§5.1):
 *
 *   `hx-boost="true"` on `<body>`   the only zero-rewrite way to take over the
 *                                   hundreds of ordinary links inside book
 *                                   content. It inherits, so nothing in the
 *                                   book needs editing.
 *   `hx-target="#epub-content"`     overrides boost's default target (`<body>`).
 *                                   The sidebar surviving navigation is
 *                                   *entirely* this: it sits outside the target,
 *                                   so htmx never touches it, and its scroll
 *                                   position, expansion and focus come free.
 *   `hx-swap="innerHTML show:top"`  `outerHTML` would rebuild `#epub-content`
 *                                   itself and discard state attached to it;
 *                                   `show:top` resets the viewport, without
 *                                   which a jump between long chapters lands
 *                                   somewhere arbitrary.
 *
 * `--no-spa` emits none of them and no runtime module either, so the same markup
 * works as an ordinary multi-page site. That is not a degraded mode so much as
 * the baseline the SPA layer enhances — and it is why the site still works when
 * the htmx module never arrives.
 */
import { RESERVED_PATHS, SHELL_ASSETS, toUrlPath } from '../../shared/paths'
import { presentationNav, type NavNode } from '../epub/nav'
import { tableOfContents, type BookModel } from '../model/book'
import { html, markSafe, attr, scriptJson, type SafeHtml } from './escape'
import type { BaseUrl, Theme } from '../options'
import type { BookNode } from '../model/structured-data'

export interface ShellInput {
  model: BookModel
  /** The shell's own file name (§9 `--name`). */
  shellName: string
  /**
   * Decides whether `canonical` can be emitted at all (§7.5).
   *
   * An absolute value is also what the runtime re-anchors the landing page to
   * (`runtime/head-slots.ts`), so the two halves of §5.4's canonical slot read
   * the same field of the same option.
   */
  baseUrl: BaseUrl
  /** `--no-spa`: no htmx attributes, no runtime module. */
  spa: boolean
  /** `--theme`: `auto` emits nothing and lets `prefers-color-scheme` decide. */
  theme: Theme
  /** Things the reader should be told about, shown on the landing page. */
  notices: readonly string[]
  /** `--search`: emit the search control, which the runtime wires up. */
  search: boolean
  /** The §7.2 node, or `null` under `--json-ld none`. */
  bookJsonLd: BookNode | null
}

export function renderShell(input: ShellInput): SafeHtml {
  const { model, spa } = input
  const lang = model.opf.metadata.languages[0] ?? 'en'
  const dirAttr = model.progression === 'rtl' ? markSafe(' dir="rtl"') : markSafe('')

  // Only the absolute form can produce an origin-dependent tag; a path-form
  // base URL says where the site will live but carries no origin to point at
  // (§9). §8.5: canonical points at the book's landing page, never at a token
  // path and never at the site root, which is not a page under the default
  // hosting mode.
  //
  // `data-epub-canonical` marks the tag as the runtime's to remove, because the
  // claim it makes belongs to the *landing page* alone: once the reader is on a
  // chapter, the document is not the landing page, and a canonical still
  // pointing at the shell would assert that this chapter is a duplicate of it —
  // the one thing a canonical can say that is flatly false. `syncCanonical` in
  // `runtime/head-slots.ts` is the other half of §5.4's canonical slot.
  const base = input.baseUrl.form === 'absolute' ? input.baseUrl.href : undefined
  const canonical =
    base === undefined
      ? markSafe('')
      : html`<link rel="canonical" href="${base}${input.shellName}" data-epub-canonical>`

  // The skip link is shell chrome, so under the SPA it must name the shell file
  // explicitly: after a pushState, a bare `#epub-content` would resolve against
  // the chapter's directory and navigate away from the reader (§5.2.1).
  const skipHref = spa ? `${input.shellName}#epub-content` : '#epub-content'

  return html`<!doctype html>
<html lang="${lang}"${dirAttr}${themeAttr(input.theme)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="epubsite">
<title>${model.title}</title>${metaDescription(model)}${canonical}${bookLd(input.bookJsonLd)}
<link rel="stylesheet" href="${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellCss}">
<link rel="icon" type="image/svg+xml" href="${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.iconSvg}"${shellMarker(spa)}>
<!-- The runtime owns everything below this line in <head> (§5.4.3). -->
</head>
<body${bodyAttrs(spa)}>
<a class="skip-link" href="${skipHref}"${shellMarker(spa)}>Skip to content</a>
<nav id="toc" aria-label="Table of contents">
${renderToc(input)}
</nav>
<div id="frame">
<header id="toolbar">
${tocToggle()}
${homeLink(input)}
<span id="book-title">${model.title}</span>
${searchButton(input)}
${collapseButton(input)}
${shareButton(spa)}
<div id="progress" class="htmx-indicator" role="status">Loading…</div>
</header>
<main id="epub-content" tabindex="-1" aria-live="polite">
${renderLanding(input)}
</main>
</div>
${runtimeScript(spa)}
</body>
</html>
`
}

function bodyAttrs(spa: boolean): SafeHtml {
  if (!spa) return markSafe('')
  return html` hx-boost="true" hx-target="#epub-content" hx-swap="innerHTML show:top" hx-indicator="#progress"`
}

/**
 * `--theme` (§11.2).
 *
 * `auto` emits nothing at all, and that is the point: the stylesheet's
 * `prefers-color-scheme` block then decides, so the reader follows the operating
 * system and keeps following it if it changes at dusk. Emitting
 * `data-theme="auto"` would be a third state for the stylesheet to handle and
 * would freeze the choice at load time.
 */
function themeAttr(theme: Theme): SafeHtml {
  return theme === 'auto' ? markSafe('') : attr('data-theme', theme)
}

/**
 * §5.3: shell URLs that must survive a `pushState` carry this marker.
 *
 * The favicon needs it as much as the skip link does, and for a reason that is
 * easy to miss: a browser re-resolves `<link rel="icon">` against the document's
 * *current* base. After `pushState` the base is the chapter's directory, so a
 * relative `_epubsite_assets/icon.svg` was requested from
 * `/OEBPS/text/_epubsite_assets/icon.svg` and 404ed — invisibly, as favicons do.
 */
function shellMarker(spa: boolean): SafeHtml {
  return markSafe(spa ? ' data-shell' : '')
}

function runtimeScript(spa: boolean): SafeHtml {
  if (!spa) return markSafe('')
  return html`<script type="module" src="${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellJs}"></script>`
}

/**
 * The narrow-view drawer toggle (§5.11), as a symbol rather than the word
 * "Contents".
 *
 * The text was the button's accessible name, so removing it means the name has to
 * come from somewhere else: `aria-label` supplies it, and the symbol is
 * `aria-hidden` because it carries no text of its own. Without the label a screen
 * reader would announce the whole control as "button" and nothing more — the same
 * rule the search, share and collapse controls follow.
 *
 * `aria-controls` and `aria-expanded` are unchanged: the drawer's state lives on
 * `<html data-drawer-open>` and `wireDrawer` derives the attribute from it, so
 * nothing about the toggle's behaviour depends on what is drawn inside it.
 *
 * Its visibility is CSS's business, not this function's: the button is
 * `display: none` above the narrow breakpoint and a symbol button below it, and
 * both of those declarations have to outrank the shared symbol styling in
 * `shell.css` — see the note there.
 */
function tocToggle(): SafeHtml {
  return html`<button id="toc-toggle" type="button" aria-expanded="true" aria-controls="toc" aria-label="Contents">${CONTENTS_ICON}</button>`
}

/**
 * Back to the landing page (§5.7).
 *
 * A real `<a>` and not a button, because this is navigation: middle-click and
 * "open in a new tab" mean what they say, and the control keeps working when the
 * htmx module never arrives.
 *
 * Two attributes carry the design.
 *
 * `data-shell` is mandatory, not decorative. After a `pushState` the document
 * base is the chapter's directory, so a relative `epubsite.html` would be
 * requested from `/OEBPS/text/epubsite.html` — a 404 that §8.2's guide
 * deliberately does *not* rescue, because only `@`-shaped paths are redirected
 * there (§5.3). `absolutizeShell` rewrites it at load, before htmx exists.
 *
 * `hx-select` is what makes the swap possible at all. The landing page is not a
 * fragment: it is the shell document, and a boosted request to it returns the
 * whole thing. htmx selects the matching nodes *themselves* and swaps them with
 * `innerHTML`, so selecting `#epub-content` would nest the pane inside itself — a
 * duplicate id, two sidebars, one document. Selecting its **children** replaces
 * the pane's contents with the landing page, which is what the reader asked for.
 *
 * The state that has to follow is not this file's: `syncChapter`'s landing branch
 * runs on the resulting `afterSwap` (styles out, chapter JSON-LD out, `body`
 * attributes restored, sidebar highlight cleared), htmx restores the document
 * title from the response, and the pane returns to the top because
 * `wireNavigation` resets it when there is no fragment.
 *
 * Only in the SPA. Without a runtime the shell *is* the landing page, always, so
 * the control would have nothing to do — the same reasoning that governs the
 * share and search controls.
 */
function homeLink(input: ShellInput): SafeHtml {
  if (!input.spa) return markSafe('')
  // Attribute order is not semantic, but `aria-label` is deliberately placed before
  // `hx-select`: the selector's value contains a literal `>`, and a reader (or a
  // test) that wants to pull this one tag out of the document can only do so with a
  // simple `[^>]*` scan if no earlier attribute swallows the closing bracket.
  return html`<a id="home" href="${input.shellName}" data-shell aria-label="Back to the book's home page" hx-select="#epub-content > *">${HOME_ICON}</a>`
}

/**
 * Collapse all.
 *
 * Emitted only when the table of contents actually has branches. Many books have
 * a flat one, and a control that cannot do anything is worse than no control —
 * the same reasoning that governs the search button's absence under `--no-spa`.
 *
 * The runtime turns it into a toggle: pressed once it collapses every section,
 * and pressed again it expands them, because a collapse-only button is a dead
 * control the moment there is nothing left to collapse.
 */
function collapseButton(input: ShellInput): SafeHtml {
  if (!input.spa || !hasBranches(input.model)) return markSafe('')
  return html`<button id="toc-collapse" type="button" data-shell-toc aria-label="Collapse all sections">${COLLAPSE_ALL_ICON}</button>`
}

/**
 * Whether there is any nesting to collapse.
 *
 * Only the top level needs checking: a grandchild cannot exist without its parent
 * having children, so if no top-level entry has any, the tree is flat.
 */
function hasBranches(model: BookModel): boolean {
  return tableOfContents(model).some((node) => node.children.length > 0)
}

/**
 * The sidebar's three symbols, drawn here for the same reasons as the toolbar's:
 * they must inherit `currentColor` so `--theme` reaches them, and they must be
 * this package's to license.
 *
 * `aria-hidden` throughout, because each symbol is decoration; the accessible
 * name belongs to the button that carries it.
 */
const CHEVRON_ICON = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>`

const COLLAPSE_ALL_ICON = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 4.5l5 5 5-5"/><path d="M7 19.5l5-5 5 5"/></svg>`

/**
 * The drawer toggle's symbol: a list whose entries each carry a leading mark.
 *
 * Deliberately not the three plain bars of a hamburger. The sidebar holds the
 * book's own table of contents, and the collapse-all control in the same toolbar
 * is already drawn as two chevrons pointing at each other; a glyph that reads as
 * *contents* is the one a reader can tell apart from both. The dot-sized leading
 * marks are `h.01` strokes with round caps rather than a separate shape, so they
 * stay legible at the 1.1rem the stylesheet renders them at.
 */
const CONTENTS_ICON = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h.01"/><path d="M9 7h11"/><path d="M4 12h.01"/><path d="M9 12h11"/><path d="M4 17h.01"/><path d="M9 17h11"/></svg>`

/**
 * The share button (§5.8).
 *
 * Only in the SPA: it copies a *token* path, and a token path is only meaningful
 * to a reader that knows how to receive one. On a multi-page site it would copy
 * a link to a file that does not exist.
 */
function shareButton(spa: boolean): SafeHtml {
  if (!spa) return markSafe('')
  return html`<button id="share" type="button" data-shell-share aria-label="Copy a link to this book" disabled>${LINK_ICON}</button>`
}

/**
 * The search control (§D.4).
 *
 * Only emitted with `--search`, and only in the SPA. Without the SPA there is no
 * runtime to open the modal, and a button that does nothing is worse than no
 * button. With `--search` but a failed index the button is still emitted and the
 * runtime reports the failure when it is pressed — a reader who clicks Search
 * deserves to be told why nothing happened.
 */
function searchButton(input: ShellInput): SafeHtml {
  if (!input.search || !input.spa) return markSafe('')
  return html`<button id="search-open" type="button" data-shell-search aria-label="Search this book">${SEARCH_ICON}</button>`
}

/**
 * The toolbar's symbols: search, link, home, contents.
 *
 * Drawn here rather than taken from an icon set or a symbol font, for two
 * reasons. They have to inherit `currentColor` so that `--theme` reaches them —
 * a glyph from a font is at the mercy of whatever the reader's system supplies.
 * And they have to be this package's to license: the favicon is already the one
 * asset that is not MIT, and a second one for a magnifying glass would be a poor
 * trade.
 *
 * The geometry is deliberately plain: a ring and a stroke for search, two
 * interlocking hooks for a link, a roof over a room for home, a marked list for
 * contents. All of them are drawn on a 24-unit grid with a 2-unit stroke so they
 * sit at the same visual weight.
 *
 * `aria-hidden` on each, because the symbol carries no text. The button's
 * accessible name comes from its `aria-label` — a symbol-only button without one
 * is announced by a screen reader as nothing but "button".
 */
const SEARCH_ICON = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/></svg>`

const LINK_ICON = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M10.6 13.4a4 4 0 0 0 5.7 0l2.9-2.9a4 4 0 1 0-5.7-5.7l-1.4 1.4"/><path d="M13.4 10.6a4 4 0 0 0-5.7 0l-2.9 2.9a4 4 0 1 0 5.7 5.7l1.4-1.4"/></svg>`

/**
 * Home: the landing page's own symbol.
 *
 * A roof over a room, drawn on the same 24-unit grid at the same 2-unit stroke as
 * the rest of the set — the geometry is what keeps a hand-authored icon from
 * looking like it came from a different family.
 */
const HOME_ICON = html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 10.5L12 4l8 6.5"/><path d="M6 10v9h12v-9"/></svg>`

function metaDescription(model: BookModel): SafeHtml {
  const description = model.opf.metadata.description
  return description === undefined
    ? markSafe('')
    : html`<meta name="description" content="${description}">`
}

/**
 * The static book node (§7.2, §5.6).
 *
 * Static on purpose, and this is the whole reason the two-layer graph works: a
 * crawler that executes no JavaScript sees the complete picture here, because
 * `hasPart` carries every chapter's name, url and position. The chapter node the
 * runtime injects later is an *addition* for consumers that do run scripts, not
 * the only way to find them (§7.7).
 *
 * It carries no `data-epub-ld` marker, which is what keeps `syncJsonLd` from
 * ever removing it.
 */
function bookLd(node: BookNode | null): SafeHtml {
  if (node === null) return markSafe('')
  return html`<script type="application/ld+json">${scriptJson(node)}</script>`
}

/**
 * The sidebar.
 *
 * Order comes from `presentationNav`, never from `model.nav` directly: for RTL
 * books the sidebar reverses while `readingOrder` and every chapter's `position`
 * do not (§12). `tableOfContents` supplies the spine when the book has no
 * navigation document of its own.
 *
 * Landmarks are a second, flat list rather than a second tree, because that is
 * what they are: a handful of "start reading", "cover", "copyright" entries the
 * book marks as structurally different from chapters (§4.3).
 */
function renderToc(input: ShellInput): SafeHtml {
  const { model, spa } = input
  const toc = presentationNav(tableOfContents(model), model.progression)
  const landmarks = presentationNav(model.nav.landmarks, model.progression)

  return html`${renderNavList(toc, spa)}${renderLandmarks(landmarks, spa)}`
}

function renderNavList(nodes: readonly NavNode[], spa: boolean): SafeHtml {
  if (nodes.length === 0) return markSafe('')
  return html`<ol>
${nodes.map((node) => renderNavItem(node, spa))}
</ol>`
}

function renderNavItem(node: NavNode, spa: boolean): SafeHtml {
  // A grouping `<li>` with no anchor and no label is a real pattern in nested
  // navigation: the structure carries the meaning and there is nothing to click.
  // Emitting an empty anchor would add a focus stop with no accessible name.
  const label =
    node.label === ''
      ? markSafe('')
      : html`<a href="${nodeHref(node)}"${linkAttrs(node, spa)}>${node.label}</a>`

  if (node.children.length === 0) return html`<li>${label}</li>`

  // A disclosure control only where there is something to disclose, and only in
  // the SPA. Without a runtime it would be a control that does nothing — the same
  // reason the share and search controls are SPA-only.
  const disclosure = spa
    ? html`<button class="toc-disclosure" type="button" aria-expanded="true"${attr(
        'aria-label',
        // A grouping node has children but no label of its own, and an empty
        // `aria-label` is worse than a generic one: it names nothing at all.
        node.label === '' ? 'Section' : node.label,
      )}>${CHEVRON_ICON}</button>`
    : markSafe('')

  // The disclosure sits *after* the label rather than before it, so that a leaf
  // entry and a branch entry start their text at the same offset and the sidebar
  // reads as one column. Putting it first would indent every branch label.
  return html`<li data-toc-branch>
<div class="toc-row">${label}${disclosure}</div>
${renderNavList(node.children, spa)}
</li>`
}

function renderLandmarks(nodes: readonly NavNode[], spa: boolean): SafeHtml {
  if (nodes.length === 0) return markSafe('')
  return html`<section id="landmarks" aria-label="Landmarks">
<h2>Landmarks</h2>
<ol>
${nodes.map(
  (node) => html`<li><a href="${nodeHref(node)}"${linkAttrs(node, spa)}>${node.label}</a></li>`,
)}
</ol>
</section>`
}

/**
 * A navigation entry's href, in the relative form the book itself uses.
 *
 * Relative on purpose: the artifact then knows nothing about where it is
 * deployed (I4), and the runtime absolutises these against the frozen site root
 * before any navigation can re-base them (I2, §5.3).
 *
 * `toUrlPath` percent-encodes segment by segment, so spaces and non-ASCII
 * survive while separators do not become `%2F`. The distinction is real: a book
 * may legitimately contain `a b.xhtml`, and none contains a directory separator
 * inside a file name.
 */
function nodeHref(node: NavNode): string {
  if (node.external) return node.href ?? ''
  if (node.entryPath === undefined) return node.href ?? '#'
  const path = toUrlPath(node.entryPath)
  return node.fragment === '' ? path : `${path}#${node.fragment}`
}

function linkAttrs(node: NavNode, spa: boolean): SafeHtml {
  if (!spa) return markSafe('')
  // An external URL is displayed but never fetched by the SPA (§4.3). Without
  // this opt-out, boost would intercept the click, `selfRequestsOnly` would
  // refuse the request, and the link would stop working altogether — a worse
  // outcome than simply not boosting it.
  const boost = node.external ? markSafe(' hx-boost="false"') : markSafe(' data-shell')
  // `data-key` is how §5.7's highlight finds the current chapter: an exact key
  // comparison beats re-deriving URLs from hrefs, and it keeps working when a
  // book's file names contain characters that need percent-encoding.
  return html`${boost}${attr('data-key', node.entryPath)}`
}

/** The landing page: what the reader sees before picking a chapter. */
function renderLanding(input: ShellInput): SafeHtml {
  const { model } = input
  const authors = model.authors.map((person) => person.name).join(', ')
  const publisher = model.publisher
  const description = model.opf.metadata.description

  return html`<h1>${model.title}</h1>
${input.notices.map((notice) => html`<p class="notice">${notice}</p>`)}
${authors === '' ? markSafe('') : html`<p class="byline">${authors}</p>`}
${publisher === undefined ? markSafe('') : html`<p class="publisher">${publisher}</p>`}
${description === undefined ? markSafe('') : html`<p class="description">${description}</p>`}
<p>Choose a chapter from the table of contents. Each chapter also opens on its own.</p>`
}
