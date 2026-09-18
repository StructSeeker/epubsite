/**
 * The JSON-LD graph and the publication manifest (spec §7, A.1, C.7).
 *
 * **One function, three artifacts.** The book's JSON-LD, the manifest's
 * descriptive properties, and every chapter node are built here, from the same
 * model, so a property that appears in two of them cannot disagree. §7.1 calls
 * this the design's most important consistency guarantee, and it is a
 * *structural* guarantee rather than a tested one: there is no second field map
 * to drift.
 *
 * The three artifacts are not the same document, because their readers are not
 * the same (C.7):
 *
 *   the shell's `<head>`      Book node, static — a crawler that runs no
 *                             JavaScript sees the whole graph here, chapters and
 *                             all, through `hasPart`
 *   the runtime's `<head>`    the current Chapter node, injected after a swap
 *   `publication.json`        a Web Publication Manifest — same descriptive
 *                             data, flattened to the top level per the REC, plus
 *                             `readingOrder` and `resources`
 *
 * Two rules from §7.5 shape almost every field:
 *
 *   - `url` is emitted **only** for an absolute `--base-url`. A relative URL in
 *     JSON-LD denotes nothing in particular, and a consumer that resolves it
 *     against its own document produces a plausible wrong answer, which is worse
 *     than no answer. The same applies to `image` — §9 lists it among what the
 *     absolute form unlocks. There is no `og:image` meta tag: nothing in this
 *     build emits Open Graph, and the option table's former mention of one was
 *     simply wrong.
 *   - `@id` is identity, never location (§7.4), so it survives moving the site.
 */
import { chapterId, normalizeBookId, normalizeIsbn } from '../ids'
import { toUrlPath, type EntryPath } from '../../shared/paths'
import type { BookModel } from './book'
import type { BaseUrl, JsonLdMode } from '../options'
import type { Diagnostics } from '../diagnostics'
import type { Contributor } from '../epub/opf'

export type SchemaContext = 'https://schema.org'

export interface PersonNode {
  '@type': 'Person'
  name: string
  alternateName?: string
}

export interface ChapterRef {
  '@type': ['Chapter', 'Article']
  '@id': string
  name: string
  position: number
}

export interface ChapterNode extends ChapterRef {
  url?: string
  headline: string
  articleSection?: string
  inLanguage?: string
  isPartOf: { '@type': 'Book'; '@id': string }
  /**
   * Absent by design (§7.5).
   *
   * The spec describes `isPartOf` as an ancestor chain ending in the book node
   * when the table of contents is nested. The nav tree gives ancestor *labels*
   * and no identities, so a chain would mean inventing `@id`s for nodes the book
   * never named — a graph that looks richer and asserts more than is known. The
   * information the chain would carry is present as `articleSection` (the parent
   * label) and `position` (the reading order). Recorded here rather than
   * silently omitted.
   */
}

export interface BookNode {
  /** Present because this node always stands alone in its own `<script>`. */
  '@context': 'https://schema.org'
  '@type': 'Book'
  '@id': string
  url?: string
  name: string
  alternateName?: string
  author?: PersonNode[]
  translator?: PersonNode[]
  publisher?: { '@type': 'Organization'; name: string }
  isbn?: string
  identifier?: string
  inLanguage?: string
  datePublished?: string
  dateModified?: string
  bookFormat: 'https://schema.org/EBook'
  abstract?: string
  image?: string
  keywords?: string[]
  hasPart?: (ChapterNode | ChapterRef)[]
}

export interface LinkedResource {
  '@type': 'LinkedResource'
  url: string
  encodingFormat?: string
  name?: string
  /** `contents` or `cover`; structural relationships belong in `resources` (A.1). */
  rel?: string
}

export interface PublicationManifest {
  '@context': readonly [string, string]
  type: 'Book'
  conformsTo: string
  [key: string]: unknown
  readingOrder: LinkedResource[]
  resources: LinkedResource[]
}

export interface StructuredData {
  /** The normalised identity every node shares (§7.4). */
  bookId: string
  /** `null` under `--json-ld none`: no `<script>` block anywhere. */
  book: BookNode | null
  /** Chapter nodes by entry path; empty under `--json-ld none`. */
  chapters: Map<string, ChapterNode>
  /** Always emitted: `--json-ld` governs `<script>` blocks, not the manifest. */
  publication: PublicationManifest
}

export interface StructuredDataInput {
  model: BookModel
  baseUrl: BaseUrl
  shellName: string
  jsonLd: JsonLdMode
  diagnostics: Diagnostics
}

/** The REC's required context, in this exact order (A.1). */
const PUB_CONTEXT = ['https://schema.org', 'https://www.w3.org/ns/pub-context'] as const

