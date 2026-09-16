/**
 * Temp-directory helpers for tests that have to touch a real file system.
 *
 * `yauzl` reads a real ZIP, so the container reader cannot be tested against an
 * in-memory buffer without either a fake archive (which tests nothing) or a temp
 * file (which tests the real thing). Temp files it is.
 *
 * Sites are written under the OS temp directory rather than the repo, so a
 * failing test cannot leave a half-built site inside the workspace where it
 * would be picked up by a later `--force` run or a careless `git add`.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

export async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `epubsite-${prefix}-`))
}

export async function writeEpub(root: string, bytes: Buffer, name = 'book.epub'): Promise<string> {
  const path = join(root, name)
  await writeFile(path, bytes)
  return path
}

export async function removeTempRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

export interface TreeEntry {
  /** Path relative to the root, `/`-separated. */
  path: string
  bytes: number
  content: Buffer
}

/**
 * Every file under `root`, keyed by relative path.
 *
 * Deliberately an independent implementation of "what is on disk": the build
 * asserts its own zero-rewrite property internally, and a test that asked the
 * build what it wrote would be asking the suspect to testify. This walks the
 * directory itself.
 */
export async function readTree(root: string): Promise<Map<string, TreeEntry>> {
  const files = new Map<string, TreeEntry>()

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    // Sorted so a failure message lists paths in the same order every run.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const content = await readFile(full)
      files.set(relative(root, full).split(sep).join('/'), {
        path: relative(root, full).split(sep).join('/'),
        bytes: content.byteLength,
        content,
      })
    }
  }

  await walk(root)
  return files
}
