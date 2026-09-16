/**
 * Pagefind integration (spec appendix D, §D.3).
 *
 * Pagefind is **not a dependency of this package** — not a dependency, not a
 * peer, not an optional one. It is a separate program that the user's machine
 * provides, and the build finds it or does without:
 *
 *   1. `--pagefind <path>`
 *   2. `node_modules/.bin/pagefind`, walking up from the caller's cwd
 *   3. `npx --no-install pagefind`   (a local install, no network)
 *   4. `npx --yes pagefind`          (downloads it)
 *
 * Step 4 is the only one that touches the network, and it is last for that
 * reason. Making Pagefind a dependency instead would put a ~30 MB Rust binary in
 * every install, for a feature most books do not use.
 *
 * **Failure warns and continues.** §D.3 is explicit: a missing index degrades a
 * site, it does not invalidate one. Every other build defect here is an error
 * because the artifact would be wrong; a missing search index produces a site
 * that is entirely correct and has no search.
 *
 * Two decisions that are not obvious:
 *
 *   - **The config file, not arguments.** Pagefind is a Rust binary, and on
 *     Windows it is reached through a `.cmd` shim; passing a hundred-character
 *     brace-expanded glob through two layers of shell quoting is a class of bug
 *     that does not exist when the pattern is written to a file. The config is
 *     written into a temporary directory that becomes the process's cwd, so
 *     `pagefind.yml` is picked up without being asked for.
 *   - **`--glob` is derived from the spine.** Pagefind's default is a recursive
 *     glob over every `.html` file, which would also index the shell, the transit
 *     page and the 404 guide — documents that are *about* the book rather than
 *     part of it. The obvious tool for excluding them, `data-pagefind-body`, is
 *     banned: it is a site-wide switch, so putting it on the shell would drop
 *     every chapter from the index (§5.1, §D.2).
 */
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { RESERVED_PATHS, SHELL_ASSETS } from '../../shared/paths'
import { warn, type Diagnostics } from '../diagnostics'

export interface SearchOptions {
  /** The built site. */
  siteDir: string
  /** `--pagefind`, when given. */
  explicitPath: string | undefined
  /** Entry paths of the spine documents, in reading order. */
  chapterPaths: readonly string[]
  /** The caller's cwd, for the walk-up search. */
  cwd: string
}

export interface SearchOutcome {
  indexed: boolean
  /** Site-relative directory of the bundle, when one was produced. */
  outputDir: string
}

/**
 * Where the bundle goes, inside the reserved namespace (§3.1).
 *
 * `--output-path` is resolved against the *working directory of the command*,
 * which is why the config carries an absolute path: a relative one would land
 * inside the temporary config directory and be deleted with it.
 */
const OUTPUT_DIR = `${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.pagefindDir.replace(/\/$/, '')}`

