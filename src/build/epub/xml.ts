/**
 * Minimal XML tree over htmlparser2 (spec C.2).
 *
 * Why htmlparser2 and not a strict XML parser: real EPUBs are full of
 * not-well-formed XHTML, and a draconian parser simply throws on them. In
 * `xmlMode` htmlparser2 still handles self-closing tags and CDATA correctly,
 * which is what XHTML needs.
 *
 * Why our own `XmlNode` instead of htmlparser2's node types: those types live in
 * `domhandler`, which htmlparser2 depends on but does not re-export. Importing
 * them directly would mean depending on a hoisted transitive package — the kind
 * of undeclared dependency that works until someone switches package manager.
 * Normalising once, at the boundary, keeps the rest of the build layer reading
 * our own small shape and keeps the dependency honest.
 */
import { parseDocument } from 'htmlparser2'

export interface XmlNode {
  /** `root` | `tag` | `script` | `style` | `text` | `comment` | `cdata` | `directive`. */
  type: string
  /** Element name including any namespace prefix. Empty for non-elements. */
  name: string
  /** Attributes keyed by full name, so `epub:type` is reachable verbatim. */
  attribs: Readonly<Record<string, string>>
  children: readonly XmlNode[]
  /** Text content, for text nodes only. */
  data: string
}

/** Parses XML into our own node shape. Never throws on malformed input. */
export function parseXml(source: string): XmlNode {
  return convert(parseDocument(source, { xmlMode: true, decodeEntities: true }) as unknown as RawNode)
}

/**
 * Decodes XML bytes to a string, honouring a byte-order mark.
 *
 * XML is not necessarily UTF-8: the spec allows UTF-16 with a BOM, and a few
 * tools emit it. Decoding such a file as UTF-8 does not throw — it produces a
 * plausible-looking string full of NUL bytes that fails much later, inside a
 * parser, with a message about the book being malformed. That misdirection is
 * worth three lines to avoid. A BOM-free declaration such as
 * `<?xml encoding="UTF-16"?>` is *not* handled: without a mark the encoding is
 * ambiguous, and guessing is how this becomes a security issue rather than a
 * compatibility one.
 */
export function decodeXml(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le')
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return swapBytes(bytes.subarray(2)).toString('utf16le')
  }
  // Strip a UTF-8 BOM as well: it is legal, and it would otherwise arrive as a
  // stray U+FEFF as the first character of the document.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString('utf8')
  }
  return bytes.toString('utf8')
}

/** UTF-16BE is UTF-16LE with every pair of bytes exchanged. */
function swapBytes(bytes: Buffer): Buffer {
  return Buffer.from(bytes).swap16()
}

interface RawNode {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, unknown>
  children?: RawNode[]
}

function convert(raw: RawNode): XmlNode {
  const attribs: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw.attribs ?? {})) {
    attribs[key] = value === null || value === undefined ? '' : String(value)
  }

  return {
    type: raw.type ?? 'root',
    name: raw.name ?? '',
    attribs,
    children: (raw.children ?? []).map(convert),
    data: raw.data ?? '',
  }
}

export function isElement(node: XmlNode): boolean {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style'
}

/** Element name with any namespace prefix removed (`dc:title` -> `title`). */
export function localName(node: XmlNode): string {
  const colon = node.name.indexOf(':')
  return colon === -1 ? node.name : node.name.slice(colon + 1)
}

/**
 * All descendant elements matching any of `names`, in document order.
 * Matching is on the local name, so `dc:title` matches `title`.
 */
export function findAll(root: XmlNode, names: readonly string[]): XmlNode[] {
  const wanted = new Set(names)
  const found: XmlNode[] = []

  const walk = (node: XmlNode): void => {
    for (const child of node.children) {
      if (isElement(child)) {
        if (wanted.has(localName(child))) found.push(child)
        walk(child)
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  return found
}

/** First descendant element matching any of `names`, or `undefined`. */
export function findFirst(root: XmlNode, names: readonly string[]): XmlNode | undefined {
  return findAll(root, names)[0]
}

/** Direct child elements of a node, in document order. */
export function childElements(node: XmlNode): XmlNode[] {
  return node.children.filter(isElement)
}

/** Direct child elements with a given local name. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return childElements(node).filter((child) => localName(child) === name)
}

/** Attribute by exact (possibly prefixed) name. */
export function attr(node: XmlNode, name: string): string | undefined {
  return node.attribs[name]
}

/** Attribute by local name, ignoring any prefix (`opf:role` -> `role`). */
export function attrLocal(node: XmlNode, name: string): string | undefined {
  const direct = node.attribs[name]
  if (direct !== undefined) return direct
  for (const [key, value] of Object.entries(node.attribs)) {
    const colon = key.indexOf(':')
    if (colon !== -1 && key.slice(colon + 1) === name) return value
  }
  return undefined
}

/** Concatenated text of a node and all its descendants. */
export function textOf(node: XmlNode): string {
  let text = ''
  const walk = (current: XmlNode): void => {
    if (!isElement(current)) {
      text += current.data
      return
    }
    for (const child of current.children) walk(child)
  }
  walk(node)
  return text
}

/**
 * Strips tags and collapses whitespace.
 *
 * Used for `dc:description`, which may contain markup that must never reach
 * JSON-LD (`abstract`) or an HTML attribute unescaped (§7.5).
 */
export function plainText(source: string): string {
  return source
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
