/* eslint-disable @typescript-eslint/no-explicit-any */
import { decodePointerSegment, getByPointer } from './jsonPointer'
import type { Project, SourceState } from './loader'

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
export const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete'])

export interface OperationRef {
  sourceName: string
  method: string
  path: string
  operationId?: string
  operation: any
  pathItem: any
  doc: any
}

/** Resuelve $ref locales (#/...) de forma profunda. Las referencias externas se dejan tal cual. */
export function deref(doc: any, node: any, depth = 0, seen: string[] = []): any {
  if (depth > 40 || node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((n) => deref(doc, n, depth + 1, seen))
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
    if (seen.includes(node.$ref)) return {} // ciclo: se corta
    const target = getByPointer(doc, node.$ref.slice(1))
    if (!target.found) return node
    const { $ref: _ignored, ...siblings } = node
    void _ignored
    return { ...deref(doc, target.value, depth + 1, [...seen, node.$ref]), ...deref(doc, siblings, depth + 1, seen) }
  }
  const out: any = {}
  for (const [k, v] of Object.entries(node)) out[k] = deref(doc, v, depth + 1, seen)
  return out
}

export function listOperations(source: SourceState): OperationRef[] {
  const doc = source.doc
  if (!doc?.paths) return []
  const ops: OperationRef[] = []
  for (const [path, rawItem] of Object.entries<any>(doc.paths)) {
    const pathItem = deref(doc, rawItem)
    for (const method of HTTP_METHODS) {
      if (pathItem?.[method]) {
        ops.push({
          sourceName: source.name,
          method,
          path,
          operationId: pathItem[method].operationId,
          operation: pathItem[method],
          pathItem,
          doc,
        })
      }
    }
  }
  return ops
}

export function findByOperationId(project: Project, rawId: string): OperationRef[] {
  let sourceName: string | undefined
  let id = rawId
  // Forma calificada: $sourceDescriptions.<nombre>.<operationId>
  const m = rawId.match(/^\$sourceDescriptions\.([^.]+)\.(.+)$/)
  if (m) {
    sourceName = m[1]
    id = m[2]
  }
  const matches: OperationRef[] = []
  for (const s of project.sources) {
    if (s.status !== 'loaded') continue
    if (sourceName && s.name !== sourceName) continue
    for (const op of listOperations(s)) if (op.operationId === id) matches.push(op)
  }
  return matches
}

/**
 * Forma no estándar "<fuente>.<operationId>" (sin $sourceDescriptions).
 * Arazzo exige $sourceDescriptions.<fuente>.<operationId>, pero es un error común.
 */
export function findByLooseOperationId(project: Project, rawId: string): OperationRef[] {
  for (const s of project.sources) {
    if (rawId.startsWith(`${s.name}.`)) {
      const matches = findByOperationId(project, `$sourceDescriptions.${s.name}.${rawId.slice(s.name.length + 1)}`)
      if (matches.length) return matches
    }
  }
  return []
}

/** Sugerencia para un operationPath que no existe: misma operación con un prefijo de servidor incluido por error. */
export function findByPathSuffix(project: Project, operationPath: string): OperationRef | undefined {
  const idx = operationPath.indexOf('#')
  if (idx < 0) return undefined
  const segs = operationPath.slice(idx + 1).replace(/^\//, '').split('/').map(decodePointerSegment)
  if (segs.length < 3 || segs[0] !== 'paths') return undefined
  const m = operationPath.match(/\$sourceDescriptions\.([^.}]+)\.url/)
  const candidates = project.sources
    .filter((s) => s.status === 'loaded' && (!m || s.name === m[1]))
    .flatMap(listOperations)
    .filter((o) => o.method === segs[2].toLowerCase() && o.path !== '/' && segs[1].endsWith(o.path))
  return candidates.length === 1 ? candidates[0] : undefined
}

/** operationPath: '{$sourceDescriptions.<nombre>.url}#/paths/~1cards~1{id}/get' */
export function findByOperationPath(project: Project, operationPath: string): OperationRef | undefined {
  const m = operationPath.match(/\$sourceDescriptions\.([^.}]+)\.url\}?#(.*)$/)
  let sourceName: string | undefined
  let pointer: string
  if (m) {
    sourceName = m[1]
    pointer = m[2]
  } else {
    const idx = operationPath.indexOf('#')
    if (idx < 0) return undefined
    pointer = operationPath.slice(idx + 1)
  }
  const segs = pointer.replace(/^\//, '').split('/').map(decodePointerSegment)
  if (segs.length < 3 || segs[0] !== 'paths') return undefined
  const path = segs[1]
  const method = segs[2].toLowerCase()
  for (const s of project.sources) {
    if (s.status !== 'loaded') continue
    if (sourceName && s.name !== sourceName) continue
    const op = listOperations(s).find((o) => o.path === path && o.method === method)
    if (op) return op
  }
  return undefined
}

