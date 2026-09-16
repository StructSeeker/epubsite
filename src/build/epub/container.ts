/**
 * `META-INF/container.xml` -> OPF path (spec §4.2, §4.2.6.3.1).
 *
 * This is the only place the entry path of the package document is decided.
 * Everything else in the build derives from it: the manifest is resolved
 * relative to the OPF's directory (§5.2), and the nav document is found through
 * the manifest.
 */
import { InvalidEpubError } from '../errors'
import { attr, findAll, findFirst, type XmlNode } from './xml'
import { toEntryPath, toUrlPath, type EntryPath } from '../../shared/paths'

/** Only this media type identifies a package document (§4.2.6.3.1.3). */
const OPF_MEDIA_TYPE = 'application/oebps-package+xml'

/** §4.2: there is exactly one place the OPF path can come from. */
export const CONTAINER_PATH = toEntryPath('META-INF/container.xml')

export interface ContainerInfo {
  /** Entry path of the package document, relative to the container root. */
  opfPath: EntryPath
  /** Any additional package documents, used only for diagnostics. */
  otherRootfiles: EntryPath[]
}

export function parseContainer(doc: XmlNode, containerPath: string): ContainerInfo {
  const root = findFirst(doc, ['container'])
  if (root === undefined) {
    throw new InvalidEpubError('container.xml has no <container> root element', {
      where: containerPath,
    })
  }

  const version = attr(root, 'version')
  if (version !== undefined && version !== '1.0') {
    throw new InvalidEpubError(`container.xml declares an unsupported version: ${version}`, {
      where: containerPath,
    })
  }

  const rootfiles = findFirst(doc, ['rootfiles'])
  if (rootfiles === undefined) {
    throw new InvalidEpubError('container.xml has no <rootfiles> element', { where: containerPath })
  }

  const candidates = findAll(rootfiles, ['rootfile'])
  if (candidates.length === 0) {
    throw new InvalidEpubError('container.xml declares no <rootfile>', { where: containerPath })
  }

  const accepted: EntryPath[] = []
  for (const candidate of candidates) {
    const fullPath = attr(candidate, 'full-path')
    if (fullPath === undefined || fullPath.trim() === '') {
      throw new InvalidEpubError('<rootfile> is missing its required full-path attribute', {
        where: containerPath,
      })
    }
    const mediaType = attr(candidate, 'media-type')
    if (mediaType !== undefined && mediaType !== OPF_MEDIA_TYPE) continue

    // full-path is a path-relative-scheme-less-URL string (§4.2.6.3.1.3), so it
    // may be percent-encoded; it is always relative to the container root, never
    // to META-INF (§4.2.6.2).
    accepted.push(toEntryPath(safeDecode(fullPath)))
  }

  const opfPath = accepted[0]
  if (opfPath === undefined) {
    throw new InvalidEpubError(
      `no <rootfile> has media-type="${OPF_MEDIA_TYPE}"`,
      { where: containerPath },
    )
  }

  return { opfPath, otherRootfiles: accepted.slice(1) }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** URL form of an OPF path, for diagnostics and error messages. */
export function opfUrlPath(opfPath: EntryPath): string {
  return `/${toUrlPath(opfPath)}`
}
