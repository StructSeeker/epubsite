/**
 * Loading `shell-data.json` (spec §5.4.1, C.6.2).
 *
 * The fetch URL is built with `new URL(ASSET, SITE_ROOT)`, and that is a
 * correctness requirement rather than a style preference. By the time this runs,
 * §5.4.1's step 3 may already have replaced the document's URL with a chapter's
 * — and a relative fetch would then resolve to
 * `/OEBPS/text/_epubsite_assets/shell-data.json`, which does not exist. The
 * content area would stay blank forever, with a 404 as the only clue.
 *
 * The tempting alternative is to rely on module timing — "modules are deferred,
 * so `location` has not been replaced yet". C.6.2 rules that out explicitly:
 * it hangs correctness on statement order inside this file, so any refactor can
 * break it silently. Explicit anchoring is immune to timing, and is I2's second
 * path made literal.
 */
import { RESERVED_PATHS, SHELL_ASSETS } from '../shared/paths'

export interface ChapterData {
  key: string
  title: string
  section: string | null
  position: number
  bodyClass: string
  dir: string | null
  lang: string | null
  headStyles: {
    /** Site-relative paths, or absolute URLs. */
    links: string[]
    imports: string[]
    inline: string[]
  }
  /** The standalone §7.3 node, present unless `--json-ld none` was used. */
  jsonld?: Record<string, unknown>
}

export interface NavItem {
  label: string
  key: string | null
  children: NavItem[]
}

export interface ShellData {
  book: { '@id': string | null; url?: string }
  byKey: Record<string, ChapterData>
  nav: NavItem[]
}

export async function loadShellData(root: URL): Promise<ShellData> {
  const url = new URL(`${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.shellData}`, root)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`shell-data.json returned ${response.status}`)
  }
  return (await response.json()) as ShellData
}
