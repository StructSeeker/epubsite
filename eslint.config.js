import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The dependency boundaries in spec C.1 are load-bearing, not stylistic:
 *
 *  - src/shared/  is compiled into BOTH the Node build and the browser bundle,
 *                 so a single `node:` import breaks the shell at runtime.
 *  - src/runtime/ is a browser ES module with no dependency budget at all.
 *  - src/build/   must never touch the DOM; it has no `document`.
 *
 * They are enforced here rather than by convention, because a violation is
 * invisible until a reader's browser fails.
 *
 * The rule is a regex for "a specifier that does not start with a dot", which is
 * what "bare specifier" means: `node:fs`, `yauzl`, `/abs/path`. The earlier
 * version of this rule used `group: ['*', '!./*', '!../*']`, which looks right
 * and is **inverted** — minimatch negation does not compose the way it appears
 * to in `group`, so it rejected `./absolutize`. Nothing had noticed because
 * `src/runtime/` contained no TypeScript and `src/shared/paths.ts` had no
 * imports at all, so the rule had never been exercised. A boundary check that
 * has never fired is not evidence that the boundary holds.
 */
const NODE_OR_DEP_IN_SHARED = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          regex: '^(?!\\.)',
          message:
            'src/shared and src/runtime must be dependency-free (spec C.1). ' +
            'Relative imports only; this module is compiled into the browser bundle.',
        },
      ],
    },
  ],
}

export default tseslint.config(
  {
    ignores: [
      'build/**',
      'node_modules/**',
      'vendor/**',
      'dist/**',
      '.tmp/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'test/spike/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },

  {
    files: ['src/shared/**/*.ts', 'src/runtime/**/*.ts'],
    rules: NODE_OR_DEP_IN_SHARED,
  },

  {
    // Build-side code runs in Node only. Using a DOM global here is always a bug.
    files: ['src/build/**/*.ts', 'src/bin/**/*.ts', 'src/serve/**/*.ts', 'src/index.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'Build-side code runs in Node (spec C.1).' },
        { name: 'window', message: 'Build-side code runs in Node (spec C.1).' },
        { name: 'location', message: 'Build-side code runs in Node (spec C.1).' },
        { name: 'localStorage', message: 'Build-side code runs in Node (spec C.1).' },
      ],
    },
  },

  {
    files: ['test/**/*.ts', '*.config.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    // Plain Node scripts: no bundler, no TS, so they need the Node globals
    // declared explicitly rather than resolved from the TypeScript lib.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-restricted-imports': 'off',
    },
  },
)
