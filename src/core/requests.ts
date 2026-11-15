/* eslint-disable @typescript-eslint/no-explicit-any */
// Requests sueltos de una colección, como en Postman: HTTP (REST), GraphQL, gRPC y WebSocket.
// Cada uno se guarda como un archivo YAML legible en requests/<nombre>.request.yaml, así se
// versiona con la colección. Los valores admiten {{variables}} del ambiente (y los secretos se
// quedan en el ambiente, nunca en el archivo).
import YAML from 'yaml'
import type { HttpRequest } from './http'
import { resolveTemplates } from './templates'
import { slugify } from './workspaceFormat'

export type RequestKind = 'http' | 'graphql' | 'grpc' | 'websocket'
export const REQUEST_KINDS: RequestKind[] = ['http', 'graphql', 'grpc', 'websocket']
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const REQUESTS_DIR = 'requests'
export const REQUEST_SUFFIX = '.request.yaml'

/** Una fila clave/valor (params, headers, form, metadata) que se puede desactivar sin borrarla. */
export interface KeyValue {
  key: string
  value: string
  enabled: boolean
  description?: string
}

export type BodyMode = 'none' | 'json' | 'text' | 'xml' | 'urlencoded' | 'formdata'

export interface RequestBody {
  mode: BodyMode
  /** json, text y xml. */
  text?: string
  /** urlencoded y formdata. */
  form?: KeyValue[]
}

/** Los mismos tipos que ofrece Bruno. `inherit` usa la autorización de la colección. */
/** `contract` (solo en los journeys): usar las credenciales del contrato, como siempre. */
export type AuthType = 'contract' | 'inherit' | 'none' | 'awsv4' | 'basic' | 'bearer' | 'digest' | 'ntlm' | 'oauth1' | 'oauth2' | 'wsse' | 'apikey' | 'akamai'
export const AUTH_TYPES: AuthType[] = ['awsv4', 'basic', 'bearer', 'digest', 'ntlm', 'oauth1', 'oauth2', 'wsse', 'apikey', 'akamai', 'inherit', 'none']

export interface RequestAuth {
  type: AuthType
  /** bearer (y oauth1: el token del usuario). */
  token?: string
  /** bearer: prefijo del header (por defecto, Bearer). */
  prefix?: string
  /** basic, digest, ntlm, wsse y oauth2 (grant password). */
  username?: string
  password?: string
  /** ntlm. */
  domain?: string
  workstation?: string
  /** apikey: nombre del header o del query param. */
  key?: string
  value?: string
  in?: 'header' | 'query'
  /** oauth1. */
  consumerKey?: string
  consumerSecret?: string
  tokenSecret?: string
  signatureMethod?: 'HMAC-SHA1' | 'HMAC-SHA256' | 'PLAINTEXT'
  realm?: string
  addTo?: 'header' | 'query'
  /** oauth2. */
  grantType?: 'client_credentials' | 'password' | 'authorization_code'
  accessTokenUrl?: string
  authorizationUrl?: string
  callbackUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  audience?: string
  pkce?: boolean
  credentialsIn?: 'header' | 'body'
  tokenIn?: 'header' | 'query'
  headerPrefix?: string
  /** awsv4. */
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  region?: string
  service?: string
  /** akamai (EdgeGrid): además usa clientSecret. */
  clientToken?: string
  accessToken?: string
  headersToSign?: string
  maxBodySize?: string
}

/**
 * Campos de la autorización que son secretos. Si se escriben tal cual (sin {{variable}}) no van al
 * archivo del request: se guardan cifrados en este equipo.
 */
export const SECRET_AUTH_FIELDS = ['token', 'password', 'value', 'consumerSecret', 'tokenSecret', 'clientSecret', 'secretAccessKey', 'sessionToken', 'clientToken', 'accessToken'] as const
type SecretField = (typeof SECRET_AUTH_FIELDS)[number]

/** Un valor que solo nombra variables del ambiente ({{token}}) puede ir al archivo. */
const isReference = (v: string) => v.includes('{{')

/** Separa los secretos escritos tal cual de la autorización (para guardarlos fuera del archivo). */
export function splitAuthSecrets(auth: RequestAuth | undefined): { auth: RequestAuth | undefined; secrets: Record<string, string> } {
  if (!auth) return { auth, secrets: {} }
  const secrets: Record<string, string> = {}
  const clean: RequestAuth = { ...auth }
  for (const f of SECRET_AUTH_FIELDS) {
    const v = auth[f]
    if (typeof v === 'string' && v && !isReference(v)) {
      secrets[f] = v
      delete clean[f]
    }
  }
  return { auth: clean, secrets }
}

