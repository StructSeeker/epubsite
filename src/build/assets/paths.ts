/**
 * Where this package keeps its own static assets (spec C.4.2, C.4.3).
 *
 * The CLI runs from two very different places — `build/bin/epubsite.js` inside
 * this repo (`npm run epubsite`), and the same file inside a published tarball
 * (`npx epubsite`) — and both must find `vendor/htmx.esm.js` and
 * `build/runtime/shell.css`.
 *
 * `process.cwd()` is useless for this. The whole point of `--out ./dist` is that
 * the cwd belongs to the *caller's* project, so resolving our own assets against
 * it would work in this repo and break everywhere else. That failure mode is
 * exactly what the packaged-artifact smoke test exists to catch.
 *
 * `import.meta.dirname` is the only reliable anchor (hence `engines: >=20.11`).
 * Its depth differs between entry points — `build/bin/` for the CLI, `build/`
 * for the library — so we deliberately do **not** count `..` segments. Counting
 * parents is the kind of arithmetic that silently breaks the moment a third
 * entry point lands; searching upward for a fact (`package.json`) does not.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { InternalError } from '../errors'

let cachedRoot: string | undefined

/**
 * The package root: the directory holding this package's `package.json`.
 *
 * `package.json` is the one file guaranteed to be present in the published
 * tarball at a known depth (npm always places it at the root), which is why it
 * is the search key rather than a `build/` directory marker.
 */
export function packageRoot(): string {
  cachedRoot ??= findUpwards(import.meta.dirname)
  return cachedRoot
}

function findUpwards(start: string): string {
  let current = resolve(start)
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) {
      throw new InternalError(
        `could not locate this package's root directory by walking up from ${start}`,
        { where: start },
      )
    }
    current = parent
  }
}

/**
 * A runtime asset — `shell.js`, `shell.css` — that ships beside the compiled
 * code.
 *
 * The `src/runtime` fallback exists so that unit and integration tests can run
 * against a checkout that has never been built. It can never fire in a published
 * install, because `files` ships `build/` and nothing else; if it ever did, the
 * result would be a correct build from a source tree, not a wrong one.
 */
export function runtimeAsset(name: string): string {
  const root = packageRoot()
  const built = join(root, 'build', 'runtime', name)
  if (existsSync(built)) return built
  return join(root, 'src', 'runtime', name)
}

/** A vendored third-party file, e.g. `htmx.esm.js` (spec C.4.3). */
export function vendorAsset(name: string): string {
  return join(packageRoot(), 'vendor', name)
}

/**
 * This package's version, read from its own manifest.
 *
 * Read rather than inlined at build time: a version string baked into the bundle
 * is a second copy of a fact that already exists, and the copy is the one that
 * goes stale — exactly when someone is trying to work out which version is
 * misbehaving (`--version` exists precisely for that moment).
 */
export function readPackageVersion(): string {
  const manifest = readFileSync(join(packageRoot(), 'package.json'), 'utf8')
  const parsed: unknown = JSON.parse(manifest)
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const version = (parsed as { version: unknown }).version
    if (typeof version === 'string' && version !== '') return version
  }
  throw new InternalError('this package\'s package.json has no "version" field', {
    where: 'package.json',
  })
}
