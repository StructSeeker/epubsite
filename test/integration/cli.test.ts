/**
 * The built executable, exercised the way a user exercises it (spec §9, C.3.2).
 *
 * `parseCliArgs` is unit-tested separately; what is tested here is everything
 * that only exists once the process actually runs: the exit code, which stream a
 * message lands on, and whether `--json` is parseable by a pipe. Those are the
 * properties a CI script or `| jq` depends on, and none of them can be observed
 * from inside the process.
 *
 * The test runs the **compiled** binary, so it needs `npm run build` first —
 * `npm run verify` does that, and `npm run test` alone will skip this file
 * rather than fail on a missing prerequisite. Skipping loudly is deliberate:
 * a silently skipped CLI test is worse than no CLI test.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sampleEpub } from '../fixtures/zip-writer'
import { createTempRoot, removeTempRoot, writeEpub } from '../fixtures/tmp'

const BIN = resolve('build/bin/epubsite.js')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTempRoot(root)))
})

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function runCli(args: readonly string[]): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', rejectPromise)
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

async function fixture(): Promise<{ epub: string; out: string }> {
  const root = await createTempRoot('cli')
  roots.push(root)
  return { epub: await writeEpub(root, sampleEpub()), out: join(root, 'site') }
}

describe.skipIf(!existsSync(BIN))('epubsite CLI', () => {
  it('prints its version and exits 0', async () => {
    const result = await runCli(['--version'])
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('prints help on stdout, where a pipe can read it', async () => {
    const result = await runCli(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Usage')
    expect(result.stdout).toContain('--hosting <mode>')
    expect(result.stderr).toBe('')
  })

  it('rejects an unknown flag with exit 2 and a pointer to --help', async () => {
    const result = await runCli(['book.epub', '--nope'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('Run epubsite --help for usage.')
    expect(result.stdout).toBe('')
  })

  it('rejects --hosting rewrite with exit 2, naming the documented gap', async () => {
    const { epub, out } = await fixture()
    const result = await runCli([epub, '-o', out, '--hosting', 'rewrite'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('hosting rewrite rules')
  })

  it('reports a bad book as exit 3', async () => {
    const root = await createTempRoot('cli-bad')
    roots.push(root)
    const epub = await writeEpub(root, Buffer.from('not a zip'))
    const result = await runCli([epub, '-o', join(root, 'site')])
    expect(result.code).toBe(3)
  })

  it('builds a site, puts one summary line on stdout and nothing else', async () => {
    const { epub, out } = await fixture()
    const result = await runCli([epub, '-o', out])

    expect(result.code).toBe(0)
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(result.stdout).toContain('Built 4 chapters')
    expect(existsSync(join(out, 'epubsite.html'))).toBe(true)
  })

  it('emits a JSON document on stdout under --json, with the diagnostics on stderr', async () => {
    const { epub, out } = await fixture()
    const result = await runCli([epub, '-o', out, '--json'])

    expect(result.code).toBe(0)
    const parsed: unknown = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({ outDir: resolve(out), stats: { chapters: 4 } })
  })

  it('keeps the result off stdout when it fails, so a pipeline never sees half a document', async () => {
    const { epub, out } = await fixture()
    await runCli([epub, '-o', out])
    const again = await runCli([epub, '-o', out, '--json'])

    expect(again.code).toBe(4)
    expect(again.stdout).toBe('')
    expect(again.stderr).toContain('--clean')
  })
})