/** Vuelve a poner los secretos (leídos del almacén de este equipo) en la autorización. */
export function withAuthSecrets(auth: RequestAuth | undefined, secrets: Record<string, string> | undefined): RequestAuth | undefined {
  if (!auth || !secrets) return auth
  const out: RequestAuth = { ...auth }
  for (const [k, v] of Object.entries(secrets)) if ((SECRET_AUTH_FIELDS as readonly string[]).includes(k)) out[k as SecretField] = v
  return out
}

/** La autorización que vale para el request: la suya o, con `inherit`, la de la colección. */
export function effectiveAuth(r: SavedRequest, collection?: RequestAuth): RequestAuth {
  const own = r.auth ?? { type: 'none' }
  return own.type === 'inherit' ? (collection && collection.type !== 'inherit' ? collection : { type: 'none' }) : own
}

export interface SavedRequest {
  /** Ruta dentro de la colección (requests/<nombre>.request.yaml); es su identidad. */
  path: string
  name: string
  kind: RequestKind
  description?: string
  /** HTTP y GraphQL: método y URL. gRPC: host:puerto. WebSocket: ws:// o wss://. */
  method?: string
  url: string
  params?: KeyValue[]
  headers?: KeyValue[]
  auth?: RequestAuth
  body?: RequestBody
  /** GraphQL. */
  query?: string
  variables?: string
  /** gRPC: el .proto (ruta dentro de la colección), servicio y método, y el mensaje en JSON. */
  proto?: string
  service?: string
  rpc?: string
  message?: string
  tls?: boolean
  /** WebSocket: mensajes guardados para reenviarlos. */
  messages?: { name: string; text: string }[]
}

export const isRequestPath = (path: string) => path.endsWith(REQUEST_SUFFIX)

const DEFAULTS: Record<RequestKind, (name: string) => Omit<SavedRequest, 'path'>> = {
  http: (name) => ({ name, kind: 'http', method: 'GET', url: '', params: [], headers: [], auth: { type: 'inherit' }, body: { mode: 'none' } }),
  graphql: (name) => ({
    name,
    kind: 'graphql',
    method: 'POST',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'inherit' },
    query: 'query {\n  \n}\n',
    variables: '{}',
  }),
  grpc: (name) => ({ name, kind: 'grpc', url: 'localhost:50051', params: [], headers: [], auth: { type: 'none' }, message: '{}', tls: false }),
  websocket: (name) => ({ name, kind: 'websocket', url: 'wss://', params: [], headers: [], auth: { type: 'inherit' }, messages: [{ name: 'Mensaje 1', text: '{\n  "type": "ping"\n}' }] }),
}

/** Ruta libre para un request nuevo: requests/<slug>.request.yaml, sin pisar otros. */
export function requestPath(name: string, taken: string[]): string {
  const base = slugify(name) || 'request'
  let path = `${REQUESTS_DIR}/${base}${REQUEST_SUFFIX}`
  for (let i = 2; taken.includes(path); i++) path = `${REQUESTS_DIR}/${base}-${i}${REQUEST_SUFFIX}`
  return path
}

export function newRequest(kind: RequestKind, name: string, taken: string[]): SavedRequest {
  return { path: requestPath(name, taken), ...DEFAULTS[kind](name) }
}

/** Sin filas vacías ni campos que no aplican, para que el archivo quede limpio. */
function compact(r: SavedRequest): Record<string, any> {
  const rows = (list?: KeyValue[]) => list?.filter((x) => x.key || x.value).map((x) => ({ key: x.key, value: x.value, ...(x.enabled ? {} : { enabled: false }), ...(x.description ? { description: x.description } : {}) }))
  const out: Record<string, any> = { name: r.name, kind: r.kind }
  if (r.description) out.description = r.description
  if (r.kind === 'http' || r.kind === 'graphql') out.method = r.method ?? 'GET'
  out.url = r.url
  const params = rows(r.params)
  if (params?.length) out.params = params
  const headers = rows(r.headers)
  if (headers?.length) out[r.kind === 'grpc' ? 'metadata' : 'headers'] = headers
  // Los secretos escritos tal cual no van al archivo (ver splitAuthSecrets).
  const auth = splitAuthSecrets(r.auth).auth
  if (auth && auth.type !== 'none') out.auth = Object.fromEntries(Object.entries(auth).filter(([, v]) => v !== undefined && v !== ''))
  if (r.kind === 'http' && r.body && r.body.mode !== 'none') {
    out.body = { mode: r.body.mode, ...(r.body.mode === 'urlencoded' || r.body.mode === 'formdata' ? { form: rows(r.body.form) ?? [] } : { text: r.body.text ?? '' }) }
  }
  if (r.kind === 'graphql') {
    out.query = r.query ?? ''
    if (r.variables && r.variables.trim() && r.variables.trim() !== '{}') out.variables = r.variables
  }
  if (r.kind === 'grpc') {
    for (const k of ['proto', 'service', 'rpc'] as const) if (r[k]) out[k] = r[k]
    out.message = r.message ?? '{}'
    if (r.tls) out.tls = true
  }
  if (r.kind === 'websocket' && r.messages?.length) out.messages = r.messages
  return out
}

