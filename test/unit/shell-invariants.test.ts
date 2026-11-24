/**
 * The shell's body box, and the layer that makes it hold (spec §5.5, §5.10).
 *
 * The failure this guards against is a real book, not a hypothetical one: Heydon
 * Pickering's *Every Layout* ships
 *
 *     @media (min-width: 800px) { body { max-inline-size: 68ch } }
 *
 * and the shell never declared `max-inline-size` at all. Layer order only
 * settles *conflicts* (§5.5), so the book's unopposed rule turned a 1038px
 * two-pane viewport into a 638px column with 400px of blank screen beside it.
 *
 * The fix is a layer declared before `epub`, because `!important` reverses layer
 * order: an `!important` in `@layer epub` beats one in `@layer shell`, and only
 * an earlier layer beats *that*. Being first is exactly what makes it the
 * weakest layer for normal declarations — so a plain declaration in there would
 * silently lose to the book. That is the rule this file exists to keep: the
 * stylesheet's own convention is checkable, and a convention nothing checks
 * rots (the same argument as `shell-namespace.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const LAYER = 'shell-invariants'

async function shellCss(): Promise<string> {
  return readFile(resolve('src/runtime/shell.css'), 'utf8')
}

/**
 * The contents of `@layer <name> { … }`, found by brace matching.
 *
 * The layer *statement* — `@layer shell-invariants, epub, shell;` — is not a
 * block, and requiring a brace after the name is what keeps the two apart.
 * Comments are removed first: the block's comments quote declarations, and a
 * quoted one must not be mistaken for a live one.
 */
function layerBlock(css: string, name: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = source.indexOf(`@layer ${name} {`)
  if (start === -1) throw new Error(`shell.css has no @layer ${name} block`)

  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error(`the @layer ${name} block is not closed`)
}

/** Every declaration in the block, comments already removed. */
function declarations(block: string): string[] {
  return [...block.matchAll(/\{([^{}]*)\}/g)]
    .flatMap((match) => (match[1] ?? '').split(';'))
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '')
}

describe('the shell stylesheet’s layout invariants', () => {
  it('declares its layer before epub, so its !important outranks the book’s', async () => {
    const css = await shellCss()
    const statement = /^@layer ([^;]+);/m.exec(css)

    expect(statement?.[1]?.split(',').map((name) => name.trim())).toEqual([
      LAYER,
      'epub',
      'shell',
    ])
  })

  it('puts every declaration behind !important', async () => {
    const block = layerBlock(await shellCss(), LAYER)
    const found = declarations(block)

    // Non-vacuous: the layer has to be doing work on a body that has properties.
    expect(found.length).toBeGreaterThan(20)
    const plain = found.filter((declaration) => !declaration.endsWith('!important'))
    expect(plain).toEqual([])
  })

  it('declares the box of html and body, including the size a book can spoil', async () => {
    const block = layerBlock(await shellCss(), LAYER)
    const found = declarations(block)

    expect(block).toMatch(/(^|[\s;])html\s*\{/)
    expect(block).toMatch(/(^|[\s;])body\s*\{/)
    // The exact property the Every Layout stylesheet set and the shell had not.
    expect(found).toContain('max-inline-size: none !important')
    expect(found).toContain('display: grid !important')
  })

  it('keeps the narrow-view override in the same layer, or the base rule wins', async () => {
    // Both declarations are `!important` and in the same layer, so source order
    // decides — and it only decides inside the layer. Left in `@layer shell`, the
    // one-track rule would lose to the two-track rule above it and a tablet in
    // portrait would keep the permanent sidebar.
    const block = layerBlock(await shellCss(), LAYER)

    expect(block).toContain('@media (max-width: 52.5rem)')
    expect(declarations(block)).toContain('grid-template-columns: minmax(0, 1fr) !important')
  })
})
