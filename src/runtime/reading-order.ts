/**
 * Where a location sits in the reading sequence (spec §5.7, §7.5).
 *
 * `shell-data.json` carries the reading order as entry paths — the same linear
 * spine list `publication.json` publishes — and this module turns "where am I"
 * into "what is on either side of me".
 *
 * It is a pure function in a file of its own, for the reason `chapter-urls.ts` is:
 * the branches worth pinning are the ones a browser test can only reach
 * expensively — the two ends of the book, and the landing page — and a unit test
 * states them in four lines.
 *
 * **One rule covers every case.** Find the key in the sequence, and treat a miss
 * as "before the beginning". The landing page is a miss, and so is a document the
 * book keeps out of the reading sequence (`linear="no"`: a cover, the navigation
 * document). Both should page *forward* into chapter one rather than pretend the
 * reader is in the middle of the book, and neither needs a flag to say so.
 *
 * Entry paths stay branded (`EntryPath`, §7.5): the pager hands these values
 * straight to `toUrlPath`, which is the only thing that knows a file name is not
 * a URL.
 */
import type { EntryPath } from '../shared/paths'

export interface Neighbours {
  /** The entry path before this one, or `null` at the start of the sequence. */
  prev: EntryPath | null
  /** The entry path after this one, or `null` at the end. */
  next: EntryPath | null
}

export function neighbours(order: readonly EntryPath[], key: string | null): Neighbours {
  // `-1` for a miss, which makes the "before the beginning" case fall out of the
  // same arithmetic: `order[-2]` is `undefined`, and `order[0]` is the first
  // chapter. No branch, so no branch to get wrong.
  //
  // `findIndex` rather than `indexOf` on purpose: `key` comes from
  // `location.pathname` and is deliberately an unbranded string, while the order
  // holds branded entry paths. Comparing them is exactly the point of the lookup,
  // and comparing a branded value with an unbranded one needs no cast.
  const index = key === null ? -1 : order.findIndex((entry) => entry === key)
  return { prev: order[index - 1] ?? null, next: order[index + 1] ?? null }
}
