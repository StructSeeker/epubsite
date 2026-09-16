/**
 * The one piece of CSS we have to understand (spec §4.4, §5.5).
 *
 * A chapter's inline `<style>` may open with `@import`. That matters because
 * `@import` is **illegal inside a `@layer` block**, and the shell wraps chapter
 * styles in `@layer epub { … }` to keep them below its own rules. So an
 * `@import` left in the body would be dropped by the browser, silently: the
 * chapter's stylesheet would simply never load, and the page would look almost
 * right.
 *
 * Hence this extraction. It is a scanner rather than a regular expression
 * because `@import` can appear inside a string, inside a comment, or nested in
 * a block — and rewriting one of those would be worse than not finding it.
 * Braces, quotes and comments are all tracked, which is the whole of the
 * difficulty and the reason it is worth its own module and its own tests.
 *
 * `url()` rewriting is deliberately **not** done here; see the note at the
 * bottom of this file.
 */

export interface SplitCss {
  /** `@import` rules found at the top level, trimmed, without the trailing `;`. */
  imports: string[]
  /** Everything else, in order, with the imports removed. */
  body: string
}

export function splitTopLevelImports(css: string): SplitCss {
  const imports: string[] = []
  const body: string[] = []

  let index = 0
  let depth = 0
  let chunkStart = 0

  while (index < css.length) {
    const char = css[index] as string

    // Comments and strings are skipped wholesale: an `@import` inside either is
    // text, not a rule, and a braces count taken across them would be wrong.
    if (char === '/' && css[index + 1] === '*') {
      index = endOfComment(css, index + 2)
      continue
    }
    if (char === '"' || char === "'") {
      index = endOfString(css, index + 1, char)
      continue
    }

    if (char === '{') depth += 1
    else if (char === '}') depth = Math.max(0, depth - 1)

    if (depth === 0 && startsImport(css, index)) {
      const end = css.indexOf(';', index)
      if (end === -1) break // malformed to the end of the sheet: leave it alone
      body.push(css.slice(chunkStart, index))
      imports.push(css.slice(index, end).trim())
      index = end + 1
      chunkStart = index
      continue
    }

    index += 1
  }

  body.push(css.slice(chunkStart))
  return { imports, body: body.join('') }
}

/**
 * True for `@import` as a whole at-rule, not as the prefix of a longer word.
 *
 * The distinction is not hypothetical: `@import` and `@importsomething` are
 * different at-rules, and the second does not exist, so a sloppy `startsWith`
 * would move a live rule into a block where it is invalid.
 */
function startsImport(css: string, index: number): boolean {
  if (!css.startsWith('@import', index)) return false
  const after = css[index + '@import'.length]
  return after === undefined || /[\s('"]/.test(after)
}

function endOfComment(css: string, from: number): number {
  const end = css.indexOf('*/', from)
  return end === -1 ? css.length : end + 2
}

function endOfString(css: string, from: number, quote: string): number {
  let index = from
  while (index < css.length) {
    const char = css[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) return index + 1
    index += 1
  }
  return css.length
}

/**
 * Why inline `url()` references are left alone.
 *
 * §5.5 requires the `@import` entry URL to be absolute, because the document
 * base changes with every navigation. `url()` has the same base — and there it
 * stays relative, on purpose.
 *
 * The difference is that an `@import` target is known at build time, so making
 * it absolute is free. A `url()` target can only be made absolute by the
 * runtime, which would mean re-writing CSS text on every chapter change, or by
 * baking an origin into the artifact — which is exactly what I4 forbids.
 *
 * Leaving it relative is correct rather than lucky: the stylesheet is created
 * while the document base is the chapter's own URL, because the runtime injects
 * it *after* navigation has settled (§5.4.2's `afterSwap`/`historyRestore`).
 * Relative references therefore resolve against the directory the chapter came
 * from, which is the directory they were written for. That invariant — style
 * injection follows base movement — is what the `afterSwap` timing tests pin
 * down, and it is the reason §5.4.1 puts `replaceState` before everything else.
 */
