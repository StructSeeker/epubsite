/**
 * `_epubsite_assets/shell-data.json` (spec A.2, §5.4.2).
 *
 * The shell's private payload. It is a separate file from `publication.json` on
 * purpose (C.7): that one faces the world and must contain no private fields,
 * this one is rendering instructions and may evolve freely. Merging them would
 * make the shell fetch a manifest that is hundreds of kilobytes of resources it
 * never uses, and would give crawlers a document full of `bodyClass`.
 *
 * Everything here is a plain lookup keyed by the chapter's **entry path**, which
 * is also its site-relative URL path — so the runtime can go from
 * `location.pathname` to a record without any mapping table.
 */
import type { BookModel } from './book'
import type { ChapterHead } from '../epub/head'
import { presentationNav, type NavNode } from '../epub/nav'
import { withContext, type ChapterNode, type StructuredData } from './structured-data'
import type { BaseUrl } from '../options'
import { stableStringify } from '../determinism'

/** A stylesheet reference as the runtime wants it: a site-relative path or a URL. */
export type SerializedStyleRef = string

export interface ChapterData {
  /** The chapter's entry path; equal to the object key, and to its URL path. */
  key: string
  title: string
  /** Parent navigation label, or `null`; becomes `articleSection` (§7.5). */
  section: string | null
  /** 1-based reading position (§7.5). */
  position: number
  bodyClass: string
  dir: string | null
  lang: string | null
  headStyles: {
    links: SerializedStyleRef[]
    imports: SerializedStyleRef[]
    inline: string[]
  }
  /** The standalone §7.3 node the runtime injects into `<head>` (§5.6). */
  jsonld?: ChapterNode
}

export interface NavItem {
  label: string
  /** Entry path when this entry points at a container document. */
  key: string | null
  children: NavItem[]
}

export interface ShellData {
  book: {
    /** The canonical identifier, or `null` when the book declares none. */
    '@id': string | null
    /** Only present for an absolute `--base-url` (§7.5). */
    url?: string
  }
  byKey: Record<string, ChapterData>
  nav: NavItem[]
}
export interface ShellDataInput {
  model: BookModel
  /** Per-chapter heads, keyed by entry path. */
  heads: ReadonlyMap<string, ChapterHead>
  baseUrl: BaseUrl
  shellName: string
  structured: StructuredData
}

/**
 * The payload the shell fetches once per cold start.
 *
 * A.2 also lists the full book node here. It is omitted deliberately: that node
 * is already static in the shell's own `<head>`, and copying it into a second
 * file the shell fetches at startup would duplicate the largest part of it for no
 * reader — syncJsonLd only ever touches chapter nodes, because the book's block
 * carries no `data-epub-ld` marker and is never removed (§5.6).
 */
export function buildShellData(input: ShellDataInput): ShellData {
  const { model } = input

  const byKey: Record<string, ChapterData> = {}
  for (const chapter of model.chapters) {
    const head = input.heads.get(chapter.entryPath)
    const jsonld = input.structured.chapters.get(chapter.entryPath)
    byKey[chapter.entryPath] = {
      key: chapter.entryPath,
      // `chapter.label` is §12's whole fallback chain, resolved once in the model.
      title: chapter.label,
      section: chapter.section ?? null,
      position: chapter.position,
      bodyClass: head?.bodyClass ?? '',
      dir: head?.dir ?? null,
      lang: head?.lang ?? null,
      headStyles: {
        links: (head?.links ?? []).map(serializeStyleRef),
        imports: (head?.imports ?? []).map(serializeStyleRef),
        inline: [...(head?.inline ?? [])],
      },
      ...(jsonld === undefined ? {} : { jsonld: withContext(jsonld) }),
    }
  }

  const base = input.baseUrl.form === 'absolute' ? input.baseUrl.href : undefined
  const identifier = model.identifier?.value ?? null

  return {
    book: {
      '@id': identifier,
      ...(base === undefined ? {} : { url: `${base}${input.shellName}` }),
    },
    byKey,
    nav: toNavItems(presentationNav(model.nav.toc, model.progression)),
  }
}

export function serializeShellData(data: ShellData): string {
  // Stable key order, so a rebuild that changed nothing produces a readable diff
  // rather than a reshuffled file (C.5).
  return `${stableStringify(data)}\n`
}

function serializeStyleRef(ref: { kind: 'path'; path: string } | { kind: 'external'; href: string }): string {
  return ref.kind === 'path' ? ref.path : ref.href
}

function toNavItems(nodes: readonly NavNode[]): NavItem[] {
  return nodes.map((node) => ({
    label: node.label,
    key: node.entryPath ?? null,
    children: toNavItems(node.children),
  }))
}