/** Identifies the profile the manifest claims to conform to (A.1). */
const CONFORMS_TO = 'https://www.w3.org/TR/pub-manifest/'

export function buildStructuredData(input: StructuredDataInput): StructuredData {
  const { model, diagnostics } = input
  const bookId = normalizeBookId(model.identifier?.value ?? model.title, diagnostics)
  const base = input.baseUrl.form === 'absolute' ? input.baseUrl.href : undefined
  const descriptive = describe({ model, base, shellName: input.shellName })

  const chapters = new Map<string, ChapterNode>()
  for (const chapter of model.chapters) {
    chapters.set(
      chapter.entryPath,
      chapterNode({
        model,
        bookId,
        base,
        entryPath: chapter.entryPath,
        position: chapter.position,
        label: chapter.label,
        section: chapter.section,
      }),
    )
  }

  if (input.jsonLd === 'none') {
    return {
      bookId,
      book: null,
      chapters: new Map(),
      publication: manifest({ model, base, descriptive }),
    }
  }

  const parts = input.jsonLd === 'thin' ? thin(chapters) : chapters
  const book: BookNode = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    '@id': bookId,
    ...descriptive,
    hasPart: [...parts.values()],
  }

  return { bookId, book, chapters, publication: manifest({ model, base, descriptive }) }
}

// ---------------------------------------------------------------------------
// The descriptive layer: the one object the three artifacts share
// ---------------------------------------------------------------------------

interface DescribeInput {
  model: BookModel
  base: string | undefined
  shellName: string
}

function describe(input: DescribeInput): Descriptive {
  const { model, base } = input
  const metadata = model.opf.metadata

  const descriptive: Descriptive = {
    name: model.title,
    bookFormat: 'https://schema.org/EBook',
  }

  const subtitle = metadata.titles.find((title) => title.type === 'subtitle')?.value
  if (subtitle !== undefined && subtitle !== model.title) descriptive.alternateName = subtitle
  if (model.authors.length > 0) descriptive.author = model.authors.map(personNode)
  if (model.translators.length > 0) descriptive.translator = model.translators.map(personNode)
  if (model.publisher !== undefined) {
    descriptive.publisher = { '@type': 'Organization', name: model.publisher }
  }

  // §7.5: identifiers are split by scheme — the ISBN goes to `isbn`, the first
  // non-ISBN one to `identifier` — so the same number never lands in both.
  const selected = model.identifier
  const isbn = selected === undefined ? undefined : normalizeIsbn(selected.value)
  const other = metadata.identifiers.find(
    (identifier) => identifier !== selected && normalizeIsbn(identifier.value) === undefined,
  )
  if (isbn !== undefined) descriptive.isbn = isbn
  if (other !== undefined) descriptive.identifier = other.value

  const language = metadata.languages[0]
  if (language !== undefined) descriptive.inLanguage = language
  if (metadata.date !== undefined) descriptive.datePublished = metadata.date
  if (metadata.modified !== undefined) descriptive.dateModified = metadata.modified
  if (metadata.description !== undefined) descriptive.abstract = metadata.description
  if (metadata.subjects.length > 0) descriptive.keywords = [...metadata.subjects]

  if (base !== undefined) {
    descriptive.url = `${base}${input.shellName}`
    if (model.opf.coverImagePath !== undefined) {
      descriptive.image = `${base}${model.opf.coverImagePath}`
    }
  }

  return descriptive
}

/** The descriptive facts, shared by the book node and the manifest. */
type Descriptive = Omit<BookNode, '@context' | '@type' | '@id' | 'hasPart'>

function personNode(person: Contributor): PersonNode {
  const node: PersonNode = { '@type': 'Person', name: person.name }
  if (person.fileAs !== undefined) node.alternateName = person.fileAs
  return node
}

interface ChapterInput {
  model: BookModel
  bookId: string
  base: string | undefined
  entryPath: EntryPath
  position: number
  label: string
  section: string | undefined
}

function chapterNode(input: ChapterInput): ChapterNode {
  const node: ChapterNode = {
    '@type': ['Chapter', 'Article'],
    '@id': chapterId(input.bookId, input.position),
    name: input.label,
    headline: input.label,
    position: input.position,
    // §7.5 describes `isPartOf` as an ancestor chain ending in the book. The nav
    // tree yields ancestor *labels* and no identities, so a chain would mean
    // inventing `@id`s for nodes the book never named — a graph asserting more
    // than is known. What the chain would carry is already here as
    // `articleSection` (the parent) and `position` (the reading order).
    isPartOf: { '@type': 'Book', '@id': input.bookId },
  }

  // Percent-encoded, because `entryPath` is the name as it appears inside the zip
  // and a URL is not a file name. Books do contain spaces and non-ASCII names, and
  // a literal space in `url` is not a URL at all — while a runtime that emitted
  // the encoded spelling would then be listing a second, "different" address.
  if (input.base !== undefined) node.url = `${input.base}${toUrlPath(input.entryPath)}`
  // Omitted at the top level, which is why it is optional rather than empty:
  // `articleSection: ""` is a claim, an absent field is an absence.
  if (input.section !== undefined && input.section !== '') node.articleSection = input.section

  const language = input.model.opf.metadata.languages[0]
  if (language !== undefined) node.inLanguage = language

  return node
}