export async function buildSearchIndex(
  options: SearchOptions,
  diagnostics: Diagnostics,
): Promise<SearchOutcome> {
  const command = await resolvePagefind(options, diagnostics)
  if (command === null) {
    warn(
      diagnostics,
      'W_SEARCH_UNAVAILABLE',
      'search was requested but no Pagefind could be found: not on --pagefind, not in ' +
        'node_modules, and npx could not fetch it. The site is complete and correct; it ' +
        'simply has no search index.',
    )
    return { indexed: false, outputDir: '' }
  }

  const glob = searchGlob(options.chapterPaths, diagnostics)
  const workspace = await mkdtemp(join(tmpdir(), 'epubsite-pagefind-'))
  const outputPath = resolve(options.siteDir, OUTPUT_DIR)

  try {
    await writeFile(
      join(workspace, 'pagefind.yml'),
      [
        `site: ${yamlString(resolve(options.siteDir))}`,
        `output_path: ${yamlString(outputPath)}`,
        `glob: ${yamlString(glob)}`,
        // The shell is excluded by the glob; this is the belt to that braces's
        // pair, and it matters when the glob falls back to a wildcard.
        'exclude_selectors:',
        '  - "[data-pagefind-ignore]"',
        '',
      ].join('\n'),
      'utf8',
    )

    const result = await run(command, [], workspace)
    if (result.code !== 0) {
      warn(
        diagnostics,
        'W_SEARCH_FAILED',
        `Pagefind exited with code ${result.code}: ${firstLine(result.stderr) || firstLine(result.stdout)}`,
      )
      return { indexed: false, outputDir: '' }
    }
  } catch (error) {
    warn(
      diagnostics,
      'W_SEARCH_FAILED',
      `could not run Pagefind: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { indexed: false, outputDir: '' }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }

  return { indexed: true, outputDir: OUTPUT_DIR }
}

/**
 * The `--glob` for the spine's documents.
 *
 * A brace-expanded alternation of the book's own chapter paths is exact: it
 * indexes every chapter and nothing else, whatever extension the book chose.
 * The length is not a problem because the pattern travels in a config file
 * rather than on a command line — which is why the config file exists.
 *
 * The fallback is for a book so large that the pattern itself becomes
 * unreasonable. Pagefind's default glob — every `.html` file, recursively — then
 * also sweeps in the shell, the transit page and the 404 guide; the warning says
 * so rather than letting the index quietly fill with documents about the book.
 */
const GLOB_LIMIT = 8000

export function searchGlob(chapterPaths: readonly string[], diagnostics: Diagnostics): string {
  const html = chapterPaths.filter((path) => /\.x?html$/i.test(path))
  if (html.length === 0) {
    warn(
      diagnostics,
      'W_SEARCH_NO_DOCUMENTS',
      'the spine contains no HTML documents, so there is nothing to index.',
    )
    return '**/*.{xhtml,html}'
  }

  const pattern = `{${html.join(',')}}`
  if (pattern.length <= GLOB_LIMIT) return pattern

  warn(
    diagnostics,
    'W_SEARCH_GLOB_FALLBACK',
    `the spine is too large to express as a single glob (${pattern.length} characters), so ` +
      'search is indexing every HTML file in the site. The shell, the transit page and the ' +
      '404 guide will appear in results.',
  )
  return '**/*.{xhtml,html}'
}

/**
 * Finds a Pagefind to run.
 *
 * `node_modules` is searched upwards from the caller's cwd rather than from this
 * package, because the *user's* project is where a Pagefind would be installed —
 * this package deliberately has none.
 */
async function resolvePagefind(
  options: SearchOptions,
  diagnostics: Diagnostics,
): Promise<Command | null> {
  if (options.explicitPath !== undefined) {
    if (existsSync(options.explicitPath)) return { file: options.explicitPath, args: [] }
    warn(
      diagnostics,
      'W_SEARCH_PATH_MISSING',
      `--pagefind points at a file that does not exist: ${options.explicitPath}`,
    )
    return null
  }

  const local = findLocalPagefind(options.cwd)
  if (local !== null) return local

  // `npx --no-install` first: it uses a copy that is already on the machine and
  // fails immediately otherwise, so the network is only touched when there is
  // genuinely nothing local.
  const probe = ['--version']
  if (await canRun(NPX, ['--no-install', 'pagefind', ...probe])) {
    return { file: NPX, args: [] }
  }
  if (await canRun(NPX, ['--yes', 'pagefind', ...probe])) {
    warn(
      diagnostics,
      'W_SEARCH_DOWNLOADED',
      'no local Pagefind was found, so one is being fetched with npx. Install it in your ' +
        'project to make this build reproducible and offline.',
    )
    return { file: NPX, args: [] }
  }

  return null
}

/**
 * The locally installed Pagefind, as something we can actually execute.
 *
 * Note what is tried **first**: the package's own `bin` entry point, which is a
 * Node script, run with the interpreter already in hand. That path involves no
 * shell at all, and it is the one every normal build takes — which matters,
 * because the alternative shape is the `node_modules/.bin` shim, and on Windows
 * that shim is a `.cmd` file that cannot be executed without a shell.
 *
 * The entry point is *read* from `pagefind`'s manifest rather than hard-coded.
 * Guessing `lib/runner/bin.cjs` would couple us to a path Pagefind is free to
 * change; reading its declared `bin` asks it the question instead.
 */
function findLocalPagefind(start: string): Command | null {
  let current = resolve(start)

  for (;;) {
    const modules = join(current, 'node_modules')

    const entry = declaredBinEntry(join(modules, 'pagefind'))
    if (entry !== null) return { file: process.execPath, args: [entry] }

    for (const name of shimNames()) {
      const candidate = join(modules, '.bin', name)
      if (existsSync(candidate)) return { file: candidate, args: [] }
    }

    const parent = resolve(current, '..')
    if (parent === current) return null
    current = parent
  }
}

/**
 * The `bin` target an installed package declares, when it is a JavaScript file.
 *
 * Returns `null` for anything else, including a package whose `bin` is a native
 * executable — that is not ours to run by interpretation.
 */
function declaredBinEntry(packageDir: string): string | null {
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest)) return null

  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null

    const bin: unknown = (parsed as { bin?: unknown }).bin
    const declared =
      typeof bin === 'string'
        ? bin
        : typeof bin === 'object' && bin !== null
          ? (bin as Record<string, unknown>)['pagefind']
          : undefined

    if (typeof declared !== 'string') return null
    const entry = join(packageDir, declared)
    return /\.c?js$/.test(entry) && existsSync(entry) ? entry : null
  } catch {
    // A malformed manifest is not this function's problem to report: the caller
    // falls through to the shim, and ultimately to `npx`.
    return null
  }
}

/**
 * `.bin` names to try, in preference order.
 *
 * `pagefind.exe` beats `pagefind.cmd` because it needs no shell. The extensionless
 * name is a POSIX shell script, so it is not offered on Windows at all.
 */
function shimNames(): readonly string[] {
  return process.platform === 'win32' ? ['pagefind.exe', 'pagefind.cmd'] : ['pagefind']
}

/**
 * The `npx` on `PATH`, which on Windows is a batch shim and therefore needs the
 * special handling in {@link spawnCommand}.
 */
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

/** True when the command runs and exits 0. Used only for probing. */
function canRun(command: string, args: readonly string[]): Promise<boolean> {
  return run({ file: command, args: [] }, args, undefined).then((result) => result.code === 0)
}

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

interface Command {
  readonly file: string
  /** Arguments that always precede this command's own, such as a script path. */
  readonly args: readonly string[]
}

function run(command: Command, args: readonly string[], cwd: string | undefined): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawnCommand(command, args, cwd)

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', (error) => done({ code: -1, stdout, stderr: `${stderr}${String(error)}` }))
    child.on('close', (code) => done({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * Starts a process **without** `shell: true`, which is what DEP0190 is about.
 *
 * The deprecation warns about passing an argument array to a shell, because those
 * arguments are concatenated rather than escaped — so an argument containing `&`
 * or a quote becomes part of the command line. Node's guidance is to stop doing
 * it, and the way to stop is not to write our own concatenation but to not involve
 * a shell: a real executable receives its arguments as a vector, and there is
 * nothing left to escape.
 *
 * That holds for everything except one platform detail. Windows can only create a
 * process from a PE image, so a `.cmd` shim — a batch file — cannot be spawned
 * directly, and `npx.cmd` is exactly that. There the shell is unavoidable, so it
 * is invoked deliberately and explicitly, with the finished command line passed as
 * a single argument.
 *
 * The arguments reaching that path are this module's own literals. Nothing from
 * the book is ever placed on a command line: the one piece of book-derived text,
 * the index glob, travels in `pagefind.yml`.
 */
function spawnCommand(
  command: Command,
  args: readonly string[],
  cwd: string | undefined,
): ChildProcessWithoutNullStreams {
  const options: SpawnOptions = {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${process.env['PATH'] ?? ''}${delimiter}${resolve('.')}` },
  }

  const argv = [...command.args, ...args]
  if (!isBatchFile(command.file)) {
    // `stdio` above is a fixed pipe/pipe/pipe, so stdout and stderr are never
    // null; the assertion states that once here instead of at every read.
    return spawn(command.file, argv, options) as ChildProcessWithoutNullStreams
  }

  const shell = process.env['ComSpec'] ?? 'cmd.exe'
  return spawn(shell, ['/d', '/s', '/c', quoteCommandLine([command.file, ...argv])], options) as ChildProcessWithoutNullStreams
}

