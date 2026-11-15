/* eslint-disable @typescript-eslint/no-explicit-any */
import YAML from 'yaml'
import type { ArazzoDoc } from './types'
import { bundleExternalRefs } from './refs'
import { t } from '../i18n'

export interface LoadedFile {
  name: string
  text: string
}

export type DocKind = 'arazzo' | 'openapi' | 'asyncapi' | 'unknown'

export interface ParsedFile {
  name: string
  kind: DocKind
  doc?: any
  error?: string
}

export type SourceStatus = 'loaded' | 'missing' | 'error'

export interface SourceState {
  name: string
  url: string
  type: string
  status: SourceStatus
  doc?: any
  fileName?: string
  error?: string
  /** $ref a otros archivos que no se cargaron. */
  missingRefs?: string[]
}

export interface Project {
  arazzoFileName: string
  arazzo: ArazzoDoc
  /** $ref del Arazzo a otros archivos que no se cargaron. */
  arazzoMissingRefs?: string[]
  sources: SourceState[]
  /** Todos los archivos cargados: de aquí salen los $ref externos. */
  files: ParsedFile[]
}

export function parseFile(file: LoadedFile): ParsedFile {
  try {
    const doc = YAML.parse(file.text, { maxAliasCount: -1 })
    return { name: file.name, kind: detectKind(doc), doc }
  } catch (e) {
    return { name: file.name, kind: 'unknown', error: t('load.parse', { error: (e as Error).message }) }
  }
}

export function detectKind(doc: any): DocKind {
  if (!doc || typeof doc !== 'object') return 'unknown'
  if (typeof doc.arazzo === 'string' || typeof doc.arazzo === 'number') return 'arazzo'
  if (doc.openapi || doc.swagger) return 'openapi'
  if (doc.asyncapi) return 'asyncapi'
  return 'unknown'
}

/** Último segmento de una ruta o URL, sin query ni fragmento. */
export function baseName(urlOrPath: string): string {
  const clean = urlOrPath.split('#')[0].split('?')[0]
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] ?? clean
}

/** Si el archivo sirve como contrato de una fuente del tipo indicado. */
function fitsSource(kind: DocKind, type: string): boolean {
  if (type === 'arazzo') return false
  return type === 'asyncapi' ? kind === 'asyncapi' : kind === 'openapi'
}

const CONTRACT_KINDS: DocKind[] = ['openapi', 'asyncapi']

/** Fuente con su contrato y los $ref externos ya resueltos con los archivos cargados. */
function withContract(s: SourceState, file: ParsedFile, files: ParsedFile[]): SourceState {
  const { doc, missing } = bundleExternalRefs(file.doc, file.name, files)
  return { ...s, status: 'loaded', doc, fileName: file.name, error: undefined, missingRefs: missing.length ? missing : undefined }
}

export function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Construye el proyecto: toma el primer Arazzo y asocia cada sourceDescription
 * con un archivo subido (por nombre de archivo). Lo que no se encuentra queda "missing".
 */
export function buildProject(files: ParsedFile[]): { project?: Project; errors: string[] } {
  const { projects, errors } = buildCollection(files)
  return { project: projects[0], errors }
}

/**
 * Construye la colección: un proyecto por cada archivo Arazzo, todos sobre los mismos archivos
 * (contratos y $ref). Cada sourceDescription se asocia con un archivo subido por nombre de archivo.
 */
export function buildCollection(files: ParsedFile[]): { projects: Project[]; errors: string[] } {
  const errors: string[] = []
  for (const f of files) if (f.error) errors.push(`${f.name}: ${f.error}`)
  const arazzoFiles = files.filter((f) => f.kind === 'arazzo')
  if (arazzoFiles.length === 0) {
    errors.push(t('load.noArazzo'))
    return { projects: [], errors }
  }
  // Contratos que algún Arazzo pide por su nombre: no se usan para adivinar las fuentes de otro.
  const contractFiles = files.filter((f) => CONTRACT_KINDS.includes(f.kind))
  const wanted = new Set(
    arazzoFiles.flatMap((a) => ((a.doc as ArazzoDoc).sourceDescriptions ?? []).map((sd) => baseName(String(sd?.url ?? '')))),
  )
  const unclaimed = contractFiles.filter((f) => !wanted.has(baseName(f.name)))
  return { projects: arazzoFiles.map((main) => buildProjectFor(main, files, unclaimed)), errors }
}

function buildProjectFor(main: ParsedFile, files: ParsedFile[], unclaimed: ParsedFile[]): Project {
  const bundled = bundleExternalRefs(main.doc, main.name, files)
  const arazzo = bundled.doc as ArazzoDoc
  const contractFiles = files.filter((f) => CONTRACT_KINDS.includes(f.kind))

  let sources: SourceState[] = (arazzo.sourceDescriptions ?? []).map((sd) => ({
    name: sd.name,
    url: sd.url,
    type: sd.type ?? 'openapi',
    status: 'missing' as SourceStatus,
  }))

  sources = sources.map((s) => {
    const match = contractFiles.find((f) => baseName(f.name) === baseName(s.url) && fitsSource(f.kind, s.type))
    return match ? withContract(s, match, files) : s
  })
  // Si queda exactamente una fuente sin archivo y un contrato de su tipo que nadie pide, se asocian.
  for (const kind of CONTRACT_KINDS) {
    const missing = sources.filter((s) => s.status === 'missing' && fitsSource(kind, s.type))
    const candidates = unclaimed.filter((f) => f.kind === kind)
    if (missing.length === 1 && candidates.length === 1) {
      sources = sources.map((s) => (s === missing[0] ? withContract(s, candidates[0], files) : s))
    }
  }

  return {
    arazzoFileName: main.name,
    arazzo,
    arazzoMissingRefs: bundled.missing.length ? bundled.missing : undefined,
    sources,
    files,
  }
}

