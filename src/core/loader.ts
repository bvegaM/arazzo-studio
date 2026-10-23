/* eslint-disable @typescript-eslint/no-explicit-any */
import YAML from 'yaml'
import type { ArazzoDoc } from './types'

export interface LoadedFile {
  name: string
  text: string
}

export type DocKind = 'arazzo' | 'openapi' | 'unknown'

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
}

export interface Project {
  arazzoFileName: string
  arazzo: ArazzoDoc
  sources: SourceState[]
}

export function parseFile(file: LoadedFile): ParsedFile {
  try {
    const doc = YAML.parse(file.text, { maxAliasCount: -1 })
    return { name: file.name, kind: detectKind(doc), doc }
  } catch (e) {
    return { name: file.name, kind: 'unknown', error: `No se pudo leer como YAML o JSON: ${(e as Error).message}` }
  }
}

export function detectKind(doc: any): DocKind {
  if (!doc || typeof doc !== 'object') return 'unknown'
  if (typeof doc.arazzo === 'string' || typeof doc.arazzo === 'number') return 'arazzo'
  if (doc.openapi || doc.swagger) return 'openapi'
  return 'unknown'
}

/** Último segmento de una ruta o URL, sin query ni fragmento. */
export function baseName(urlOrPath: string): string {
  const clean = urlOrPath.split('#')[0].split('?')[0]
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] ?? clean
}

export function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Construye el proyecto: toma el primer Arazzo y asocia cada sourceDescription
 * con un archivo subido (por nombre de archivo). Lo que no se encuentra queda "missing".
 */
export function buildProject(files: ParsedFile[]): { project?: Project; errors: string[] } {
  const errors: string[] = []
  for (const f of files) if (f.error) errors.push(`${f.name}: ${f.error}`)

  const arazzoFiles = files.filter((f) => f.kind === 'arazzo')
  if (arazzoFiles.length === 0) {
    errors.push('No se encontró ningún archivo Arazzo (debe tener el campo "arazzo" en la raíz).')
    return { errors }
  }
  if (arazzoFiles.length > 1) {
    errors.push(`Se subieron ${arazzoFiles.length} archivos Arazzo; se usará "${arazzoFiles[0].name}".`)
  }
  const main = arazzoFiles[0]
  const arazzo = main.doc as ArazzoDoc
  const openapiFiles = files.filter((f) => f.kind === 'openapi')

  const sources: SourceState[] = (arazzo.sourceDescriptions ?? []).map((sd) => ({
    name: sd.name,
    url: sd.url,
    type: sd.type ?? 'openapi',
    status: 'missing' as SourceStatus,
  }))

  const used = new Set<string>()
  for (const s of sources) {
    const match = openapiFiles.find((f) => baseName(f.name) === baseName(s.url))
    if (match) {
      s.status = 'loaded'
      s.doc = match.doc
      s.fileName = match.name
      used.add(match.name)
    }
  }
  // Si queda exactamente una fuente sin archivo y un OpenAPI sin usar, se asocian.
  const missing = sources.filter((s) => s.status === 'missing' && s.type === 'openapi')
  const unused = openapiFiles.filter((f) => !used.has(f.name))
  if (missing.length === 1 && unused.length === 1) {
    missing[0].status = 'loaded'
    missing[0].doc = unused[0].doc
    missing[0].fileName = unused[0].name
  }

  return { project: { arazzoFileName: main.name, arazzo, sources }, errors }
}

/** Asigna un archivo OpenAPI a una fuente concreta. */
export function attachSource(project: Project, sourceName: string, file: ParsedFile): Project {
  return {
    ...project,
    sources: project.sources.map((s) =>
      s.name === sourceName
        ? file.kind === 'openapi'
          ? { ...s, status: 'loaded', doc: file.doc, fileName: file.name, error: undefined }
          : { ...s, status: 'error', error: file.error ?? `"${file.name}" no parece un OpenAPI.` }
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
    return attachSource(project, sourceName, parsed)
  } catch (e) {
    const msg =
      e instanceof TypeError
        ? 'No se pudo descargar: el servidor no permite CORS o no es accesible. Descárgalo y súbelo manualmente.'
        : `No se pudo descargar: ${(e as Error).message}`
    return {
      ...project,
      sources: project.sources.map((s) => (s.name === sourceName ? { ...s, status: 'error', error: msg } : s)),
    }
  }
}