/** `--json-ld thin`: `hasPart` keeps only what identifies and orders a chapter (§9). */
function thin(chapters: Map<string, ChapterNode>): Map<string, ChapterRef> {
  const result = new Map<string, ChapterRef>()
  for (const [key, node] of chapters) {
    result.set(key, {
      '@type': node['@type'],
      '@id': node['@id'],
      name: node.name,
      position: node.position,
    })
  }
  return result
}

interface ManifestInput {
  model: BookModel
  base: string | undefined
  descriptive: Descriptive
}

/**
 * The Web Publication Manifest (A.1).
 *
 * The REC deviates from what a schema.org-shaped intuition expects in three ways
 * that each make a manifest *fail validation*, so they are worth naming:
 *
 *   - descriptive properties live at the **top level**; there is no nested
 *     `metadata` object;
 *   - `@context` is a two-element array in a fixed order;
 *   - relationships like `contents` and `cover` belong in `resources`, **not**
 *     `links` — the REC's own processing removes them from `links`.
 */
function manifest(input: ManifestInput): PublicationManifest {
  const { model, base } = input
  // `image` is dropped here because the cover already has a home in `resources`,
  // where its `rel="cover"` lives; the same file twice would be two places to
  // keep in step for no gain.
  const { image: _cover, ...descriptive } = input.descriptive
  void _cover

  const publication: PublicationManifest = {
    '@context': PUB_CONTEXT,
    type: 'Book',
    conformsTo: CONFORMS_TO,
    ...descriptive,
    readingOrder: [],
    resources: [],
  }

  for (const chapter of model.chapters) {
    // Only linear items. EPUB's `linear="no"` marks content that is outside the
    // linear reading sequence — covers, copyright pages, and the navigation
    // document itself — and the manifest has no vocabulary for that flag. A
    // reading order that silently included them would tell a consumer to read a
    // table of contents as a chapter.
    //
    // The reader's sidebar still lists them: it is showing the book's own table
    // of contents, which is a different question from "what is the reading
    // order", and §4.2 keeps them in the model for exactly that reason.
    if (!chapter.linear) continue
    publication.readingOrder.push({
      '@type': 'LinkedResource',
      // C.7: the *real* path. A token path answers 404 under the default hosting
      // mode, so pointing a third-party consumer at one tells it to give up.
      url: manifestUrl(base, chapter.entryPath),
      encodingFormat: chapter.mediaType,
      name: chapter.label,
    })
  }

  const inReadingOrder = new Set<string>(
    model.chapters.filter((chapter) => chapter.linear).map((chapter) => chapter.entryPath),
  )
  for (const item of model.opf.manifestItems) {
    if (inReadingOrder.has(item.entryPath)) continue
    const resource: LinkedResource = {
      '@type': 'LinkedResource',
      url: manifestUrl(base, item.entryPath),
      encodingFormat: item.mediaType,
    }
    if (item.entryPath === model.opf.navPath) resource.rel = 'contents'
    if (item.entryPath === model.opf.coverImagePath) {
      resource.rel = 'cover'
      // A.1: a cover whose `encodingFormat` is `image/*` must carry a name.
      resource.name = model.title
    }
    publication.resources.push(resource)
  }

  return publication
}

/**
 * A manifest URL.
 *
 * Relative when there is no origin, unlike the JSON-LD `url`, and that asymmetry
 * is deliberate: the manifest is served from the site root, so its relative URLs
 * have an unambiguous base and A.1's own example uses them. A JSON-LD block can
 * be copied anywhere, which is why §7.5 omits relative URLs there.
 */
function manifestUrl(base: string | undefined, path: string): string {
  return base === undefined ? path : `${base}${path}`
}

/**
 * Prepends `@context`, for a node that stands alone in its own `<script>`.
 *
 * `hasPart` entries must **not** carry it: a context declaration inside a nested
 * node is legal but pointless, and repeating it in every chapter of a
 * thousand-chapter book is a lot of bytes saying nothing.
 */
export function withContext<T extends object>(node: T): T & { '@context': SchemaContext } {
  return { '@context': 'https://schema.org', ...node }
}
