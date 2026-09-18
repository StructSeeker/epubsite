/**
 * Command-line parsing (spec §9, C.3.4).
 *
 * Kept separate from the executable so it can be unit-tested without spawning a
 * process. `parseArgs` is used in strict mode, which means an unknown flag is a
 * usage error (exit 2) rather than something silently ignored — a typo in a CI
 * script that produces a *successful* build with the wrong options is the worst
 * possible outcome.
 *
 * `serve` is recognised as a positional rather than through a subcommand
 * framework (C.3.4): one extra keyword does not justify the dependency, and the
 * framework would own the help text, which then has to be kept in sync with §9
 * by hand anyway.
 */
import { parseArgs } from 'node:util'
import { UsageError } from '../build/errors'
import {
  parseBaseUrl,
  type BuildOptions,
  type HostingMode,
  type JsonLdMode,
  type Theme,
} from '../build/options'

export interface CliInvocation {
  command: 'build' | 'serve'
  /**
   * `build`: the book to build. `serve`: the directory to serve, defaulting to
   * the same place `build` writes to.
   */
  positional: string | undefined
  /** Only what the user actually passed; defaults are applied by `resolveOptions`. */
  options: Partial<BuildOptions>
  /** `serve --port`. `0` means "pick a free one". */
  port: number | undefined
  help: boolean
  version: boolean
}

export const HELP_TEXT = `epubsite — publish an EPUB as a static reader, without rewriting it

Usage
  epubsite <book.epub> [options]
  epubsite serve [dir]

Options
  -o, --out <dir>      Output directory (default ./dist, relative to cwd)
      --name <file>    Shell file name (default epubsite.html; not index.html)
      --base-url <url> Where the site will be deployed:
                         "/" or "/sub/"        path form
                         "https://host/sub/"   absolute form, which also lets
                                               the build write the static
                                               JSON-LD url and the landing
                                               page's canonical link
      --hosting <mode> none | 404 | rewrite | all        (default 404)
      --json-ld <mode> full | thin | none                (default full)
      --no-json-ld     Same as --json-ld none
      --search         Build a Pagefind index (appendix D)
      --no-spa         Multi-page site only; do not inject htmx
      --theme <t>      auto | light | dark               (default auto)
      --pagefind <p>   Explicit Pagefind binary, overriding discovery
      --clean          Delete the output directory first
      --force          Write into a non-empty output directory
      --dry-run        Validate and report, but write nothing
      --verbose        Explanatory detail on stderr
      --json           Machine-readable result on stdout
      --port <n>       serve only: port to listen on (default 8080, 0 picks one)
  -h, --help           This text
  -v, --version        Print the version

Exit codes
  0  success        3  invalid EPUB
  2  usage          4  output conflict
                    5  encrypted content

The site root is the EPUB root: the book is copied out unchanged, and the
reader's shell, 404 guide and manifest live in a reserved namespace beside it.
`

/**
 * The flag table, declared as a literal so `parseArgs` can infer a precise type
 * for `values` instead of a `string | boolean | (string | boolean)[]` union that
 * every read would have to narrow by hand.
 */
const CLI_OPTIONS = {
  out: { type: 'string', short: 'o' },
  name: { type: 'string' },
  'base-url': { type: 'string' },
  hosting: { type: 'string' },
  'json-ld': { type: 'string' },
  'no-json-ld': { type: 'boolean' },
  search: { type: 'boolean' },
  'no-spa': { type: 'boolean' },
  theme: { type: 'string' },
  pagefind: { type: 'string' },
  clean: { type: 'boolean' },
  force: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  verbose: { type: 'boolean' },
  json: { type: 'boolean' },
  port: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

function parseCli(argv: readonly string[]) {
  // Strict mode is the point: an unknown flag must be a usage error (exit 2),
  // not something quietly ignored. A typo in a CI script that still produces a
  // successful build with the wrong options is the worst possible outcome.
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: CLI_OPTIONS,
  })
}

type CliParseResult = ReturnType<typeof parseCli>

/**
 * Parses argv (without the node and script entries).
 *
 * @throws {UsageError} for an unknown flag, a malformed value, or a missing
 *   argument — all exit 2.
 */
export function parseCliArgs(argv: readonly string[]): CliInvocation {
  let parsed: CliParseResult
  try {
    parsed = parseCli(argv)
  } catch (cause) {
    // parseArgs reports "Unknown option '--ou'" and similar. Rewrapping it keeps
    // the exit code decision in one place (`EpubSiteError.exitCode`) instead of
    // leaving the CLI to recognise a foreign error type.
    throw new UsageError(cause instanceof Error ? cause.message : String(cause), { cause })
  }

  const values = parsed.values
  const positionals = parsed.positionals

  const command = positionals[0] === 'serve' ? 'serve' : 'build'
  const positional = command === 'serve' ? positionals[1] : positionals[0]
  const extra = command === 'serve' ? positionals.slice(2) : positionals.slice(1)
  if (extra.length > 0) {
    throw new UsageError(`unexpected argument: ${extra[0]}`)
  }

  const options: Partial<BuildOptions> = {}
  if (values.out !== undefined) options.out = values.out
  if (values.name !== undefined) options.name = values.name
  if (values['base-url'] !== undefined) options.baseUrl = parseBaseUrl(values['base-url'])
  if (values.hosting !== undefined) options.hosting = values.hosting as HostingMode
  // `--no-json-ld` is the negation of `--json-ld`, so it wins when both appear:
  // the explicit off switch is never accidental, whereas a stray `--json-ld` in
  // a shared script can be.
  if (values['no-json-ld'] === true) options.jsonLd = 'none'
  else if (values['json-ld'] !== undefined) options.jsonLd = values['json-ld'] as JsonLdMode
  if (values.search === true) options.search = true
  if (values['no-spa'] === true) options.spa = false
  if (values.theme !== undefined) options.theme = values.theme as Theme
  if (values.pagefind !== undefined) options.pagefind = values.pagefind
  if (values.clean === true) options.clean = true
  if (values.force === true) options.force = true
  if (values['dry-run'] === true) options.dryRun = true
  if (values.verbose === true) options.verbose = true
  if (values.json === true) options.json = true

  return {
    command,
    positional,
    options,
    port: parsePort(values.port),
    help: values.help === true,
    version: values.version === true,
  }
}

/** `--port` as a number, or `undefined` when it was not given. */
function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (!/^\d+$/.test(raw.trim())) {
    throw new UsageError(`--port must be a number, got: ${raw}`)
  }
  const port = Number.parseInt(raw, 10)
  if (port > 65535) throw new UsageError(`--port must be at most 65535, got: ${port}`)
  return port
}