export function getServerUrl(source: SourceState | undefined): string {
  const server = source?.doc?.servers?.[0]
  if (!server?.url) return ''
  let url: string = server.url
  for (const [name, v] of Object.entries<any>(server.variables ?? {})) {
    url = url.replace(`{${name}}`, String(v?.default ?? ''))
  }
  // Servidor relativo: se combina con el origen de la URL del contrato, si es remota.
  if (url.startsWith('/') && source && /^https?:\/\//.test(source.url)) {
    try {
      url = new URL(url, source.url).toString()
    } catch {
      /* se deja tal cual */
    }
  }
  return url.replace(/\/$/, '')
}

export function operationParameters(op: OperationRef): any[] {
  const all = [...(op.pathItem?.parameters ?? []), ...(op.operation?.parameters ?? [])].map((p) => deref(op.doc, p))
  const byKey = new Map<string, any>()
  for (const p of all) byKey.set(`${p.in}:${String(p.name).toLowerCase()}`, p)
  return [...byKey.values()]
}

export function operationRequestBody(op: OperationRef): any | undefined {
  return op.operation?.requestBody ? deref(op.doc, op.operation.requestBody) : undefined
}

export function documentedStatuses(op: OperationRef): string[] {
  return Object.keys(op.operation?.responses ?? {})
}

/** Busca la respuesta documentada para un status concreto (exacto, 4XX, default). */
export function findResponse(op: OperationRef, status: number): { key: string; response: any } | undefined {
  const responses = op.operation?.responses ?? {}
  const exact = String(status)
  const range = `${exact[0]}XX`
  for (const key of [exact, range, range.toLowerCase(), 'default']) {
    if (responses[key]) return { key, response: deref(op.doc, responses[key]) }
  }
  return undefined
}

export function jsonSchemaOfResponse(response: any): any | undefined {
  const content = response?.content
  if (!content) return undefined
  const key =
    Object.keys(content).find((k) => k === 'application/json') ??
    Object.keys(content).find((k) => /json/i.test(k))
  return key ? content[key]?.schema : undefined
}

export interface SecurityScheme {
  key: string
  sourceName: string
  schemeName: string
  type: 'bearer' | 'basic' | 'apiKey' | 'oauth2' | 'openIdConnect' | 'other'
  in?: 'header' | 'query' | 'cookie'
  paramName?: string
  description?: string
}

export function operationSecurity(op: OperationRef): SecurityScheme[] {
  const reqs: any[] = op.operation?.security ?? op.doc?.security ?? []
  if (!reqs.length) return []
  // Varias alternativas (OR): se toma la primera que no sea vacía.
  const first = reqs.find((r) => r && Object.keys(r).length > 0)
  if (!first) return []
  const schemes = op.doc?.components?.securitySchemes ?? {}
  return Object.keys(first).map((name) => {
    const s = deref(op.doc, schemes[name] ?? {})
    let type: SecurityScheme['type'] = 'other'
    if (s.type === 'http' && String(s.scheme).toLowerCase() === 'bearer') type = 'bearer'
    else if (s.type === 'http' && String(s.scheme).toLowerCase() === 'basic') type = 'basic'
    else if (s.type === 'apiKey') type = 'apiKey'
    else if (s.type === 'oauth2') type = 'oauth2'
    else if (s.type === 'openIdConnect') type = 'openIdConnect'
    return {
      key: `${op.sourceName}:${name}`,
      sourceName: op.sourceName,
      schemeName: name,
      type,
      in: s.in,
      paramName: s.name,
      description: s.description,
    }
  })
}

/** Convierte un schema de OpenAPI 3.0 a JSON Schema (nullable → tipo null). */
export function toJsonSchema(schema: any): any {
  if (schema === null || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  const out: any = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'nullable' || k === 'example' || k === 'xml' || k === 'discriminator' || k === 'externalDocs') continue
    out[k] = toJsonSchema(v)
  }
  if (schema.nullable === true) {
    if (typeof out.type === 'string') out.type = [out.type, 'null']
    else if (out.enum) out.enum = [...out.enum, null]
  }
  return out
}