export function serializeRequest(r: SavedRequest): string {
  return YAML.stringify(compact(r), { lineWidth: 0, blockQuote: 'literal' })
}

const toRows = (v: any): KeyValue[] =>
  Array.isArray(v)
    ? v.filter((x) => x && typeof x === 'object').map((x) => ({ key: String(x.key ?? ''), value: String(x.value ?? ''), enabled: x.enabled !== false, ...(x.description ? { description: String(x.description) } : {}) }))
    : []

/** Lee un request; undefined si el archivo no lo es (o está roto). */
export function parseRequest(path: string, text: string): SavedRequest | undefined {
  let doc: any
  try {
    doc = YAML.parse(text)
  } catch {
    return undefined
  }
  if (!doc || typeof doc !== 'object' || !REQUEST_KINDS.includes(doc.kind)) return undefined
  const kind = doc.kind as RequestKind
  const base = DEFAULTS[kind](String(doc.name ?? path.split('/').pop()?.replace(REQUEST_SUFFIX, '') ?? 'request'))
  return {
    ...base,
    path,
    ...(doc.description ? { description: String(doc.description) } : {}),
    ...(doc.method ? { method: String(doc.method).toUpperCase() } : {}),
    url: String(doc.url ?? ''),
    params: toRows(doc.params),
    headers: toRows(kind === 'grpc' ? doc.metadata : doc.headers),
    auth: doc.auth && typeof doc.auth === 'object' ? { type: 'none', ...doc.auth } : { type: 'none' },
    ...(kind === 'http' ? { body: doc.body?.mode ? { mode: doc.body.mode, text: doc.body.text ?? '', form: toRows(doc.body.form) } : { mode: 'none' } } : {}),
    ...(kind === 'graphql' ? { query: String(doc.query ?? ''), variables: typeof doc.variables === 'string' ? doc.variables : doc.variables ? JSON.stringify(doc.variables, null, 2) : '{}' } : {}),
    ...(kind === 'grpc'
      ? { ...(doc.proto ? { proto: String(doc.proto) } : {}), ...(doc.service ? { service: String(doc.service) } : {}), ...(doc.rpc ? { rpc: String(doc.rpc) } : {}), message: typeof doc.message === 'string' ? doc.message : JSON.stringify(doc.message ?? {}, null, 2), tls: !!doc.tls }
      : {}),
    ...(kind === 'websocket' ? { messages: Array.isArray(doc.messages) ? doc.messages.map((m: any, i: number) => ({ name: String(m?.name ?? `#${i + 1}`), text: String(m?.text ?? '') })) : [] } : {}),
  }
}

const active = (rows?: KeyValue[]) => (rows ?? []).filter((r) => r.enabled && r.key.trim())

/** Agrega los params (activos) a la URL, respetando los que ya trae. */
export function urlWithParams(url: string, params: KeyValue[] = []): string {
  const list = active(params)
  if (!list.length) return url
  const query = list.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
  const [beforeHash, hash] = url.split('#', 2)
  return `${beforeHash}${beforeHash.includes('?') ? (beforeHash.endsWith('?') || beforeHash.endsWith('&') ? '' : '&') : '?'}${query}${hash !== undefined ? `#${hash}` : ''}`
}

/** Separa la query de una URL en filas (lo que hace Postman al pegar una URL con ?a=1). */
export function splitQuery(url: string): { base: string; params: KeyValue[] } {
  const i = url.indexOf('?')
  if (i < 0) return { base: url, params: [] }
  const params = url
    .slice(i + 1)
    .split('#')[0]
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [k, ...v] = pair.split('=')
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, ' '))
        } catch {
          return s
        }
      }
      return { key: dec(k), value: dec(v.join('=')), enabled: true }
    })
  return { base: url.slice(0, i), params }
}

