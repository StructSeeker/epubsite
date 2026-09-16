/**
 * Package document parsing (spec §4.2, §4.4).
 *
 * Three rules drive everything here:
 *
 *  1. **Dual parsing is mandatory.** EPUB 3 puts metadata in `<meta property>`,
 *     EPUB 2 in `<meta name/content>`. Books in the wild carry both. Reading
 *     only one silently loses the title, the author, or the cover.
 *  2. **`refines` is the only way to learn a creator's role** in EPUB 3. Without
 *     it, a translator is indistinguishable from an author.
 *  3. **The spine is the only source of truth for reading order.** Manifest order
 *     is explicitly meaningless (§4.2).
 */
import { InvalidEpubError } from '../errors'
import { attr, attrLocal, childElements, childrenNamed, findAll, findFirst, localName, plainText, textOf, type XmlNode } from './xml'
import { resolveRef, type EntryPath } from '../../shared/paths'

/** Local alias: throughout this module these are XML *elements*. */
type Element = XmlNode

const XHTML_MEDIA_TYPE = 'application/xhtml+xml'

/** MARC relator codes -> the roles the spec's field map needs (§7.5). */
const MARC_RELATOR_ROLES: Readonly<Record<string, CreatorRole>> = {
  aut: 'author',
  trl: 'translator',
  ill: 'illustrator',
  edt: 'editor',
  pbl: 'publisher',
  com: 'compiler',
  ctb: 'contributor',
}

export type CreatorRole =
  | 'author'
  | 'translator'
  | 'illustrator'
  | 'editor'
  | 'publisher'
  | 'compiler'
  | 'contributor'

export interface Contributor {
  id: string | undefined
  name: string
  roles: CreatorRole[]
  /** Normalised sort form from a `file-as` refinement, when present. */
  fileAs: string | undefined
}

export interface Identifier {
  id: string | undefined
  value: string
  /** EPUB 2 `opf:scheme`, e.g. `ISBN`. */
  scheme: string | undefined
  /** EPUB 3 `identifier-type` refinement value, e.g. `15` from ONIX codelist 5. */
  identifierType: string | undefined
}

export interface TitleEntry {
  id: string | undefined
  value: string
  /** `title-type` refinement: main | subtitle | short | collection | edition. */
  type: string | undefined
  displaySeq: number | undefined
}

export interface ManifestItem {
  id: string
  /** Entry path, resolved against the OPF's directory (§5.2). */
  entryPath: EntryPath
  href: string
  mediaType: string
  properties: readonly string[]
  fallback: string | undefined
}

export interface SpineItem {
  idref: string
  linear: boolean
  properties: readonly string[]
  /** Entry path after following manifest fallbacks to a renderable document. */
  entryPath: EntryPath
  /** Media type of the item actually used, for the manifest's `encodingFormat`. */
  mediaType: string
  /** True when the resolved document differs from the itemref's own target. */
  viaFallback: boolean
}

export interface OpfMetadata {
  identifiers: readonly Identifier[]
  titles: readonly TitleEntry[]
  languages: readonly string[]
  creators: readonly Contributor[]
  contributors: readonly Contributor[]
  publisher: string | undefined
  description: string | undefined
  /** `dc:date`. */
  date: string | undefined
  /** `dcterms:modified`, in whatever form the book used it. */
  modified: string | undefined
  subjects: readonly string[]
  rights: string | undefined
  /** EPUB 2 `<meta name="cover" content="...">`: a *manifest id*, not a path. */
  coverIdFromLegacyMeta: string | undefined
}

export interface OpfPackage {
  version: string
  uniqueIdentifierId: string | undefined
  metadata: OpfMetadata
  manifestItems: readonly ManifestItem[]
  manifestById: ReadonlyMap<string, ManifestItem>
  spine: readonly SpineItem[]
  pageProgressionDirection: 'ltr' | 'rtl'
  layout: 'reflowable' | 'pre-paginated'
  /** Entry path of the navigation document, if the manifest flags one. */
  navPath: EntryPath | undefined
  /** Entry path of the EPUB 2 NCX, when the book has one (§4.3). */
  ncxPath: EntryPath | undefined
  /** Entry path of the cover image, from `cover-image` or the legacy meta. */
  coverImagePath: EntryPath | undefined
}

