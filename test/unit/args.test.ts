/**
 * CLI parsing (spec §9, C.3.4).
 *
 * The rule that matters most here is strictness: an unknown flag must stop the
 * build. A CI script with a typo that produces a *successful* build with the
 * wrong options is worse than one that fails, because nobody looks.
 */
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../../src/bin/args'
import { UsageError } from '../../src/build/errors'

describe('parseCliArgs — command and positionals', () => {
  it('treats the first positional as the book', () => {
    const parsed = parseCliArgs(['book.epub'])
    expect(parsed.command).toBe('build')
    expect(parsed.positional).toBe('book.epub')
  })

  it('recognises serve as a subcommand, with an optional directory', () => {
    expect(parseCliArgs(['serve']).command).toBe('serve')
    expect(parseCliArgs(['serve']).positional).toBeUndefined()
    expect(parseCliArgs(['serve', 'dist']).positional).toBe('dist')
  })

  it('rejects a second positional instead of silently ignoring it', () => {
    expect(() => parseCliArgs(['a.epub', 'b.epub'])).toThrow(UsageError)
    expect(() => parseCliArgs(['serve', 'dist', 'extra'])).toThrow(UsageError)
  })

  it('passes no defaults: what the user did not say is not in the result', () => {
    expect(parseCliArgs(['book.epub']).options).toEqual({})
  })
})

describe('parseCliArgs — options', () => {
  it('accepts both the short and the long form of --out', () => {
    expect(parseCliArgs(['b.epub', '-o', 'site']).options.out).toBe('site')
    expect(parseCliArgs(['b.epub', '--out', 'site']).options.out).toBe('site')
  })

  it('maps --no-spa onto the positive option', () => {
    expect(parseCliArgs(['b.epub', '--no-spa']).options.spa).toBe(false)
  })

  it('lets --no-json-ld win over --json-ld, whichever order they appear in', () => {
    // The explicit off switch is never accidental; a stray `--json-ld` in a
    // shared script can be.
    expect(parseCliArgs(['b.epub', '--no-json-ld', '--json-ld', 'full']).options.jsonLd).toBe('none')
    expect(parseCliArgs(['b.epub', '--json-ld', 'full', '--no-json-ld']).options.jsonLd).toBe('none')
    expect(parseCliArgs(['b.epub', '--json-ld', 'thin']).options.jsonLd).toBe('thin')
  })

  it('parses --base-url through the same normaliser the library uses', () => {
    expect(parseCliArgs(['b.epub', '--base-url', '/sub']).options.baseUrl).toEqual({
      form: 'path',
      href: '/sub/',
    })
    expect(() => parseCliArgs(['b.epub', '--base-url', 'nonsense'])).toThrow(UsageError)
  })

  it('carries the boolean switches through', () => {
    const options = parseCliArgs([
      'b.epub',
      '--search',
      '--clean',
      '--force',
      '--dry-run',
      '--verbose',
      '--json',
    ]).options
    expect(options).toMatchObject({
      search: true,
      clean: true,
      force: true,
      dryRun: true,
      verbose: true,
      json: true,
    })
  })

  it('leaves an unpassed switch out rather than setting it to false', () => {
    expect('force' in parseCliArgs(['b.epub']).options).toBe(false)
  })
})

describe('parseCliArgs — failures are usage errors, exit 2', () => {
  it('rejects an unknown flag', () => {
    expect(() => parseCliArgs(['b.epub', '--ou', 'x'])).toThrow(UsageError)
    expect(exitCodeOf(() => parseCliArgs(['b.epub', '--nope']))).toBe(2)
  })

  it('rejects a flag that needs a value and did not get one', () => {
    expect(() => parseCliArgs(['b.epub', '--out'])).toThrow(UsageError)
  })

  it('does not touch the exit code the library would use', () => {
    const error = capture(() => parseCliArgs(['--nope']))
    expect(error).toMatchObject({ code: 'E_USAGE', exitCode: 2 })
  })
})

describe('parseCliArgs — help and version', () => {
  it('reports help for -h and --help', () => {
    expect(parseCliArgs(['-h']).help).toBe(true)
    expect(parseCliArgs(['--help']).help).toBe(true)
  })

  it('reports the version request', () => {
    expect(parseCliArgs(['--version']).version).toBe(true)
  })

  it('does not require a book when help was asked for', () => {
    expect(parseCliArgs([]).positional).toBeUndefined()
    expect(parseCliArgs([]).help).toBe(false)
  })
})

function exitCodeOf(run: () => unknown): number {
  const error = capture(run)
  return typeof error === 'object' && error !== null && 'exitCode' in error
    ? Number((error as { exitCode: unknown }).exitCode)
    : 0
}

function capture(run: () => unknown): unknown {
  try {
    run()
    return undefined
  } catch (error) {
    return error
  }
}
