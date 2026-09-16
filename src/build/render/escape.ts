/**
 * HTML construction with escaping as the default (spec §4.6, §10 measure 4).
 *
 * The shell, the transit page and the 404 guide are produced by tag templates
 * rather than a template engine — two files do not justify a dependency — but
 * "template literal" and "escaping discipline" are different things, and only
 * the second one is what keeps a book's metadata from injecting markup into our
 * pages.
 *
 * So escaping is not a helper the author is trusted to call. It is the default
 * behaviour of interpolation, and the only way to insert markup verbatim is
 * {@link markSafe}, which says so at the call site. A missing `escapeHtml()` is
 * the classic way this class of bug ships; here it is not expressible.
 *
 * Note that EPUB *content* is never escaped or rewritten — it is copied verbatim
 * (§13.1). This module is for markup **we** generate.
 */
import { InternalError } from '../errors'

declare const safeHtmlBrand: unique symbol

/** Markup already known to be safe. Only {@link markSafe} and {@link html} produce it. */
export interface SafeHtml {
  readonly [safeHtmlBrand]: 'SafeHtml'
  readonly value: string
}

/** A value that may be interpolated into a tag template. */
export type HtmlValue =
  | SafeHtml
  | string
  | number
  | null
  | undefined
  | readonly HtmlValue[]

export function markSafe(value: string): SafeHtml {
  return { value } as SafeHtml
}

/**
 * Escapes text for HTML content *and* for a double-quoted attribute value.
 *
 * One function rather than two because the character set is the same: every
 * attribute this build emits is quoted with `"`, so `'` needs no escaping, and
 * `&<>"` is sufficient for both positions. Two functions would invite the
 * question of which one a given interpolation needs, and getting that wrong is
 * silent.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Interpolates with escaping on by default.
 *
 * Arrays are flattened, so a list of children can be interpolated directly
 * instead of being joined by hand at every call site — another place a manual
 * step could be forgotten.
 */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): SafeHtml {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i += 1) {
    out += stringify(values[i])
    out += strings[i + 1] ?? ''
  }
  return markSafe(out)
}

function stringify(value: HtmlValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return escapeHtml(value)
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(stringify).join('')
  return (value as SafeHtml).value
}

/**
 * ` name="value"`, or nothing at all when the value is absent.
 *
 * Written as a function because the alternative in a tag template is an inline
 * ternary that repeats the attribute name, and `false`/`undefined` handling at
 * three call sites is three chances to emit `disabled="undefined"`.
 */
export function attr(
  name: string,
  value: string | number | undefined | null | false,
): SafeHtml {
  if (value === undefined || value === null || value === false || value === '') return markSafe('')
  return markSafe(` ${name}="${escapeHtml(String(value))}"`)
}

/** The final string. Call this once, at the point of writing a file. */
export function render(node: SafeHtml): string {
  return node.value
}

/**
 * JSON that is safe to place inside a `<script>` element (spec §10 measure 4).
 *
 * `<` is the only character that can end the block early — `</script>` inside a
 * string, or `<!--` starting a comment-like state in legacy parsers — so it is
 * replaced with its JSON escape, which parses back to the same value. Escaping
 * the value rather than trusting the source is what makes this safe for
 * attacker-controlled book metadata.
 */
export function serializeJson(node: unknown): string {
  const json = JSON.stringify(node)
  if (json === undefined) {
    throw new InternalError('attempted to serialize a value JSON cannot represent', {
      where: 'render/escape',
    })
  }
  return json.replace(/</g, '\\u003c')
}

/**
 * A JavaScript value, ready to interpolate into a `<script>` element.
 *
 * The wrapper is the point. Script content in HTML is raw text: entities are
 * **not** decoded there, so an HTML-escaped `&quot;` is not a quote, it is six
 * characters of syntax error. Serializing JavaScript and interpolating it as
 * text therefore breaks the page in the one place the escaping rules invert —
 * and the tests caught exactly that happening here.
 *
 * Returning `SafeHtml` means code cannot be interpolated as text by accident:
 * the only way in is through this function, and this function says it is code.
 * Serialization (the `\u003c` escape) still applies, so the value cannot end
 * the element early either.
 */
export function scriptJson(value: unknown): SafeHtml {
  return markSafe(serializeJson(value))
}

/** A JavaScript string literal, ready to interpolate into a `<script>`. */
export function scriptString(value: string): SafeHtml {
  return markSafe(serializeJson(value))
}

/**
 * JavaScript *source* meant to be pasted into a `<script>` element.
 *
 * Script content in HTML is raw text, so the HTML escaper must not touch it —
 * but two byte sequences still end the element early, and both are legal-ish
 * JavaScript in some position:
 *
 *   `</script`   closes the element wherever the parser sees it
 *   `<!--`       starts a comment-like state in legacy parsers
 *
 * Escaping them with a backslash is the standard remedy: `<\/script` is the
 * same string to a JavaScript parser inside a string literal, and outside one
 * neither sequence is valid code in the first place. The alternative — refusing
 * to inline anything containing them — would turn a bundler's formatting choice
 * into a build failure.
 */
export function inlineScript(source: string): SafeHtml {
  return markSafe(source.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--'))
}
