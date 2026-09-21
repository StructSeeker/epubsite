/**
 * Loading htmx, and locking it down in the same breath (spec §5.4.1, §10).
 *
 * The module is fetched by **dynamic import anchored to `SITE_ROOT`** rather
 * than by a static `import ... from './htmx.esm.js'`. Two reasons, and the
 * second is the one that matters:
 *
 *   - `shell.js` is served from the site root, so a relative specifier would
 *     work today and break the moment anything serves the shell from further
 *     down. Anchoring to the frozen root cannot be re-based.
 *   - A relative specifier also cannot be type-checked honestly: there is no
 *     `htmx.esm.js` next to the TypeScript source, so declaring one would mean
 *     writing a module declaration for a file that does not exist, and a wrong
 *     declaration then type-checks the runtime against a fiction.
 *
 * Both `config` assignments happen here, immediately after the await, in the
 * same synchronous resume. That is deliberate and is §5.4.1's requirement:
 * between the module arriving and `allowScriptTags` being false there must be no
 * microtask boundary, because a boosted request issued in that window would be
 * processed by an htmx that still inserts `<script>` elements from book content
 * (§10 measure 1). Keeping the two lines in one function is what makes that
 * impossible to get wrong from the outside.
 */
import { RESERVED_PATHS, SHELL_ASSETS } from '../shared/paths'

/** The parts of htmx's surface this shell actually uses. */
export interface Htmx {
  config: {
    /** §10 measure 1: never insert a `<script>` from swapped content. */
    allowScriptTags: boolean
    /** §10 measure 3: refuse requests to origins other than this one. */
    selfRequestsOnly: boolean
  }
  /**
   * Fetches a chapter into the content area (the entry protocol §5.4.1, and the
   * toolbar's pager §5.7).
   *
   * `push` carries the URL to push, not a flag: htmx takes the string straight
   * through to `history.pushState`, so passing `true` pushes the literal
   * address `/true`. That is not a hypothetical — it is what this did until a
   * search result was clicked in a real browser. Omit it or pass `false` to
   * push nothing. A boosted element pushes by itself; a caller is responsible
   * for its own history entry, which the pager relies on.
   *
   * `source` is the element the request is *about*. Nothing about the request is
   * read from it — the path and the verb are arguments — but htmx resolves the
   * inherited attributes from it, which is how the pager gets `hx-indicator` from
   * `<body>` and therefore shows "Loading…" like every other navigation.
   */
  ajax(
    verb: string,
    path: string,
    context: { target?: string; swap?: string; push?: string | false; source?: Element },
  ): Promise<unknown>
}

/** The vendored build's location inside the reserved asset directory (§3.1). */
export const HTMX_ASSET = `${RESERVED_PATHS.assetsDir}${SHELL_ASSETS.htmx}`

export async function loadHtmx(root: URL): Promise<Htmx> {
  const url = new URL(HTMX_ASSET, root).href
  const module = (await import(/* webpackIgnore: true */ url)) as { default: Htmx }
  const htmx = module.default

  htmx.config.allowScriptTags = false
  htmx.config.selfRequestsOnly = true

  return htmx
}
