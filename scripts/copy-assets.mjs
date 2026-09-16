#!/usr/bin/env node
/**
 * Copies the static runtime assets that tsup does not know about: tsup only
 * emits JavaScript, but the shell also needs its stylesheet next to
 * build/runtime/shell.js so the build can find it at a predictable offset
 * (see src/build/assets/paths.ts).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {ReadonlyArray<readonly [string, string]>} */
const jobs = [
  ['src/runtime/shell.css', 'build/runtime/shell.css'],
  ['src/runtime/icon.svg', 'build/runtime/icon.svg'],
  // CC BY 4.0 requires attribution, and it has to travel with the asset rather
  // than live only in the repository, or a published package ships the icon
  // without the notice. Same convention as vendor/htmx.LICENSE.
  ['src/runtime/icon.LICENSE', 'build/runtime/icon.LICENSE'],
]

let failed = false
for (const [from, to] of jobs) {
  const source = join(root, from)
  const target = join(root, to)
  if (!existsSync(source)) {
    console.error(`[assets] missing source file: ${from}`)
    failed = true
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  console.log(`[assets] ${from} -> ${to}`)
}

if (failed) process.exit(1)
