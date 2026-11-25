/**
 * Restoring the namespaces an HTML parse throws away (spec §5.15).
 *
 * The failure this repairs is real and was reported from a deployed book:
 * *Handbook of Financial Risk Management* wraps every formula in
 * `<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML">` — 14,583 elements
 * in one chapter. Opened as a bare page it typesets correctly, because
 * `#epubsite-content`'s source is served as `application/xhtml+xml` and an XML
 * parser resolves the `mml` prefix through the `xmlns:mml` declaration. Under
 * the shell the document is **HTML**: htmx parses the chapter into an HTML
 * fragment, and the HTML parser has no concept of a namespace prefix. It only
 * enters the MathML foreign-content mode for an unprefixed `<math>` start tag,
 * so `<mml:math>` becomes an unknown HTML element named `mml:math`, and so do
 * its 14,582 children. Unknown elements get `display: inline` and no layout at
 * all, so 280 formulas collapse into lines of glued characters.
 *
 * Two fixes are rejected before this one:
 *
 *   - **Rewriting the book.** Normalising `mml:` away at build time would be the
 *     simplest code in the project and a direct violation of zero-rewrite (G2,
 *     §1.2): the artifact's entries must match the EPUB's bytes.
 *   - **Running the book's MathJax.** The bare page loads MathJax 2 to convert
 *     MathML to SVG, and the shell deliberately does not carry the book's
 *     scripts (§10 measure 1: `allowScriptTags = false`), nor does it ship a
 *     typesetter of its own.
 *
 * What is left is to make the in-memory tree the one an XML parse would have
 * built, and only in memory: walk the swapped subtree, resolve each prefixed
 * name through the `xmlns:*` declarations that the HTML parser *did* keep as
 * ordinary attributes, and recreate those elements with `createElementNS`.
 * The book's file on disk is untouched, and the browser's own MathML Core
 * layout takes over — which is why `mfrac` computes to `display: block math`
 * afterwards rather than to `inline`.
 *
 * Two details carry the correctness:
 *
 *   - **The prefix may be declared on the root only.** `<mml:math xmlns:mml=…>`
 *     is common, but the declaration also lives on `<html>` in many conversions
 *     — and the swap keeps the *body*, so that one is gone by now. Hence the
 *     scope walk below plus {@link WELL_KNOWN}, which covers the prefixes a
 *     book's markup is actually written with. A prefix this project cannot
 *     resolve is left alone: guessing a namespace would turn a broken formula
 *     into a wrongly-shaped one.
 *   - **The history snapshot needs no second pass.** htmx stores a swap's
 *     `innerHTML`, and the HTML serializer writes a namespaced element by its
 *     *local* name — `<math>`, not `<mml:math>`. A restore therefore re-parses
 *     into the correct namespace by itself, which is asserted in
 *     `test/e2e/namespaces.spec.ts`.
 */

const MATHML = 'http://www.w3.org/1998/Math/MathML'
const SVG = 'http://www.w3.org/2000/svg'
const XLINK = 'http://www.w3.org/1999/xlink'

/**
 * Prefixes whose namespace is not in doubt, for the case where the declaration
 * lived on an element the swap discarded.
 *
 * `m` is here because some tools export MathML as `<m:math>`; `svg` because
 * InDesign-style EPUBs write `<svg:svg>`; `xlink` because it is an attribute
 * prefix on SVG and attributes are copied through the same resolution.
 */
const WELL_KNOWN: ReadonlyMap<string, string> = new Map([
  ['mml', MATHML],
  ['m', MATHML],
  ['svg', SVG],
  ['xlink', XLINK],
])

/**
 * Rebuilds every prefixed element under `content` in its real namespace.
 *
 * Idempotent, because it only rebuilds what it can resolve: a second pass over
 * an already-repaired tree finds no prefixed names left. (A prefix it cannot
 * resolve keeps its name — see the note on guessing above.) Null-tolerant
 * because the caller looks the content pane up, and a missing pane is a no-op
 * rather than a crash.
 */
export function repairNamespaces(content: ParentNode | null): void {
  if (content === null) return
  visit(content, new Map())
}

function visit(parent: ParentNode, scope: ReadonlyMap<string, string>): void {
  // Indexed rather than `for … of`: the collection is live, and replacing a child
  // keeps the child count — so the index still names the same position.
  const children = parent.children
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child === undefined) continue
    // Read the declarations *before* the element is replaced: they describe the
    // subtree, and the replacement deliberately carries none of them. An
    // element's own declaration covers the element itself too — `<mm:math
    // xmlns:mm=…>` names its own namespace — so this scope is the one used to
    // resolve the element, not the outer one.
    const nested = extendScope(scope, child)
    visit(rebuild(child, nested), nested)
  }
}

/** The replacement for one element, or the element itself when it needs none. */
function rebuild(element: Element, scope: ReadonlyMap<string, string>): Element {
  const name = element.localName
  const colon = name.indexOf(':')
  // `0` would make the prefix empty — a name like `:math` is malformed, not prefixed.
  if (colon < 1) return element

  const local = name.slice(colon + 1)
  const uri = resolve(scope, name.slice(0, colon))
  if (local === '' || uri === undefined) return element

  const replacement = document.createElementNS(uri, local)
  for (const attribute of element.attributes) {
    copyAttribute(replacement, attribute, scope)
  }
  // Moving the children rather than cloning them keeps the pass free of duplicate
  // ids, and it is what makes the recursion below work on the live tree.
  while (element.firstChild !== null) replacement.appendChild(element.firstChild)
  element.replaceWith(replacement)
  return replacement
}

/**
 * Copies one attribute, resolving a prefixed *name* to its namespace.
 *
 * `xlink:href` is why this is not simply `setAttribute`: on an SVG element a
 * null-namespace `xlink:href` is inert, and the reference silently disappears.
 * Namespace *declarations* are dropped — the namespace they declared is now real,
 * and keeping them would put `xmlns:mml` into every history snapshot.
 */
function copyAttribute(
  target: Element,
  attribute: Attr,
  scope: ReadonlyMap<string, string>,
): void {
  const name = attribute.name
  if (name === 'xmlns') return

  const colon = name.indexOf(':')
  if (colon > 0) {
    const prefix = name.slice(0, colon)
    if (prefix === 'xmlns') return
    const uri = resolve(scope, prefix)
    if (uri !== undefined) {
      target.setAttributeNS(uri, name, attribute.value)
      return
    }
  }
  target.setAttribute(name, attribute.value)
}

function resolve(scope: ReadonlyMap<string, string>, prefix: string): string | undefined {
  return scope.get(prefix) ?? WELL_KNOWN.get(prefix)
}

/**
 * The scope as seen by an element's children.
 *
 * A `Map` is copied only by elements that actually declare a prefix, so the
 * common case — a book with no MathML at all — allocates nothing while walking.
 */
function extendScope(
  scope: ReadonlyMap<string, string>,
  element: Element,
): ReadonlyMap<string, string> {
  let extended: Map<string, string> | null = null
  for (const attribute of element.attributes) {
    if (!attribute.name.startsWith('xmlns:')) continue
    extended ??= new Map(scope)
    extended.set(attribute.name.slice('xmlns:'.length), attribute.value)
  }
  return extended ?? scope
}
