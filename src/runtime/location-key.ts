/**
 * The site-relative key for the current location (spec §5.4.2, A.2).
 *
 * `shell-data.json` is keyed by entry path, and because the site root *is* the
 * EPUB root (§3.1), the entry path is also the URL path. Turning one into the
 * other is therefore just stripping the deployment prefix — which is only
 * knowable from the frozen root, never from the cwd or from a relative URL.
 *
 * Decoding is done **per segment**. `decodeURIComponent` on a whole path would
 * turn a literal `%2F` into a separator and silently address a different file;
 * segment-wise decoding is the same rule the build uses when it percent-encodes.
 */
import { decodeSegment } from '../shared/paths'

export function keyFromLocation(root: URL): string | null {
  const base = root.pathname
  const path = location.pathname
  if (!path.startsWith(base)) return null

  const relative = path.slice(base.length)
  if (relative === '') return null
  return relative.split('/').map(decodeSegment).join('/')
}
