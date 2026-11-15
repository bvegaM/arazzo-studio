// Autorización de los journeys, propia de Arazzo Studio (el Arazzo no tiene un concepto de auth):
// se elige por API (sourceDescription) para todos los journeys y, si hace falta, por journey. Vive
// en flow-auth.yaml de la colección, sin secretos escritos tal cual; el Arazzo no se toca.
//
// Para un paso que llama a la API S dentro del journey J, gana lo más específico:
//   1. lo configurado en J para S;
//   2. lo configurado para S en la colección;
//   3. por defecto, las credenciales del contrato (securitySchemes del ambiente), como siempre.
import YAML from 'yaml'
import { splitAuthSecrets, withAuthSecrets, type RequestAuth } from './requests'
import type { WorkflowAnalysis } from './analyze'
import { isAsyncOperation, type SecurityScheme } from './openapi'

export const FLOW_AUTH_FILE = 'flow-auth.yaml'

export interface FlowAuth {
  /** Por API (nombre de la sourceDescription), para todos los journeys. */
  apis: Record<string, RequestAuth>
  /** Por journey (archivo#workflowId) y API. */
  journeys: Record<string, Record<string, RequestAuth>>
}

export const emptyFlowAuth = (): FlowAuth => ({ apis: {}, journeys: {} })

/** Dónde se definió la autorización que se usa (para explicarlo en la interfaz). */
export type FlowAuthOrigin = 'journey' | 'api' | 'collection' | 'contract'

export interface ResolvedFlowAuth {
  /** undefined: se usan las credenciales del contrato. */
  auth?: RequestAuth
  origin: FlowAuthOrigin
  /** Dónde se guarda su token de OAuth 2.0. */
  tokenKey?: string
}

export const apiTokenKey = (source: string) => `flow:api:${source}`
export const journeyTokenKey = (journey: string, source: string) => `flow:${journey}:${source}`

/**
 * La autorización de un paso. `collection` es la de la colección (para `inherit` a nivel API) y
 * `collectionToken` la clave de su token.
 */
export function resolveFlowAuth(cfg: FlowAuth, journey: string, source: string, collection: RequestAuth, collectionToken: string): ResolvedFlowAuth {
  const own = cfg.journeys[journey]?.[source]
  if (own && own.type !== 'inherit') {
    return own.type === 'contract' ? { origin: 'journey' } : { auth: own, origin: 'journey', tokenKey: journeyTokenKey(journey, source) }
  }
  const api = cfg.apis[source]
  if (!api || api.type === 'contract') return { origin: 'contract' }
  if (api.type === 'inherit') {
    // La colección sin autorización: el paso va sin ella (no se mezcla con la del contrato).
    return collection.type === 'none' || collection.type === 'inherit' ? { auth: { type: 'none' }, origin: 'collection' } : { auth: collection, origin: 'collection', tokenKey: collectionToken }
  }
  return { auth: api, origin: 'api', tokenKey: apiTokenKey(source) }
}

const isEmpty = (o: object) => Object.keys(o).length === 0

/** Sin entradas que dejan todo como estaba (contrato a nivel API, heredar a nivel journey). */
function compact(cfg: FlowAuth): FlowAuth {
  const apis = Object.fromEntries(Object.entries(cfg.apis).filter(([, a]) => a.type !== 'contract'))
  const journeys = Object.fromEntries(
    Object.entries(cfg.journeys)
      .map(([j, bySource]) => [j, Object.fromEntries(Object.entries(bySource).filter(([, a]) => a.type !== 'inherit'))] as const)
      .filter(([, bySource]) => !isEmpty(bySource)),
  )
  return { apis, journeys }
}

export interface FlowAuthSecrets {
  apis: Record<string, Record<string, string>>
  journeys: Record<string, Record<string, Record<string, string>>>
}