/** A `<meta>` subexpression, keyed by the id it refines. */
interface Refinement {
  property: string
  value: string
  scheme: string | undefined
  language: string | undefined
}

export function parseOpf(doc: XmlNode, opfPath: EntryPath): OpfPackage {
  const pkg = findFirst(doc, ['package'])
  if (pkg === undefined) {
    throw new InvalidEpubError('package document has no <package> root element', { where: opfPath })
  }

  const uniqueIdentifierId = attr(pkg, 'unique-identifier')
  const version = attr(pkg, 'version') ?? '3.0'

  const metadataElement = findFirst(pkg, ['metadata'])
  if (metadataElement === undefined) {
    throw new InvalidEpubError('package document has no <metadata> section', { where: opfPath })
  }

  const metadata = parseMetadata(metadataElement)
  const refinements = collectRefinements(metadataElement)
  const metadataWithRoles = applyRoles(metadata, refinements)

  const manifestItems = parseManifest(pkg, opfPath)
  const manifestById = new Map(manifestItems.map((item) => [item.id, item]))

  const spineElement = findFirst(pkg, ['spine'])
  if (spineElement === undefined) {
    throw new InvalidEpubError('package document has no <spine> section', { where: opfPath })
  }

  const progression = attr(spineElement, 'page-progression-direction')
  const pageProgressionDirection: 'ltr' | 'rtl' = progression === 'rtl' ? 'rtl' : 'ltr'

  const spine = parseSpine(spineElement, manifestById, opfPath)
  if (spine.length === 0) {
    throw new InvalidEpubError('the spine is empty, so there is nothing to read', { where: opfPath })
  }

  const layout = determineLayout(metadataElement, spineElement)

  return {
    version,
    uniqueIdentifierId,
    metadata: metadataWithRoles,
    manifestItems,
    manifestById,
    spine,
    pageProgressionDirection,
    layout,
    navPath: findNavPath(manifestItems),
    ncxPath: findNcxPath(manifestItems),
    coverImagePath: findCoverPath(manifestItems, metadataWithRoles.coverIdFromLegacyMeta),
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface RawMetadata {
  identifiers: Identifier[]
  titles: TitleEntry[]
  languages: string[]
  creators: Contributor[]
  contributors: Contributor[]
  publisher: string | undefined
  description: string | undefined
  date: string | undefined
  modified: string | undefined
  subjects: string[]
  rights: string | undefined
  coverIdFromLegacyMeta: string | undefined
}

function parseMetadata(metadata: Element): RawMetadata {
  const raw: RawMetadata = {
    identifiers: [],
    titles: [],
    languages: [],
    creators: [],
    contributors: [],
    publisher: undefined,
    description: undefined,
    date: undefined,
    modified: undefined,
    subjects: [],
    rights: undefined,
    coverIdFromLegacyMeta: undefined,
  }

  for (const child of childElements(metadata)) {
    const name = localName(child)
    const value = collapse(textOf(child))
    const id = attr(child, 'id')

    switch (name) {
      case 'identifier':
        if (value !== '') {
          raw.identifiers.push({
            id,
            value,
            scheme: attrLocal(child, 'scheme'),
            identifierType: undefined,
          })
        }
        break
      case 'title':
        if (value !== '') raw.titles.push({ id, value, type: undefined, displaySeq: undefined })
        break
      case 'language':
        if (value !== '') raw.languages.push(value)
        break
      case 'creator':
        if (value !== '') {
          raw.creators.push({
            id,
            name: value,
            // EPUB 2 carries the role as an attribute; EPUB 3 via refines.
            roles: rolesFromLegacyAttribute(child),
            fileAs: undefined,
          })
        }
        break
      case 'contributor':
        if (value !== '') {
          raw.contributors.push({
            id,
            name: value,
            roles: rolesFromLegacyAttribute(child),
            fileAs: undefined,
          })
        }
        break
      case 'publisher':
        raw.publisher ??= value === '' ? undefined : value
        break
      case 'description':
        // Must never reach JSON-LD or an attribute with markup intact (§7.5).
        raw.description ??= plainText(value) || undefined
        break
      case 'date':
        raw.date ??= value || undefined
        break
      case 'subject':
        if (value !== '') raw.subjects.push(value)
        break
      case 'rights':
        raw.rights ??= value || undefined
        break
      case 'meta': {
        const expression = readMetaExpression(child)
        if (expression === undefined) break
        if (expression.kind === 'legacy') {
          if (expression.name === 'cover' && expression.content !== '') {
            raw.coverIdFromLegacyMeta ??= expression.content
          }
        } else if (expression.local === 'modified') {
          raw.modified ??= expression.value || undefined
        }
        break
      }
      default:
        break
    }
  }

  return raw
}

/**
 * A `<meta>` element, resolved to the dialect it is actually written in.
 *
 * EPUB 2 and EPUB 3 both use `<meta>`, but the value lives in completely
 * different places: the `content` attribute for the legacy form, element text
 * for the property form. Parsing the text once and passing it to both branches
 * is what let the legacy branch read an empty string forever —
 * `<meta name="cover" content="cover-image"/>` is self-closing and has no text.
 *
 * As a union, each branch can only reach its own value: the legacy variant has
 * no `value` field to misread, so the bug is not expressible.
 */
type MetaExpression =
  | { readonly kind: 'legacy'; readonly name: string; readonly content: string }
  | { readonly kind: 'property'; readonly local: string; readonly value: string }

function readMetaExpression(element: Element): MetaExpression | undefined {
  const legacyName = attr(element, 'name')
  if (legacyName !== undefined) {
    return { kind: 'legacy', name: legacyName, content: attr(element, 'content') ?? '' }
  }

  const property = attr(element, 'property')
  if (property === undefined) return undefined

  return {
    kind: 'property',
    local: localPropertyName(property),
    value: collapse(textOf(element)),
  }
}

/** `dcterms:modified` -> `modified`. One implementation, used by every reader. */
function localPropertyName(property: string): string {
  const colon = property.indexOf(':')
  return colon === -1 ? property : property.slice(colon + 1)
}

function rolesFromLegacyAttribute(element: Element): CreatorRole[] {
  const role = attrLocal(element, 'role')
  if (role === undefined || role === '') return []
  const mapped = MARC_RELATOR_ROLES[role.toLowerCase()]
  return mapped === undefined ? [] : [mapped]
}

/** Every `<meta refines="#id">` subexpression, indexed by the id it refines. */
function collectRefinements(metadata: Element): Map<string, Refinement[]> {
  const byTarget = new Map<string, Refinement[]>()

  for (const element of findAll(metadata, ['meta'])) {
    const refines = attr(element, 'refines')
    const property = attr(element, 'property')
    if (refines === undefined || property === undefined) continue
    if (!refines.startsWith('#')) continue

    const target = refines.slice(1)
    const list = byTarget.get(target) ?? []
    list.push({
      property: localPropertyName(property),
      value: collapse(textOf(element)),
      scheme: attr(element, 'scheme'),
      language: attrLocal(element, 'lang'),
    })
    byTarget.set(target, list)
  }

  return byTarget
}

/**
 * Folds refinements back onto the properties they describe. This is where
 * author/translator membership is actually decided (§4.2, §7.5).
 */
function applyRoles(raw: RawMetadata, refinements: Map<string, Refinement[]>): OpfMetadata {
  const titles = raw.titles.map((title) => {
    const own = title.id === undefined ? [] : (refinements.get(title.id) ?? [])
    const type = own.find((entry) => entry.property === 'title-type')?.value
    const displaySeq = own.find((entry) => entry.property === 'display-seq')?.value
    const parsedSeq = displaySeq === undefined ? Number.NaN : Number.parseInt(displaySeq, 10)
    return {
      ...title,
      type: type === '' ? undefined : type,
      displaySeq: Number.isFinite(parsedSeq) ? parsedSeq : undefined,
    }
  })

  const identifiers = raw.identifiers.map((identifier) => {
    const own = identifier.id === undefined ? [] : (refinements.get(identifier.id) ?? [])
    const identifierType = own.find((entry) => entry.property === 'identifier-type')?.value
    return { ...identifier, identifierType: identifierType === '' ? undefined : identifierType }
  })

  const withRoles = (list: Contributor[], fallback: CreatorRole): Contributor[] =>
    list.map((person) => {
      const own = person.id === undefined ? [] : (refinements.get(person.id) ?? [])
      const refRoles = own
        .filter((entry) => entry.property === 'role')
        .map((entry) => MARC_RELATOR_ROLES[entry.value.toLowerCase()])
        .filter((role): role is CreatorRole => role !== undefined)
      const fileAs = own.find((entry) => entry.property === 'file-as')?.value
      return {
        ...person,
        roles: person.roles.length > 0 ? person.roles : refRoles.length > 0 ? refRoles : [fallback],
        fileAs: fileAs === '' ? undefined : fileAs,
      }
    })

  return {
    ...raw,
    titles,
    identifiers,
    creators: withRoles(raw.creators, 'author'),
    contributors: withRoles(raw.contributors, 'contributor'),
  }
}

/**
 * Chooses the canonical identifier (spec §4.2):
 *   1. the element `unique-identifier` points at (the authoritative EPUB 3 claim)
 *   2. an element the book itself marks as an ISBN
 *   3. the first one
 */
export function selectIdentifier(pkg: OpfPackage): Identifier | undefined {
  const { identifiers } = pkg.metadata
  if (identifiers.length === 0) return undefined

  if (pkg.uniqueIdentifierId !== undefined) {
    const declared = identifiers.find((identifier) => identifier.id === pkg.uniqueIdentifierId)
    if (declared !== undefined) return declared
  }

  // ONIX codelist 5: 15 = ISBN-13, 03 = ISBN-10.
  const isbn = identifiers.find(
    (identifier) =>
      identifier.scheme?.toLowerCase() === 'isbn' ||
      identifier.identifierType === '15' ||
      identifier.identifierType === '03' ||
      /^urn:isbn:/i.test(identifier.value),
  )
  return isbn ?? identifiers[0]
}

// ---------------------------------------------------------------------------
// Manifest and spine
// ---------------------------------------------------------------------------

function parseManifest(pkg: Element, opfPath: EntryPath): ManifestItem[] {
  const manifest = findFirst(pkg, ['manifest'])
  if (manifest === undefined) {
    throw new InvalidEpubError('package document has no <manifest> section', { where: opfPath })
  }

  const items: ManifestItem[] = []
  for (const element of childrenNamed(manifest, 'item')) {
    const id = attr(element, 'id')
    const href = attr(element, 'href')
    const mediaType = attr(element, 'media-type')

    if (id === undefined || href === undefined) {
      throw new InvalidEpubError('<item> is missing its required id or href attribute', {
        where: opfPath,
      })
    }

    // §5.2: hrefs resolve against the content URL of the package document.
    const resolved = resolveRef(opfPath, href)
    if (resolved.kind !== 'file') {
      throw new InvalidEpubError(`<item id="${id}"> has a bare fragment href: ${href}`, {
        where: opfPath,
      })
    }

    items.push({
      id,
      entryPath: resolved.path,
      href,
      mediaType: mediaType ?? 'application/octet-stream',
      properties: splitTokens(attr(element, 'properties')),
      fallback: attr(element, 'fallback'),
    })
  }

  return items
}

/**
 * Follows manifest fallback chains to something the reader can actually display.
 *
 * Fixed-layout books routinely put an image in the spine and fall back to an
 * SVG or XHTML page. Fetching a JPEG into the content area would be nonsense, so
 * resolving the chain here keeps that out of the runtime entirely.
 */
function resolveRenderable(
  item: ManifestItem,
  byId: ReadonlyMap<string, ManifestItem>,
  opfPath: EntryPath,
): { item: ManifestItem; viaFallback: boolean } {
  let current = item
  const visited = new Set<string>([current.id])

  for (let hops = 0; hops < 16; hops += 1) {
    if (isRenderable(current.mediaType)) return { item: current, viaFallback: current.id !== item.id }

    const nextId = current.fallback
    if (nextId === undefined) {
      throw new InvalidEpubError(
        `spine item "${item.id}" is a ${item.mediaType} with no fallback to a content document`,
        { where: opfPath },
      )
    }
    const next = byId.get(nextId)
    if (next === undefined) {
      throw new InvalidEpubError(`manifest fallback points at a missing item: ${nextId}`, {
        where: opfPath,
      })
    }
    if (visited.has(next.id)) {
      throw new InvalidEpubError(`manifest fallback chain is circular at "${next.id}"`, {
        where: opfPath,
      })
    }
    visited.add(next.id)
    current = next
  }

  throw new InvalidEpubError(`manifest fallback chain for "${item.id}" is too deep`, {
    where: opfPath,
  })
}

function isRenderable(mediaType: string): boolean {
  return mediaType === XHTML_MEDIA_TYPE || mediaType === 'image/svg+xml'
}

function parseSpine(
  spine: Element,
  byId: ReadonlyMap<string, ManifestItem>,
  opfPath: EntryPath,
): SpineItem[] {
  const items: SpineItem[] = []

  for (const element of childrenNamed(spine, 'itemref')) {
    const idref = attr(element, 'idref')
    if (idref === undefined) {
      throw new InvalidEpubError('<itemref> is missing its required idref attribute', {
        where: opfPath,
      })
    }

    const item = byId.get(idref)
    if (item === undefined) {
      throw new InvalidEpubError(`<itemref> references an item that is not in the manifest: ${idref}`, {
        where: opfPath,
      })
    }

    const resolved = resolveRenderable(item, byId, opfPath)
    items.push({
      idref,
      linear: attr(element, 'linear') !== 'no',
      properties: splitTokens(attr(element, 'properties')),
      entryPath: resolved.item.entryPath,
      mediaType: resolved.item.mediaType,
      viaFallback: resolved.viaFallback,
    })
  }

  // Deliberately NOT reversed for RTL. Spec §12 asks for the sidebar and
  // prev/next order to be reversed, which is a presentation concern; reversing
  // here would corrupt `readingOrder` and every chapter's spine `position`
  // (§7.5 derives position from the spine index). The rendering layer owns it,
  // driven by `pageProgressionDirection`.
  return items
}

// ---------------------------------------------------------------------------
// Rendering metadata
// ---------------------------------------------------------------------------

/**
 * Fixed layout forces `--no-spa` (§12): a fixed pixel viewport cannot coexist
 * with a responsive shell. Detected globally via `rendition:layout` and locally
 * via a spine override.
 */
function determineLayout(metadata: Element, spine: Element): 'reflowable' | 'pre-paginated' {
  for (const element of findAll(metadata, ['meta'])) {
    const property = attr(element, 'property')
    if (property === undefined) continue
    if (localPropertyName(property) === 'layout' && collapse(textOf(element)) === 'pre-paginated') {
      return 'pre-paginated'
    }
  }

  for (const element of childrenNamed(spine, 'itemref')) {
    if (splitTokens(attr(element, 'properties')).includes('rendition:layout-pre-paginated')) {
      return 'pre-paginated'
    }
  }

  return 'reflowable'
}

function findNavPath(items: readonly ManifestItem[]): EntryPath | undefined {
  return items.find((item) => item.properties.includes('nav'))?.entryPath
}

/**
 * The EPUB 2 navigation document, found by media type (§4.3).
 *
 * Media type rather than the spine's `toc` attribute: the attribute names a
 * manifest *id*, books get it wrong often enough to matter, and the media type
 * is unambiguous. EPUB 3 books frequently ship both — the NCX for older readers
 * and the nav document for newer ones — which is why the build prefers the nav
 * document and only falls back to this.
 */
function findNcxPath(items: readonly ManifestItem[]): EntryPath | undefined {
  return items.find((item) => item.mediaType === 'application/x-dtbncx+xml')?.entryPath
}

/** `cover-image` property first (EPUB 3), then the legacy `<meta name="cover">`. */
function findCoverPath(
  items: readonly ManifestItem[],
  legacyId: string | undefined,
): EntryPath | undefined {
  const marked = items.find((item) => item.properties.includes('cover-image'))
  if (marked !== undefined) return marked.entryPath
  if (legacyId !== undefined) return items.find((item) => item.id === legacyId)?.entryPath
  return undefined
}

function splitTokens(value: string | undefined): string[] {
  if (value === undefined) return []
  return value.split(/\s+/).filter((token) => token !== '')
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