const hasHeader = (h: Record<string, string>, name: string) => Object.keys(h).some((k) => k.toLowerCase() === name.toLowerCase())

/** Base64 de un texto UTF-8 (para Basic auth). */
function base64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Aplica la autenticación a los headers o a la URL. */
export function applyAuth(auth: RequestAuth | undefined, headers: Record<string, string>, url: string): string {
  if (!auth || auth.type === 'none') return url
  if (auth.type === 'bearer' && auth.token) headers.Authorization ??= `${auth.prefix ?? 'Bearer'} ${auth.token}`.trim()
  if (auth.type === 'basic' && (auth.username || auth.password)) headers.Authorization ??= `Basic ${base64(`${auth.username ?? ''}:${auth.password ?? ''}`)}`
  if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query') return urlWithParams(url, [{ key: auth.key, value: auth.value ?? '', enabled: true }])
    headers[auth.key] ??= auth.value ?? ''
  }
  return url
}

/** El request con las {{variables}} del ambiente resueltas. */
export function resolveRequest(r: SavedRequest, variables: Record<string, string>): SavedRequest {
  return resolveTemplates(r, variables)
}

/** La petición HTTP lista para enviar (HTTP y GraphQL), con variables ya resueltas. */
export function buildHttpRequest(r: SavedRequest): HttpRequest {
  const headers: Record<string, string> = {}
  for (const h of active(r.headers)) headers[h.key] = h.value
  let url = urlWithParams(r.url.trim(), r.params)
  url = applyAuth(r.auth, headers, url)
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(url) && url) url = `http://${url}`
  if (r.kind === 'graphql') {
    let variables: any
    try {
      variables = r.variables?.trim() ? JSON.parse(r.variables) : undefined
    } catch {
      throw new Error('variables')
    }
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json'
    return { method: (r.method ?? 'POST').toUpperCase(), url, headers, body: JSON.stringify({ query: r.query ?? '', ...(variables ? { variables } : {}) }) }
  }
  const method = (r.method ?? 'GET').toUpperCase()
  const body = r.body ?? { mode: 'none' }
  let text: string | undefined
  const contentType = (type: string) => !hasHeader(headers, 'content-type') && (headers['Content-Type'] = type)
  if (body.mode === 'json') {
    text = body.text ?? ''
    contentType('application/json')
  } else if (body.mode === 'xml') {
    text = body.text ?? ''
    contentType('application/xml')
  } else if (body.mode === 'text') {
    text = body.text ?? ''
    contentType('text/plain')
  } else if (body.mode === 'urlencoded') {
    text = new URLSearchParams(active(body.form).map((f) => [f.key, f.value])).toString()
    contentType('application/x-www-form-urlencoded')
  } else if (body.mode === 'formdata') {
    // multipart con campos de texto, armado a mano para que también viaje por el puente de escritorio.
    const boundary = `----ArazzoStudio${Math.random().toString(16).slice(2)}`
    text =
      active(body.form)
        .map((f) => `--${boundary}\r\nContent-Disposition: form-data; name="${f.key.replace(/"/g, '%22')}"\r\n\r\n${f.value}\r\n`)
        .join('') + `--${boundary}--\r\n`
    contentType(`multipart/form-data; boundary=${boundary}`)
  }
  return { method, url, headers, ...(text !== undefined && method !== 'GET' && method !== 'HEAD' ? { body: text } : {}) }
}

/** Nombre corto para la pestaña o el árbol cuando el request no tiene nombre propio. */
export function requestLabel(r: SavedRequest): string {
  return r.name || r.url || r.path
}

/** Etiqueta del tipo (o del método, en HTTP) y su clase de color. */
export function requestBadge(r: SavedRequest): { text: string; cls: string } {
  if (r.kind === 'graphql') return { text: 'GQL', cls: 'm-gql' }
  if (r.kind === 'grpc') return { text: 'gRPC', cls: 'm-grpc' }
  if (r.kind === 'websocket') return { text: 'WS', cls: 'm-ws' }
  const m = (r.method ?? 'GET').toUpperCase()
  return { text: m === 'DELETE' ? 'DEL' : m === 'OPTIONS' ? 'OPT' : m, cls: `m-${m.toLowerCase()}` }
}
