/* eslint-disable @typescript-eslint/no-explicit-any */
// Revisión de contratos (OpenAPI 3.x y AsyncAPI 2.x/3.x) para editarlos: lo que importa para que un
// Arazzo los use bien (operationId únicos, parámetros de ruta, respuestas, $ref internos) y la lista
// de operaciones para navegar. Cada problema lleva la ruta dentro del documento, para ubicarlo.
import YAML, { isMap, isPair, isScalar, isSeq, type Node } from 'yaml'
import type { Issue } from './analyze'
import type { TextProblem } from './authoring'
import { t } from '../i18n'

export type DocPath = (string | number)[]

export interface ContractIssue {
  level: Issue['level']
  message: string
  path: DocPath
}

export interface OutlineItem {
  /** GET, POST… o SEND / RECEIVE. */
  method: string
  /** Ruta HTTP o canal. */
  target: string
  operationId?: string
  summary?: string
  path: DocPath
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const PARAM_IN = ['query', 'header', 'path', 'cookie']
const STATUS_KEY = /^([1-5](\d\d|XX)|default)$/

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Resuelve un $ref interno ("#/components/..."); undefined si no existe. */
function resolvePointer(doc: any, ref: string): any {
  if (!ref.startsWith('#/')) return undefined
  let node = doc
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isObj(node) && !Array.isArray(node)) return undefined
    node = (node as any)[key]
    if (node === undefined) return undefined
  }
  return node
}

const deref = (doc: any, v: any) => (isObj(v) && typeof v.$ref === 'string' ? (resolvePointer(doc, v.$ref) ?? v) : v)

/** Todos los $ref internos que no apuntan a nada. */
function brokenRefs(doc: any, node: any, path: DocPath, out: ContractIssue[]) {
  if (Array.isArray(node)) node.forEach((x, i) => brokenRefs(doc, x, [...path, i], out))
  else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#') && resolvePointer(doc, v) === undefined) {
        out.push({ level: 'error', message: t('clint.brokenRef', { ref: v }), path: [...path, '$ref'] })
      } else brokenRefs(doc, v, [...path, k], out)
    }
  }
}

function lintInfo(doc: any, out: ContractIssue[]) {
  if (!isObj(doc.info)) out.push({ level: 'warning', message: t('clint.noInfo'), path: [] })
  else {
    if (!doc.info.title) out.push({ level: 'warning', message: t('clint.noTitle'), path: ['info'] })
    if (!doc.info.version) out.push({ level: 'warning', message: t('clint.noVersion'), path: ['info'] })
  }
}

function lintOpenApi(doc: any): ContractIssue[] {
  const out: ContractIssue[] = []
  if (doc.swagger) out.push({ level: 'warning', message: t('clint.swagger2'), path: ['swagger'] })
  else if (!/^3\./.test(String(doc.openapi))) out.push({ level: 'warning', message: t('clint.openapiVersion', { v: String(doc.openapi) }), path: ['openapi'] })
  lintInfo(doc, out)
  if (!Array.isArray(doc.servers) || !doc.servers.length) out.push({ level: 'info', message: t('clint.noServers'), path: [] })
  if (!isObj(doc.paths)) {
    out.push({ level: 'error', message: t('clint.noPaths'), path: [] })
    return out
  }
  const ids = new Map<string, DocPath>()
  for (const [route, rawItem] of Object.entries<any>(doc.paths)) {
    const base: DocPath = ['paths', route]
    if (!route.startsWith('/')) out.push({ level: 'error', message: t('clint.pathSlash', { path: route }), path: base })
    const item = deref(doc, rawItem)
    if (!isObj(item)) continue
    const templated = [...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
    const shared = (Array.isArray(item.parameters) ? item.parameters : []).map((p: any) => deref(doc, p))
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (!isObj(op)) continue
      const at: DocPath = [...base, method]
      if (op.operationId) {
        const prev = ids.get(op.operationId)
        if (prev) out.push({ level: 'error', message: t('clint.dupOperationId', { id: op.operationId }), path: [...at, 'operationId'] })
        else ids.set(op.operationId, at)
      } else out.push({ level: 'info', message: t('clint.noOperationId', { op: `${method.toUpperCase()} ${route}` }), path: at })
      if (!isObj(op.responses) || !Object.keys(op.responses).length) out.push({ level: 'warning', message: t('clint.noResponses', { op: `${method.toUpperCase()} ${route}` }), path: at })
      else
        for (const code of Object.keys(op.responses))
          if (!STATUS_KEY.test(code)) out.push({ level: 'warning', message: t('clint.badStatus', { code }), path: [...at, 'responses', code] })
      const own = (Array.isArray(op.parameters) ? op.parameters : []).map((p: any) => deref(doc, p))
      ;(Array.isArray(op.parameters) ? op.parameters : []).forEach((raw: any, i: number) => {
        const p = deref(doc, raw)
        if (!isObj(p) || !p.name || !PARAM_IN.includes(p.in)) out.push({ level: 'error', message: t('clint.badParam'), path: [...at, 'parameters', i] })
        else if (p.in === 'path' && p.required !== true) out.push({ level: 'error', message: t('clint.pathRequired', { name: p.name }), path: [...at, 'parameters', i] })
        else if (p.in === 'path' && !templated.includes(p.name)) out.push({ level: 'error', message: t('clint.pathNotInRoute', { name: p.name, path: route }), path: [...at, 'parameters', i] })
      })
      const declared = [...shared, ...own].filter((p) => isObj(p) && p.in === 'path').map((p) => p.name)
      for (const name of templated)
        if (!declared.includes(name)) out.push({ level: 'error', message: t('clint.pathUndeclared', { name, op: `${method.toUpperCase()} ${route}` }), path: at })
    }
  }
  brokenRefs(doc, doc, [], out)
  return out
}