/** Asigna un contrato (OpenAPI o AsyncAPI) a una fuente concreta. */
export function attachSource(project: Project, sourceName: string, file: ParsedFile): Project {
  const files = [...project.files.filter((f) => f.name !== file.name), file]
  return {
    ...project,
    files,
    sources: project.sources.map((s) =>
      s.name === sourceName
        ? fitsSource(file.kind, s.type)
          ? withContract(s, file, files)
          : { ...s, status: 'error', error: file.error ?? t(s.type === 'asyncapi' ? 'load.notAsyncapi' : 'load.notOpenapi', { name: file.name }) }
        : s,
    ),
  }
}

/** Intenta descargar una fuente remota (sujeto a CORS del servidor que la publica). */
export async function fetchRemoteSource(project: Project, sourceName: string): Promise<Project> {
  const src = project.sources.find((s) => s.name === sourceName)
  if (!src) return project
  try {
    const res = await fetch(src.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const parsed = parseFile({ name: baseName(src.url), text: await res.text() })
    let next = attachSource(project, sourceName, parsed)
    // Los archivos que referencia el contrato se buscan junto a él, en el mismo servidor.
    for (let round = 0; round < 3; round++) {
      const missing = next.sources.find((s) => s.name === sourceName)?.missingRefs ?? []
      const files = await Promise.all(
        missing.filter((m) => !m.includes('#')).map(async (ref) => {
          try {
            const r = await fetch(new URL(ref, src.url).toString())
            return r.ok ? parseFile({ name: baseName(ref), text: await r.text() }) : undefined
          } catch {
            return undefined
          }
        }),
      )
      const found = files.filter((f): f is ParsedFile => !!f && !f.error)
      if (!found.length) break
      next = attachSource({ ...next, files: [...next.files, ...found] }, sourceName, parsed)
    }
    return next
  } catch (e) {
    const msg =
      e instanceof TypeError
        ? t('load.fetchCors')
        : t('load.fetchError', { error: (e as Error).message })
    return {
      ...project,
      sources: project.sources.map((s) => (s.name === sourceName ? { ...s, status: 'error', error: msg } : s)),
    }
  }
}

/**
 * Reemplaza el Arazzo por una versión editada. Las fuentes que ya estaban cargadas
 * (incluidas las adjuntadas a mano o descargadas) se conservan si siguen en sourceDescriptions.
 */
export function replaceArazzo(project: Project, file: ParsedFile): Project {
  const files = [...project.files.filter((f) => f.name !== project.arazzoFileName), { ...file, name: project.arazzoFileName }]
  // El Arazzo editado tiene que ser el primero: buildProject usa el primer Arazzo que encuentra.
  files.sort((a, b) => Number(b.name === project.arazzoFileName) - Number(a.name === project.arazzoFileName))
  const built = buildProject(files).project
  if (!built) return project
  return {
    ...built,
    sources: built.sources.map((s) => {
      if (s.status === 'loaded') return s
      const old = project.sources.find((o) => o.name === s.name && o.url === s.url && o.status === 'loaded')
      return old ?? s
    }),
  }
}

/** Adjunta un contrato a la fuente `sourceName` de cada Arazzo de la colección que la tenga. */
export function attachToCollection(projects: Project[], sourceName: string, file: ParsedFile): Project[] {
  return projects.map((p) =>
    p.sources.some((s) => s.name === sourceName) ? attachSource(p, sourceName, file) : { ...p, files: [...p.files.filter((f) => f.name !== file.name), file] },
  )
}

/** Descarga desde su URL la fuente `sourceName` en cada Arazzo que la tenga y no la haya cargado. */
export async function fetchRemoteInCollection(projects: Project[], sourceName: string): Promise<Project[]> {
  return Promise.all(projects.map((p) => (p.sources.some((s) => s.name === sourceName && s.status !== 'loaded') ? fetchRemoteSource(p, sourceName) : p)))
}

/**
 * Reemplaza un archivo de la colección (un contrato o un archivo que un contrato referencia con $ref)
 * y vuelve a armar las fuentes que lo usan. Las demás fuentes, incluidas las adjuntadas a mano o
 * descargadas, quedan como estaban.
 */
export function replaceFileInCollection(projects: Project[], file: ParsedFile): Project[] {
  return projects.map((p) => {
    const files = [...p.files.filter((f) => f.name !== file.name), file]
    return {
      ...p,
      files,
      sources: p.sources.map((s) => {
        if (!s.fileName) return s
        const main = files.find((f) => f.name === s.fileName)
        if (!main) return s
        if (main.error) return { ...s, status: 'error', doc: undefined, error: main.error }
        if (!fitsSource(main.kind, s.type)) return { ...s, status: 'error', doc: undefined, error: t(s.type === 'asyncapi' ? 'load.notAsyncapi' : 'load.notOpenapi', { name: main.name }) }
        return withContract(s, main, files)
      }),
    }
  })
}
