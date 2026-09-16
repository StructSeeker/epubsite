import { defineConfig } from 'tsup'

/**
 * Four entry points, four very different targets (spec C.1 / C.4.1 / C.4.2):
 *
 *   bin/     Node, shebang, own source bundled, deps external
 *   index    Node library surface, deps external, emits .d.ts
 *   runtime/ browser ESM with ZERO dependencies -> _epubsite_assets/shell.js
 *   token    the same `token.ts` as a browser IIFE, inlined into 404.html
 *
 * The token entry exists so the transform has exactly one implementation. The
 * guide is served at an arbitrary depth and must be self-contained (§8.3
 * constraint 1), so it cannot import anything; bundling `token.ts` into a string
 * the build inlines is how it stays that way, instead of a hand-copied second
 * implementation that would make the bijection test meaningless.
 *
 * `clean` is deliberately left off: tsup may run configs in parallel and
 * cleaning from one entry would delete another's output. `npm run clean`
 * (wired to `prebuild`) owns that instead.
 */
export default defineConfig([
  {
    name: 'bin',
    entry: { 'bin/epubsite': 'src/bin/epubsite.ts' },
    outDir: 'build',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    bundle: true,
    splitting: false,
    sourcemap: true,
    dts: false,
    clean: false,
    external: ['yauzl', 'htmlparser2'],
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    name: 'lib',
    entry: { index: 'src/index.ts' },
    outDir: 'build',
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    bundle: true,
    splitting: false,
    sourcemap: true,
    dts: true,
    clean: false,
    external: ['yauzl', 'htmlparser2'],
  },
  {
    name: 'shell',
    entry: { 'runtime/shell': 'src/runtime/shell.ts' },
    outDir: 'build',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    bundle: true,
    // No splitting: the site fetches this file directly by URL, so it has to be
    // self-contained rather than importing chunk files nobody would serve.
    splitting: false,
    sourcemap: false,
    dts: false,
    clean: false,
  },
  {
    name: 'token',
    entry: { 'runtime/token-iife': 'src/shared/token.ts' },
    outDir: 'build',
    // IIFE with a global name: the emitted text is pasted into a `<script>`
    // element in 404.html, where a bare `export` would be a syntax error.
    format: ['iife'],
    globalName: 'epubsiteToken',
    // tsup appends `.global` to IIFE output by default. The build reads this
    // file by name, and a name that encodes a bundler's convention is a name
    // that changes when the bundler does.
    outExtension: () => ({ js: '.js' }),
    platform: 'browser',
    target: 'es2022',
    bundle: true,
    splitting: false,
    // Minified because this text is inlined into a page that is served on every
    // broken URL in the site, and because nothing ever reads it by hand.
    minify: true,
    sourcemap: false,
    dts: false,
    clean: false,
  },
])
