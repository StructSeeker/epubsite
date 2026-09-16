/**
 * The programmatic API (spec C.3.1).
 *
 * The library and the CLI are the same code: `build` is what `epubsite <book>`
 * calls, minus the argument parsing. It throws typed errors carrying the exit
 * code the CLI should use and never calls `process.exit` (§9.3) — which is what
 * lets it be embedded, tested without a subprocess, and used from a build script
 * that has its own idea of what to do about a failure.
 *
 * Types are re-exported from here rather than from deep paths so that the module
 * layout of the build layer stays free to change.
 */
export { build, type BuildResult, type BuildStats } from './build/build'

export {
  DEFAULT_OPTIONS,
  absoluteBase,
  parseBaseUrl,
  resolveOptions,
  validateShellName,
  type BaseUrl,
  type BaseUrlForm,
  type BuildOptions,
  type HostingMode,
  type JsonLdMode,
  type Theme,
} from './build/options'

export {
  emptyDiagnostics,
  formatDiagnostics,
  sortDiagnostics,
  type Diagnostic,
  type Diagnostics,
} from './build/diagnostics'

export {
  EncryptedContentError,
  EpubSiteError,
  InternalError,
  InvalidEpubError,
  NotImplementedFeatureError,
  OutputConflictError,
  UsageError,
  exitCodeFor,
  isEpubSiteError,
  type EpubSiteErrorOptions,
  type ExitCode,
} from './build/errors'

export { openEpub, type EpubArchive, type ZipEntryInfo } from './build/epub/zip'
export { buildBookModel, presentationOrder, type BookModel, type Chapter } from './build/model/book'
