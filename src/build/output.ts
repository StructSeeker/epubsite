/**
 * Writing the site, and the only place that decides where that is.
 *
 * Two jobs, kept together because they share the same invariant:
 *
 *   1. Deciding whether the output directory may be written at all
 *      (spec §9.2 — silently overwriting a user's files is not acceptable).
 *   2. Turning an {@link EntryPath} into a real file, unchanged.
 *
 * On path safety: `createFileSink` never re-validates the entry path against
 * `..` or a drive letter. That check lives in `host-safety.ts` and its result
 * has a specific exit code, and it runs over the *whole* container before the
 * first byte is written — so anything reaching the sink has already been
 * proven safe, and a second guard here would be a branch that cannot fire.
 * Where a guarantee already exists, re-stating it in a place that cannot be
 * reached is worse than leaving it stated once: it suggests a defence that is
 * not actually providing anything.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { OutputConflictError } from './errors'
import type { EntryPath } from '../shared/paths'

/** Somewhere files can be written. A file system, or a test double. */
export interface FileSink {
  /** Writes a whole buffer. Returns the number of bytes written. */
  write(entryPath: EntryPath, data: string | Buffer): Promise<number>
  /** Streams an entry, so a large asset never has to be buffered. */
  writeStream(entryPath: EntryPath, source: Readable): Promise<number>
}

export interface OutputOptions {
  /** Delete the output directory first. Destructive, and opt-in. */
  clean: boolean
  /** Permit writing into a directory that already has content. */
  force: boolean
}

/**
 * Makes the output directory safe to write into, or explains why it is not.
 *
 * The rules, in the order they are decided:
 *
 *   `--clean`   wipes the directory. It is the explicit statement that whatever
 *               is there is disposable, so it also implies consent to overwrite.
 *   `--force`   permits a non-empty directory that this build did not create.
 *   otherwise   a non-empty directory is a hard stop, exit 4.
 *
 * An *empty* directory is always fine — that is what `mkdir -p` leaves behind,
 * and refusing it would punish the most ordinary workflow there is.
 */
export async function prepareOutputDir(outDir: string, options: OutputOptions): Promise<void> {
  if (options.clean) {
    await rm(outDir, { recursive: true, force: true })
    await mkdir(outDir, { recursive: true })
    return
  }

  const info = await statOrUndefined(outDir)
  if (info !== undefined && !info.isDirectory()) {
    throw new OutputConflictError(`the output path exists and is not a directory: ${outDir}`, {
      where: outDir,
    })
  }

  if (info !== undefined && !options.force) {
    const entries = await readdir(outDir)
    if (entries.length > 0) {
      throw new OutputConflictError(
        `the output directory is not empty: ${outDir}\n` +
          'Refusing to overwrite files this build did not create. ' +
          'Pass --clean to delete it first, or --force to write into it anyway.',
        { where: outDir },
      )
    }
  }

  await mkdir(outDir, { recursive: true })
}

async function statOrUndefined(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/** The real file system, rooted at `outDir`. */
export function createFileSink(outDir: string): FileSink {
  const root = resolve(outDir)

  const pathFor = (entryPath: EntryPath): string => join(root, ...entryPath.split('/'))

  return {
    async write(entryPath, data) {
      const target = pathFor(entryPath)
      await mkdir(dirname(target), { recursive: true })
      const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      await writeFile(target, buffer)
      return buffer.byteLength
    },

    async writeStream(entryPath, source) {
      const target = pathFor(entryPath)
      await mkdir(dirname(target), { recursive: true })

      let bytes = 0
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length
          callback(null, chunk)
        },
      })

      await pipeline(source, counter, createWriteStream(target))
      return bytes
    },
  }
}

/** The file-system counterpart of `FileSink`, for tests and for `--dry-run`. */
export function createMemorySink(): FileSink & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async write(entryPath, data) {
      const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      files.set(entryPath, buffer)
      return buffer.byteLength
    },
    async writeStream(entryPath, source) {
      const chunks: Buffer[] = []
      for await (const chunk of source) chunks.push(chunk as Buffer)
      const buffer = Buffer.concat(chunks)
      files.set(entryPath, buffer)
      return buffer.byteLength
    },
  }
}
