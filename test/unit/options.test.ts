import { describe, expect, it } from 'vitest'
import { isEpubSiteError, exitCodeFor, UsageError } from '../../src/build/errors'
import {
  absoluteBase,
  DEFAULT_OPTIONS,
  parseBaseUrl,
  resolveOptions,
  validateShellName,
} from '../../src/build/options'

describe('resolveOptions', () => {
  it('applies the documented defaults', () => {
    const options = resolveOptions()
    expect(options.out).toBe('./dist')
    expect(options.name).toBe('epubsite.html')
    expect(options.hosting).toBe('404')
    expect(options.jsonLd).toBe('full')
    expect(options.spa).toBe(true)
    expect(options.baseUrl).toEqual({ form: 'path', href: '/' })
  })

  it('rejects an empty output directory', () => {
    expect(() => resolveOptions({ out: '  ' })).toThrow(/--out/)
  })

  it('rejects unknown enum values', () => {
    expect(() => resolveOptions({ hosting: 'magic' as never })).toThrow(/--hosting/)
    expect(() => resolveOptions({ jsonLd: 'fat' as never })).toThrow(/--json-ld/)
    expect(() => resolveOptions({ theme: 'sepia' as never })).toThrow(/--theme/)
  })

  it('accepts rewrite as a valid value even though the feature is stubbed', () => {
    // The stub lives in the build, not in option validation, so the failure
    // message can explain *why* it is unavailable.
    expect(resolveOptions({ hosting: 'rewrite' }).hosting).toBe('rewrite')
  })
})

describe('validateShellName', () => {
  it('rejects index.html, non-html names and paths', () => {
    expect(() => validateShellName('index.html')).toThrow(/index\.html/)
    expect(() => validateShellName('INDEX.HTML')).toThrow(/index\.html/)
    expect(() => validateShellName('reader.htm')).toThrow(/\.html/)
    expect(() => validateShellName('sub/epubsite.html')).toThrow(/bare file name/)
    expect(() => validateShellName('sub\\epubsite.html')).toThrow(/bare file name/)
    expect(() => validateShellName('')).toThrow()
  })

  it('accepts a normal name', () => {
    expect(() => validateShellName('epubsite.html')).not.toThrow()
    expect(() => validateShellName('reader.html')).not.toThrow()
  })
})

describe('parseBaseUrl', () => {
  it('normalises the path form to a trailing slash', () => {
    expect(parseBaseUrl('/')).toEqual({ form: 'path', href: '/' })
    expect(parseBaseUrl('/sub')).toEqual({ form: 'path', href: '/sub/' })
    expect(parseBaseUrl('/sub/')).toEqual({ form: 'path', href: '/sub/' })
  })

  it('normalises the absolute form and keeps the origin', () => {
    expect(parseBaseUrl('https://example.com')).toEqual({
      form: 'absolute',
      href: 'https://example.com/',
    })
    expect(parseBaseUrl('https://example.com/mybook')).toEqual({
      form: 'absolute',
      href: 'https://example.com/mybook/',
    })
  })

  it('rejects bare relative paths, non-http schemes and query strings', () => {
    expect(() => parseBaseUrl('sub/')).toThrow(/"\/"/)
    expect(() => parseBaseUrl('ftp://example.com/')).toThrow(/http or https/)
    expect(() => parseBaseUrl('https://example.com/?a=1')).toThrow(/query string/)
    expect(() => parseBaseUrl('')).toThrow(/must not be empty/)
  })

  it('exposes the absolute form only when there really is an origin', () => {
    expect(absoluteBase(resolveOptions({ baseUrl: parseBaseUrl('/sub/') }))).toBeUndefined()
    expect(
      absoluteBase(resolveOptions({ baseUrl: parseBaseUrl('https://example.com/sub/') })),
    ).toBe('https://example.com/sub/')
  })
})

describe('error taxonomy (spec §9.2)', () => {
  it('maps each error class to its documented exit code', () => {
    expect(new UsageError('x').exitCode).toBe(2)
    expect(exitCodeFor(new Error('boom'))).toBe(1)
    expect(exitCodeFor(undefined)).toBe(1)
  })

  it('is recognisable without instanceof gymnastics at the CLI boundary', () => {
    const error = new UsageError('bad flag')
    expect(isEpubSiteError(error)).toBe(true)
    expect(error.code).toBe('E_USAGE')
    expect(isEpubSiteError(new Error('nope'))).toBe(false)
  })

  it('carries a stable code and an optional location', () => {
    const error = new UsageError('bad', { where: '--name' })
    expect(error.where).toBe('--name')
    expect(new UsageError('bad').where).toBeUndefined()
  })
})

describe('DEFAULT_OPTIONS', () => {
  it('is not mutated by resolveOptions', () => {
    resolveOptions({ out: './elsewhere' })
    expect(DEFAULT_OPTIONS.out).toBe('./dist')
  })
})
