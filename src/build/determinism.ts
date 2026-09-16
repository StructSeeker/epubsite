/**
 * Determinism helpers (spec C.5: "the same input twice produces byte-identical
 * output, apart from timestamps").
 *
 * Every set-like structure that reaches the output goes through here, because
 * key order otherwise drifts with V8's internal state and turns every diff red.
 */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()

  const source = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    const entry = source[key]
    if (entry === undefined) continue
    sorted[key] = sortKeys(entry)
  }
  return sorted
}

/** JSON with recursively sorted object keys. */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(sortKeys(value), null, indent)
}

/** Entries of a record in a deterministic key order. */
export function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.keys(record)
    .sort()
    .map((key) => [key, record[key] as T])
}

/** Sorts strings with a stable, locale-independent comparison. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