function isBatchFile(file: string): boolean {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file)
}

/**
 * Quotes a command line for `cmd.exe`.
 *
 * `cmd` is not `sh`, and its rules are stranger. What quoting does buy:
 * whitespace and the metacharacters `& | < > ( ) ^ * , ; =` are neutralised, and
 * an embedded `"` is written by doubling it.
 *
 * What quoting does **not** buy, and must not be assumed to: `%`. Percent
 * expansion does not care about double quotes — `"%PATH%"` expands — and there is
 * no way to escape a percent on a command line the way `%%` escapes one inside a
 * batch file. So an argument containing `%` is *not* made safe by this function;
 * it is merely quoted, and the expansion still happens.
 *
 * The consequence is a constraint on callers rather than a defect here: this
 * helper may only ever be handed literals the program itself controls. The one
 * caller satisfies that by construction — the batch path is reached only for
 * `npx.cmd` with this module's own arguments, and the single piece of
 * book-derived text, the index glob, travels in `pagefind.yml` instead of on a
 * command line. Anything user-supplied added to that path later would be a
 * command injection, and the quoting above would not save it.
 */
function quoteCommandLine(parts: readonly string[]): string {
  return parts.map((part) => (isPlain(part) ? part : `"${part.replace(/"/g, '""')}"`)).join(' ')
}

/**
 * True for arguments that need no quoting.
 *
 * `%` is listed for the opposite reason to the others: not because quoting fixes
 * it, but because it marks an argument as one this function cannot make safe. See
 * {@link quoteCommandLine}.
 */
function isPlain(part: string): boolean {
  return part !== '' && !/[\s"^&|<>()%!*,;=]/.test(part)
}

/** YAML scalars need quoting once a value contains a colon and a space, or a backslash. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '/').replace(/"/g, '\\"')}"`
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}
