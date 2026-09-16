/**
 * The `epubsite` executable (spec §9, §9.3, C.3.1, C.3.2).
 *
 * This is a thin shell, and the thinness is the design: every decision with a
 * consequence lives in the library, so that the exit code is a property of a
 * typed error rather than of a branch here, and so the same code path runs
 * whether the tool is invoked as `npm run epubsite` in this repo or as
 * `npx epubsite` from a published tarball.
 *
 * The stream discipline is C.3.2 and is not cosmetic:
 *
 *   stdout   results only — one summary line, or one JSON document under --json.
 *            Anything else here makes `epubsite … --json | jq` unusable.
 *   stderr   progress, warnings, and everything --verbose adds.
 *   exit     `EpubSiteError.exitCode`, or 1 for a bug in this program.
 */
import { build } from '../build/build'
import { exitCodeFor, EpubSiteError, UsageError } from '../build/errors'
import { formatDiagnostics } from '../build/diagnostics'
import { stableStringify } from '../build/determinism'
import { readPackageVersion } from '../build/assets/paths'
import { DEFAULT_OPTIONS } from '../build/options'
import { startServer } from '../serve/server'
import { HELP_TEXT, parseCliArgs, type CliInvocation } from './args'
import { resolve } from 'node:path'

async function main(): Promise<number> {
  let invocation: CliInvocation
  try {
    invocation = parseCliArgs(process.argv.slice(2))
  } catch (error) {
    return report(error, false)
  }

  if (invocation.help) {
    process.stdout.write(HELP_TEXT)
    return 0
  }
  if (invocation.version) {
    process.stdout.write(`${readPackageVersion()}\n`)
    return 0
  }

  try {
    if (invocation.command === 'serve') {
      return await serve(invocation)
    }

    const book = invocation.positional
    if (book === undefined) {
      throw new UsageError('no book given. Run epubsite --help for usage.')
    }

    const result = await build(book, invocation.options)
    const { diagnostics, stats } = result

    for (const line of formatDiagnostics(diagnostics)) {
      process.stderr.write(`${line}\n`)
    }

    if (invocation.options.json === true) {
      // A serializable subset of `BuildResult`, with sorted keys so the output is
      // diffable (C.5: ordering discipline, not byte equality).
      process.stdout.write(
        `${stableStringify({
          outDir: result.outDir,
          stats,
          diagnostics,
        })}\n`,
      )
      return 0
    }

    const verb = invocation.options.dryRun === true ? 'Would build' : 'Built'
    process.stdout.write(
      `${verb} ${stats.chapters} chapter${stats.chapters === 1 ? '' : 's'}, ` +
        `${stats.resources} resource${stats.resources === 1 ? '' : 's'} ` +
        `(${formatBytes(stats.bytes)}) into ${result.outDir}\n`,
    )
    return 0
  } catch (error) {
    return report(error, invocation.options.verbose === true)
  }
}

/**
 * `epubsite serve [dir]` (spec §9.1).
 *
 * Prints the URL to **stdout**, because it is the result of the command and
 * something a script may want to read; everything else stays on stderr (C.3.2).
 *
 * It runs until interrupted, and returns 0 when it is: a development server that
 * has been asked to stop has succeeded, not failed.
 */
async function serve(invocation: CliInvocation): Promise<number> {
  const root = resolve(invocation.positional ?? DEFAULT_OPTIONS.out)
  const server = await startServer({ root, port: invocation.port ?? 8080 })

  process.stdout.write(`${server.url}/\n`)
  process.stderr.write(`Serving ${root}\nPress Ctrl+C to stop.\n`)

  await new Promise<void>((done) => {
    const stop = (): void => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      done()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })

  await server.close()
  return 0
}

/** Prints an error the way §C.3.2 wants it and returns its exit code. */
function report(error: unknown, verbose: boolean): number {
  const stack = error instanceof Error ? error.stack : undefined

  // Under --verbose the stack already begins with the error's own name and
  // message, so printing both would say everything twice — which is exactly the
  // kind of noise that trains people to stop reading stderr.
  if (verbose && stack !== undefined) {
    process.stderr.write(`${stack}\n`)
  } else {
    const detail = error instanceof Error ? error.message : String(error)
    const where = error instanceof EpubSiteError ? error.where : undefined
    process.stderr.write(`${where === undefined ? detail : `${detail}\n  at ${where}`}\n`)
  }

  if (error instanceof UsageError) {
    process.stderr.write('Run epubsite --help for usage.\n')
  }

  return exitCodeFor(error)
}

/** Decimal units, because this number is compared against a file manager. */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    // Reaching here means `main` itself threw, which is a bug in this program
    // rather than a diagnosed failure. Say so instead of printing an exit code
    // with no explanation.
    process.stderr.write(`epubsite: internal error: ${String(error)}\n`)
    process.exitCode = 1
  })
