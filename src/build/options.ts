/**
 * CLI options, their defaults, and their validation (spec §9, §C.3.1).
 *
 * `BuildOptions` is plain data. `resolveOptions` is the only place that turns
 * user input into it, and it is pure so every validation rule is unit-testable
 * without touching a filesystem.
 */
import { UsageError } from './errors'

export type HostingMode = 'none' | '404' | 'rewrite' | 'all'
export type JsonLdMode = 'full' | 'thin' | 'none'
export type Theme = 'auto' | 'light' | 'dark'

export type BaseUrlForm = 'path' | 'absolute'

export interface BaseUrl {
  /** Which form the user gave; determines what output is *possible* (§7.5). */
  form: BaseUrlForm
  /** Normalised, always with a trailing slash. */
  href: string
}

export interface BuildOptions {
  /** Default `./dist`, relative to the caller's cwd — never the package. */
  out: string
  /** Shell file name. Must not be `index.html` (§9). */
  name: string
  baseUrl: BaseUrl
  hosting: HostingMode
  jsonLd: JsonLdMode
  /** `--search`: generate a Pagefind index (appendix D). */
  search: boolean
  /** `--no-spa`: multi-page site only, no htmx. */
  spa: boolean
  theme: Theme
  clean: boolean
  force: boolean
  dryRun: boolean
  verbose: boolean
  /** `--json`: machine-readable result on stdout (§C.3.2). */
  json: boolean
  /** Explicit Pagefind binary, overriding discovery (appendix D.3). */
  pagefind: string | undefined
}

export const DEFAULT_OPTIONS: BuildOptions = {
  out: './dist',
  name: 'epubsite.html',
  baseUrl: { form: 'path', href: '/' },
  hosting: '404',
  jsonLd: 'full',
  search: false,
  spa: true,
  theme: 'auto',
  clean: false,
  force: false,
  dryRun: false,
  verbose: false,
  json: false,
  pagefind: undefined,
}

const HOSTING_MODES: readonly HostingMode[] = ['none', '404', 'rewrite', 'all']
const JSON_LD_MODES: readonly JsonLdMode[] = ['full', 'thin', 'none']
const THEMES: readonly Theme[] = ['auto', 'light', 'dark']

/**
 * Parses `--base-url` (spec §9).
 *
 * The two forms are not cosmetic: only the absolute form can produce output
 * that needs an origin (canonical, JSON-LD `url`, og:image), because a relative
 * URL is semantically weak in JSON-LD (§7.5).
 */
export function parseBaseUrl(raw: string): BaseUrl {
  const trimmed = raw.trim()
  if (trimmed === '') throw new UsageError('--base-url must not be empty')

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      throw new UsageError(`--base-url is not a valid absolute URL: ${raw}`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new UsageError(`--base-url must use http or https, got ${url.protocol}`)
    }
    if (url.search !== '' || url.hash !== '') {
      throw new UsageError('--base-url must not contain a query string or fragment')
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    return { form: 'absolute', href: url.href }
  }

  if (!trimmed.startsWith('/')) {
    throw new UsageError(
      `--base-url must start with "/" (path form) or be an absolute URL, got: ${raw}`,
    )
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new UsageError('--base-url must not contain a query string or fragment')
  }
  return { form: 'path', href: trimmed.endsWith('/') ? trimmed : `${trimmed}/` }
}

/** Validates and fills in defaults. Throws `UsageError` (exit 2) on bad input. */
export function resolveOptions(partial: Partial<BuildOptions> = {}): BuildOptions {
  const merged: BuildOptions = { ...DEFAULT_OPTIONS, ...partial }

  if (typeof merged.out !== 'string' || merged.out.trim() === '') {
    throw new UsageError('--out must be a non-empty directory path')
  }

  validateShellName(merged.name)

  if (!HOSTING_MODES.includes(merged.hosting)) {
    throw new UsageError(`--hosting must be one of ${HOSTING_MODES.join('|')}, got ${merged.hosting}`)
  }
  if (!JSON_LD_MODES.includes(merged.jsonLd)) {
    throw new UsageError(`--json-ld must be one of ${JSON_LD_MODES.join('|')}, got ${merged.jsonLd}`)
  }
  if (!THEMES.includes(merged.theme)) {
    throw new UsageError(`--theme must be one of ${THEMES.join('|')}, got ${merged.theme}`)
  }

  return merged
}

/**
 * The shell name must be a bare file name, and must not be `index.html` (§9):
 * a shell called `index.html` would silently take over the site root and shadow
 * the transit page's role.
 */
export function validateShellName(name: string): void {
  if (name.trim() === '') throw new UsageError('--name must not be empty')
  if (name.includes('/') || name.includes('\\')) {
    throw new UsageError(`--name must be a bare file name, got: ${name}`)
  }
  if (!name.toLowerCase().endsWith('.html')) {
    throw new UsageError(`--name must end in .html, got: ${name}`)
  }
  if (name.toLowerCase() === 'index.html') {
    throw new UsageError('--name must not be index.html: it would shadow the site root (§9)')
  }
}

/** The absolute base URL, or `undefined` in path form — what §7.5 keys on. */
export function absoluteBase(options: BuildOptions): string | undefined {
  return options.baseUrl.form === 'absolute' ? options.baseUrl.href : undefined
}
