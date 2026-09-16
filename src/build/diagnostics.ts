/**
 * The diagnostic report (spec C.3.3).
 *
 * Everything the build wants to say *without* failing goes here rather than to
 * `console`, for three reasons: `--json` needs it as data, `--verbose` needs it
 * as detail, and the CLI needs to decide what reaches stdout (results only) and
 * what reaches stderr (noise) — see C.3.2.
 *
 * `warnings[].code` is a stable machine-readable string. Natural language in a
 * field that CI wants to assert on is a field that gets rewritten the first time
 * someone improves the wording, and every test that touched it breaks.
 */

export interface Diagnostic {
  code: string
  message: string
  /** An entry path, an OPF element, a file — whatever locates the finding. */
  where?: string
}

export interface Diagnostics {
  /** Absolute URLs the book reaches out to (§12). Never rewritten, only reported. */
  externalResources: string[]
  /** Relative links pointing outside the container (§12). */
  outOfTreeLinks: string[]
  warnings: Diagnostic[]
}

export function emptyDiagnostics(): Diagnostics {
  return { externalResources: [], outOfTreeLinks: [], warnings: [] }
}

/** Adds a warning, keeping the report's `where` field absent rather than null. */
export function warn(diagnostics: Diagnostics, code: string, message: string, where?: string): void {
  diagnostics.warnings.push(where === undefined ? { code, message } : { code, message, where })
}

/**
 * A stable, sorted view for serialization.
 *
 * Sorted because the report is often diffed, and an array whose order depends on
 * the order warnings happened to fire is a diff that is noisy for no reason
 * (spec C.5: ordering discipline, not byte equality).
 */
export function sortDiagnostics(diagnostics: Diagnostics): Diagnostics {
  return {
    externalResources: [...diagnostics.externalResources].sort(),
    outOfTreeLinks: [...diagnostics.outOfTreeLinks].sort(),
    warnings: [...diagnostics.warnings].sort((a, b) => {
      if (a.code !== b.code) return a.code < b.code ? -1 : 1
      const left = `${a.where ?? ''}\u0000${a.message}`
      const right = `${b.where ?? ''}\u0000${b.message}`
      return left < right ? -1 : left > right ? 1 : 0
    }),
  }
}

/** Human-readable lines for stderr, one per finding. */
export function formatDiagnostics(diagnostics: Diagnostics): string[] {
  const lines: string[] = []
  for (const warning of diagnostics.warnings) {
    lines.push(`warning[${warning.code}] ${warning.message}${warning.where === undefined ? '' : ` (${warning.where})`}`)
  }
  for (const url of diagnostics.externalResources) {
    lines.push(`note[external-resource] the book references ${url}`)
  }
  for (const link of diagnostics.outOfTreeLinks) {
    lines.push(`note[out-of-tree-link] the book links outside the container: ${link}`)
  }
  return lines
}
