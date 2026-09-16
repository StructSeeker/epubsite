/**
 * The error taxonomy (spec §9.2, §C.3.1).
 *
 * The library layer NEVER calls `process.exit` — it throws these, and the CLI
 * maps `exitCode` to the process exit status. That is what makes every exit
 * code unit-testable and lets the library be embedded in other toolchains.
 *
 *   0  success
 *   1  internal error (not in the spec's table; matches Node's uncaught default)
 *   2  usage / unsupported option
 *   3  invalid EPUB
 *   4  output conflict
 *   5  encrypted content
 */

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5

export interface EpubSiteErrorOptions {
  /** Original error, kept for `--verbose` and stack traces. */
  cause?: unknown
  /** Where it went wrong: an entry path, a file, an OPF element. */
  where?: string
}

/** Base class. Never thrown directly; use a subclass so the code is meaningful. */
export class EpubSiteError extends Error {
  /** Stable machine-readable identifier, for CI assertions (spec §C.3.3). */
  readonly code: string
  readonly exitCode: ExitCode
  readonly where: string | undefined

  constructor(code: string, message: string, exitCode: ExitCode, options: EpubSiteErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.exitCode = exitCode
    this.where = options.where
  }
}

/** Bad flags or flag values: exit 2. */
export class UsageError extends EpubSiteError {
  constructor(message: string, options: EpubSiteErrorOptions = {}) {
    super('E_USAGE', message, 2, options)
  }
}

/**
 * A real feature that is deliberately not implemented: exit 2.
 *
 * Used for exactly one thing today — hosting rewrite rules (§8.4, §C.6.1).
 * See `src/build/hosting/rewrite.ts` for the contract.
 */
export class NotImplementedFeatureError extends EpubSiteError {
  constructor(message: string, options: EpubSiteErrorOptions = {}) {
    super('E_NOT_IMPLEMENTED', message, 2, options)
  }
}

/** Structurally broken or non-conforming input EPUB: exit 3. */
export class InvalidEpubError extends EpubSiteError {
  constructor(message: string, options: EpubSiteErrorOptions = {}) {
    super('E_INVALID_EPUB', message, 3, options)
  }
}

/** The output location cannot hold this book: exit 4. */
export class OutputConflictError extends EpubSiteError {
  constructor(message: string, options: EpubSiteErrorOptions = {}) {
    super('E_OUTPUT_CONFLICT', message, 4, options)
  }
}

/** `META-INF/encryption.xml` present (§4.2, §12): exit 5. */
export class EncryptedContentError extends EpubSiteError {
  constructor(message: string, options: EpubSiteErrorOptions = {}) {
    super('E_ENCRYPTED', message, 5, options)
  }
}

/**
 * A bug in this program, not a defect in the input: exit 1.
 *
 * Reserved for assertions that the build makes about *its own* output — the
 * zero-rewrite check (§13.1) being the only one today. If one of these fires,
 * the user's book is fine and our code is not, and saying so is the difference
 * between a bug report we can act on and one that blames the wrong file.
 */
export class InternalError extends EpubSiteError {
  constructor(message: string, options: EpubSiteErrorOptions = {}) {
    super('E_INTERNAL', message, 1, options)
  }
}

/** Maps any thrown value to a process exit code. */
export function exitCodeFor(error: unknown): ExitCode {
  return error instanceof EpubSiteError ? error.exitCode : 1
}

/** True for errors we produced deliberately, as opposed to bugs. */
export function isEpubSiteError(error: unknown): error is EpubSiteError {
  return error instanceof EpubSiteError
}