function lintAsyncApi(doc: any): ContractIssue[] {
  const out: ContractIssue[] = []
  const v3 = /^3\./.test(String(doc.asyncapi))
  if (!/^[23]\./.test(String(doc.asyncapi))) out.push({ level: 'warning', message: t('clint.asyncapiVersion', { v: String(doc.asyncapi) }), path: ['asyncapi'] })
  lintInfo(doc, out)
  if (!isObj(doc.channels)) out.push({ level: 'error', message: t('clint.noChannels'), path: [] })
  if (v3) {
    for (const [id, raw] of Object.entries<any>(isObj(doc.operations) ? doc.operations : {})) {
      const op = deref(doc, raw)
      const at: DocPath = ['operations', id]
      if (!isObj(op)) continue
      if (op.action !== 'send' && op.action !== 'receive') out.push({ level: 'error', message: t('clint.badAction', { id }), path: at })
      if (!isObj(op.channel) || typeof op.channel.$ref !== 'string') out.push({ level: 'error', message: t('clint.noChannelRef', { id }), path: at })
    }
  } else {
    const ids = new Set<string>()
    for (const [channel, raw] of Object.entries<any>(isObj(doc.channels) ? doc.channels : {}))
      for (const kind of ['publish', 'subscribe']) {
        const op = raw?.[kind]
        if (!isObj(op)) continue
        if (op.operationId && ids.has(op.operationId)) out.push({ level: 'error', message: t('clint.dupOperationId', { id: op.operationId }), path: ['channels', channel, kind, 'operationId'] })
        if (op.operationId) ids.add(op.operationId)
      }
  }
  brokenRefs(doc, doc, [], out)
  return out
}

/** Problemas de un contrato; [] si no es OpenAPI ni AsyncAPI (p. ej. un archivo de schemas). */
export function lintContract(doc: any): ContractIssue[] {
  if (!isObj(doc)) return []
  if (doc.openapi || doc.swagger) return lintOpenApi(doc)
  if (doc.asyncapi) return lintAsyncApi(doc)
  return []
}

/** Operaciones del contrato, en el orden del documento, para navegar. */
export function contractOutline(doc: any): OutlineItem[] {
  if (!isObj(doc)) return []
  const out: OutlineItem[] = []
  if (isObj(doc.paths)) {
    for (const [route, rawItem] of Object.entries<any>(doc.paths)) {
      const item = deref(doc, rawItem)
      for (const method of HTTP_METHODS)
        if (isObj(item?.[method]))
          out.push({ method: method.toUpperCase(), target: route, operationId: item[method].operationId, summary: item[method].summary, path: ['paths', route, method] })
    }
  } else if (doc.asyncapi && /^3\./.test(String(doc.asyncapi)) && isObj(doc.operations)) {
    for (const [id, raw] of Object.entries<any>(doc.operations)) {
      const op = deref(doc, raw)
      const channel = isObj(op?.channel) ? deref(doc, op.channel) : undefined
      out.push({ method: String(op?.action ?? '?').toUpperCase(), target: channel?.address ?? String(op?.channel?.$ref ?? '').split('/').pop() ?? '', operationId: id, summary: op?.summary, path: ['operations', id] })
    }
  } else if (doc.asyncapi && isObj(doc.channels)) {
    // AsyncAPI 2: publish = la app envía al broker (SEND), subscribe = recibe (RECEIVE).
    for (const [channel, raw] of Object.entries<any>(doc.channels))
      for (const [kind, method] of [
        ['publish', 'SEND'],
        ['subscribe', 'RECEIVE'],
      ] as const)
        if (isObj(raw?.[kind])) out.push({ method, target: channel, operationId: raw[kind].operationId, summary: raw[kind].summary, path: ['channels', channel, kind] })
  }
  return out
}

/** Posición en el texto de una ruta del documento (la clave y su valor); si no existe, la más cercana. */
export function pathRange(text: string, path: DocPath): [number, number] {
  const doc = YAML.parseDocument(text)
  let node: unknown = doc.contents
  let found: [number, number] | undefined
  for (const seg of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isPair(p) && isScalar(p.key) && String(p.key.value) === String(seg))
      if (!pair || !isScalar(pair.key) || !pair.key.range) break
      const end = (pair.value as Node | null)?.range?.[1] ?? pair.key.range[1]
      found = [pair.key.range[0], end]
      node = pair.value
    } else if (isSeq(node) && typeof seg === 'number') {
      const item = node.items[seg] as Node | undefined
      if (!item?.range) break
      found = [item.range[0], item.range[1]]
      node = item
    } else break
  }
  if (found) return found
  // Sin ruta (problema del documento entero): la primera línea.
  const firstLine = text.indexOf('\n')
  return [0, firstLine > 0 ? firstLine : Math.min(text.length, 1)]
}

/** Los problemas del contrato con su posición en el texto. Solo marca la primera línea del rango. */
export function contractProblems(text: string, issues: ContractIssue[]): TextProblem[] {
  return issues.map((i) => {
    const [from, to] = pathRange(text, i.path)
    const lineEnd = text.indexOf('\n', from)
    return { from, to: lineEnd > from ? Math.min(lineEnd, to) : to, level: i.level, message: i.message }
  })
}