/** Separa los secretos escritos tal cual (van cifrados al equipo, no al archivo). */
export function splitFlowAuthSecrets(cfg: FlowAuth): { cfg: FlowAuth; secrets: FlowAuthSecrets } {
  const c = compact(cfg)
  const secrets: FlowAuthSecrets = { apis: {}, journeys: {} }
  const apis: Record<string, RequestAuth> = {}
  for (const [s, a] of Object.entries(c.apis)) {
    const split = splitAuthSecrets(a)
    apis[s] = split.auth!
    if (!isEmpty(split.secrets)) secrets.apis[s] = split.secrets
  }
  const journeys: FlowAuth['journeys'] = {}
  for (const [j, bySource] of Object.entries(c.journeys)) {
    journeys[j] = {}
    for (const [s, a] of Object.entries(bySource)) {
      const split = splitAuthSecrets(a)
      journeys[j][s] = split.auth!
      if (!isEmpty(split.secrets)) (secrets.journeys[j] ??= {})[s] = split.secrets
    }
  }
  return { cfg: { apis, journeys }, secrets }
}

export function withFlowAuthSecrets(cfg: FlowAuth, secrets: Partial<FlowAuthSecrets> | undefined): FlowAuth {
  if (!secrets) return cfg
  return {
    apis: Object.fromEntries(Object.entries(cfg.apis).map(([s, a]) => [s, withAuthSecrets(a, secrets.apis?.[s])!])),
    journeys: Object.fromEntries(
      Object.entries(cfg.journeys).map(([j, bySource]) => [j, Object.fromEntries(Object.entries(bySource).map(([s, a]) => [s, withAuthSecrets(a, secrets.journeys?.[j]?.[s])!]))]),
    ),
  }
}

export const hasFlowSecrets = (s: FlowAuthSecrets) => !isEmpty(s.apis) || !isEmpty(s.journeys)

/** El archivo (sin secretos); undefined si no hay nada configurado. */
export function serializeFlowAuth(cfg: FlowAuth): string | undefined {
  const { cfg: clean } = splitFlowAuthSecrets(cfg)
  if (isEmpty(clean.apis) && isEmpty(clean.journeys)) return undefined
  const header = '# Autorización de Arazzo Studio para los journeys: por API y por journey. No forma parte del\n# Arazzo. Los secretos escritos tal cual se guardan cifrados en cada equipo, no aquí.\n'
  return header + YAML.stringify({ ...(isEmpty(clean.apis) ? {} : { apis: clean.apis }), ...(isEmpty(clean.journeys) ? {} : { journeys: clean.journeys }) }, { lineWidth: 0 })
}

const isAuth = (v: unknown): v is RequestAuth => !!v && typeof v === 'object' && typeof (v as RequestAuth).type === 'string'

export function parseFlowAuth(text: string | undefined): FlowAuth {
  if (!text) return emptyFlowAuth()
  let doc: { apis?: unknown; journeys?: unknown }
  try {
    doc = YAML.parse(text) ?? {}
  } catch {
    return emptyFlowAuth()
  }
  const apis = Object.fromEntries(Object.entries((doc.apis as Record<string, unknown>) ?? {}).filter(([, a]) => isAuth(a))) as Record<string, RequestAuth>
  const journeys: FlowAuth['journeys'] = {}
  for (const [j, bySource] of Object.entries((doc.journeys as Record<string, unknown>) ?? {})) {
    if (!bySource || typeof bySource !== 'object') continue
    const entries = Object.entries(bySource).filter(([, a]) => isAuth(a))
    if (entries.length) journeys[j] = Object.fromEntries(entries) as Record<string, RequestAuth>
  }
  return { apis, journeys }
}

/** Al renombrar un Arazzo, sus journeys cambian de clave (archivo#workflowId). */
export function renameFlowFile(cfg: FlowAuth, from: string, to: string): FlowAuth {
  return {
    apis: cfg.apis,
    journeys: Object.fromEntries(Object.entries(cfg.journeys).map(([j, v]) => [j.startsWith(`${from}#`) ? `${to}${j.slice(from.length)}` : j, v])),
  }
}

/** Las APIs (HTTP) que llama el journey, con lo que pide el contrato de cada una. */
export function journeyApis(wa: WorkflowAnalysis): { source: string; schemes: SecurityScheme[] }[] {
  const by = new Map<string, Map<string, SecurityScheme>>()
  for (const rs of wa.steps) {
    if (!rs.op || isAsyncOperation(rs.op)) continue
    const m = by.get(rs.op.sourceName) ?? new Map()
    for (const s of rs.security) m.set(s.key, s)
    by.set(rs.op.sourceName, m)
  }
  return [...by].map(([source, m]) => ({ source, schemes: [...m.values()] }))
}

