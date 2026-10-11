/**
 * The shell's class and id namespace (spec §5.13).
 *
 * The stylesheet is evaluated against a document that also contains the book's
 * own markup — the chapter body is swapped into the shell's pane, and the book's
 * stylesheets go into the same `<head>`. So a selector here is not private by
 * default: a book that happens to write `#toc` would have the shell's sidebar
 * rules applied to *its* table of contents, and below the narrow breakpoint that
 * rule is `position: fixed` — the book's own TOC would become a floating drawer.
 *
 * The fix is a vocabulary, and a vocabulary rots the moment nothing checks it.
 * This is the check: every class and id selector in `shell.css` must be
 * namespaced, and the few that are not ours are listed explicitly rather than
 * tolerated by pattern.
 *
 * A test that parses selectors can pass by matching nothing, which would be worse
 * than no test at all (F.7), so the token count is asserted as well: the rule has
 * to be doing work on a file that has some.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Class names that belong to someone else, and so are the two honest exceptions.
 *
 * `htmx-request` is htmx's own switch on the element named by `hx-indicator`, and
 * `pf-modal-close` is Pagefind's close button — whose rule needs `!important`
 * precisely because that component's stylesheet is injected unlayered. Renaming
 * either would break the third party's contract rather than protect ours.
 */
const FOREIGN = new Set(['htmx-request', 'pf-modal-close'])

const PREFIX = 'epubsite-'

/**
 * Every `#id` and `.class` token appearing in a rule prelude.
 *
 * Preambles are found by splitting on `{`: the prelude of each rule is whatever
 * follows the previous block's closing brace. At-rule preludes are skipped
 * wholesale — `@media (max-width: 52.5rem)` is not a selector list, and its `.5`
 * would otherwise be read as a class named `5rem`.
 */
function selectorTokens(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens: string[] = []
  for (const chunk of withoutComments.split('{')) {
    const prelude = chunk.slice(chunk.lastIndexOf('}') + 1).trim()
    if (prelude === '' || prelude.startsWith('@')) continue
    // The name must start with a letter, which is what excludes a decimal's `.5`.
    // The lookbehind excludes a `.` that is punctuation rather than a class, but
    // deliberately allows a compound selector's second half — `#id.class` — since
    // that is exactly where `#epubsite-progress.htmx-request` lives.
    for (const match of prelude.matchAll(/(?<![\d.-])[#.]([A-Za-z][\w-]*)/g)) {
      tokens.push(match[1] as string)
    }
  }
  return tokens
}

async function shellCss(): Promise<string> {
  return readFile(resolve('src/runtime/shell.css'), 'utf8')
}

describe('the shell stylesheet’s namespace', () => {
  it('namespaces every class and id selector it declares', async () => {
    const tokens = selectorTokens(await shellCss())

    // The detector has to be looking at something, or it proves nothing.
    expect(tokens.length).toBeGreaterThan(40)
    expect(tokens).toContain('epubsite-toc')

    const unnamespaced = tokens.filter(
      (token) => !token.startsWith(PREFIX) && !FOREIGN.has(token),
    )
    expect(unnamespaced).toEqual([])
  })

  it('keeps the exception list honest, so it cannot quietly become a dumping ground', async () => {
    const tokens = new Set(selectorTokens(await shellCss()))
    for (const name of FOREIGN) expect(tokens.has(name)).toBe(true)
  })

  it('reads the prelude and not the declarations', async () => {
    // A declaration carries values with the same punctuation as a selector —
    // colours, decimals, `url(#…)` — so this pins the parse rather than trusting
    // it. Written as its own selector string because that is the shape that would
    // get through a naive scan of the whole file.
    expect(selectorTokens('#epubsite-toc { color: #fff; width: 1.5rem; }')).toEqual(['epubsite-toc'])
    expect(selectorTokens('@media (max-width: 52.5rem) { #epubsite-toc { min-height: 0; } }')).toEqual([
      'epubsite-toc',
    ])
    // And the negative case: an unprefixed class or id is what the rule exists for.
    expect(selectorTokens('.toc-row { display: flex; }')).toEqual(['toc-row'])
    expect(selectorTokens('#toc { overflow: auto; }')).toEqual(['toc'])
  })
})
