// Requests sueltos de la colección (HTTP, GraphQL, gRPC y WebSocket): su estado, cómo se guardan
// junto a la colección y cómo se envían. Los resultados de cada uno quedan en memoria mientras la
// colección esté abierta (no se guardan en disco).
import { useRef, useState } from 'react'
import {
  applyAuth,
  buildHttpRequest,
  effectiveAuth,
  newRequest,
  parseRequest,
  requestPath,
  resolveRequest,
  serializeRequest,
  splitAuthSecrets,
  urlWithParams,
  withAuthSecrets,
  type KeyValue,
  type RequestAuth,
  type RequestKind,
  type SavedRequest,
} from '../core/requests'
import { needsServer, oauth2Config, signRequest } from '../core/auth/apply'
import { apiTokenKey, emptyFlowAuth, journeyTokenKey, renameFlowFile, resolveFlowAuth, serializeFlowAuth, splitFlowAuthSecrets, type FlowAuth } from '../core/flowAuth'
import { journeyKey } from '../core/collection'
import { applyToken, authorizationUrl, newState, parseTokenResponse, pkcePair, readCallback, tokenRequest, tokenValid, type OAuth2Token } from '../core/auth/oauth2'
import { digestAuthorization, parseDigestChallenge } from '../core/auth/sign'
import { nameFromUrl, parseCurl } from '../core/curlImport'
import { NetworkError, type HttpExecutor, type HttpRequest, type HttpResponse } from '../core/http'
import { redactSecrets } from '../core/environments'
import { loadFaker } from '../core/dynamicVars'
import { desktop, type GrpcResult, type GrpcService } from '../lib/desktop'
import { byteSize, log, logNetwork } from '../lib/devlog'
import { wsForget } from '../lib/wsClient'
import { resolveTemplates } from '../core/templates'
import { t } from '../i18n'

export type RequestResult =
  | { kind: 'http'; request: HttpRequest; response?: HttpResponse; error?: string; at: number; /** El error es de la autorización, no de la red. */ authError?: boolean }
  | { kind: 'grpc'; result: GrpcResult; at: number }

export interface RequestEnv {
  variables: Record<string, string>
  secrets: string[]
}

const PROTO_DIR = 'protos'
/** Clave del token de OAuth 2.0 de la colección (los requests con `inherit` lo comparten). */
export const COLLECTION_TOKEN = '#collection'
/** URL de callback por defecto en la versión web: vuelve a esta app (ver main.tsx). */
export const webCallbackUrl = () => `${window.location.origin}/oauth2/callback`
// Las autorizaciones que el armado del request resuelve solo (el resto se firma o negocia después).
const BUILT_IN = new Set(['basic', 'bearer', 'apikey'])

/** Un problema de la autorización (no de la red): el runner muestra su mensaje tal cual. */
class AuthError extends Error {
  name = 'AuthError'
}

/** Versión web del authorization code: una ventana emergente que vuelve a /oauth2/callback. */
function authorizeInPopup(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'arazzo-oauth2', 'width=520,height=720')
    if (!popup) return reject(new AuthError(t('request.oauth2.popupBlocked')))
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'arazzo-oauth2') return
      cleanup()
      resolve(String(e.data.url))
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new AuthError(t('request.oauth2.closed')))
      }
    }, 500)
    const cleanup = () => {
      clearInterval(timer)
      window.removeEventListener('message', onMessage)
    }
    window.addEventListener('message', onMessage)
  })
}
const rowsToObject = (rows?: KeyValue[]) => Object.fromEntries((rows ?? []).filter((r) => r.enabled && r.key.trim()).map((r) => [r.key.trim(), r.value]))
const parseBody = (text?: string): unknown => {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function useRequests(deps: { executor: HttpExecutor; env: () => RequestEnv }) {
  const [requests, setRequests] = useState<SavedRequest[]>([])
  const [protos, setProtos] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, RequestResult>>({})
  const [sending, setSending] = useState<Record<string, AbortController>>({})
  // Autorización de la colección (la que heredan los requests con `inherit`).
  const [collectionAuth, setCollectionAuth] = useState<RequestAuth>({ type: 'none' })
  // Tokens de OAuth 2.0 obtenidos: solo en memoria, nunca en disco. El ref los comparte entre
  // los pasos de una misma ejecución (que corre dentro de un solo render); el estado, con la vista.
  const [tokens, setTokensState] = useState<Record<string, OAuth2Token>>({})
  const tokensRef = useRef<Record<string, OAuth2Token>>({})
  const inflight = useRef(new Map<string, Promise<OAuth2Token>>())
  const setTokens = (update: (prev: Record<string, OAuth2Token>) => Record<string, OAuth2Token>) => {
    tokensRef.current = update(tokensRef.current)
    setTokensState(tokensRef.current)
  }
  // Autorización de los journeys: por API y por journey (ver core/flowAuth).
  const [flowAuth, setFlowAuth] = useState<FlowAuth>(emptyFlowAuth())

  const paths = () => requests.map((r) => r.path)

  /** Al abrir una colección (o cerrarla): requests y .proto leídos del disco. */
  function load(
    files: Record<string, string> = {},
    protoFiles: Record<string, string> = {},
    extra: { secrets?: Record<string, Record<string, string>>; collectionAuth?: RequestAuth; flowAuth?: FlowAuth } = {},
  ) {
    for (const r of requests) wsForget(r.path)
    setRequests(
      Object.entries(files)
        .map(([path, text]) => parseRequest(path, text))
        .filter((r): r is SavedRequest => !!r)
        .map((r) => ({ ...r, auth: withAuthSecrets(r.auth, extra.secrets?.[r.path]) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    setProtos(protoFiles)
    setCollectionAuth(extra.collectionAuth ?? { type: 'none' })
    setResults({})
    setTokens(() => ({}))
    setFlowAuth(extra.flowAuth ?? emptyFlowAuth())
  }

  /** Secretos escritos tal cual en la autorización de cada request (van al almacén cifrado). */
  function secrets(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    for (const r of requests) {
      const found = splitAuthSecrets(r.auth).secrets
      if (Object.keys(found).length) out[r.path] = found
    }
    return out
  }

  function create(kind: RequestKind, name = t(`request.default.${kind}`)): SavedRequest {
    const r = newRequest(kind, name, paths())
    setRequests((prev) => [...prev, r])
    return r
  }

  /** Crea un request HTTP desde un comando cURL. Lanza CurlParseError si no se puede leer. */
  function createFromCurl(command: string): SavedRequest {
    const parsed = parseCurl(command)
    const r = { ...newRequest('http', nameFromUrl(parsed.method ?? 'GET', parsed.url), paths()), ...parsed }
    setRequests((prev) => [...prev, r])
    return r
  }

  function update(path: string, patch: Partial<SavedRequest>) {
    if (patch.auth) clearToken(path)
    setRequests((prev) => prev.map((r) => (r.path === path ? { ...r, ...patch, path } : r)))
  }

  /**
   * Renombra un request: cambia su nombre y su archivo (requests/<nombre>.request.yaml), así el
   * archivo en disco sigue al nombre. Devuelve la ruta nueva.
   */
  function rename(path: string, name: string): string {
    const trimmed = name.trim()
    const r = requests.find((x) => x.path === path)
    if (!r || !trimmed) return path
    const next = requestPath(trimmed, paths().filter((p) => p !== path))
    if (next === path) {
      if (r.name !== trimmed) update(path, { name: trimmed })
      return path
    }
    wsForget(path)
    setRequests((prev) => prev.map((x) => (x.path === path ? { ...x, name: trimmed, path: next } : x)))
    setResults(({ [path]: moved, ...rest }) => (moved ? { ...rest, [next]: moved } : rest))
    setTokens(({ [path]: moved, ...rest }) => (moved ? { ...rest, [next]: moved } : rest))
    return next
  }

  function duplicate(path: string): SavedRequest | undefined {
    const source = requests.find((r) => r.path === path)
    if (!source) return
    const name = t('request.copyOf', { name: source.name })
    const copy: SavedRequest = { ...structuredClone(source), name, path: requestPath(name, paths()) }
    setRequests((prev) => [...prev, copy])
    return copy
  }

  function remove(path: string) {
    wsForget(path)
    setRequests((prev) => prev.filter((r) => r.path !== path))
    setResults(({ [path]: _gone, ...rest }) => rest)
  }

  /** Archivos a guardar en la colección (ruta → YAML). */
  function files(): Record<string, string> {
    return Object.fromEntries(requests.map((r) => [r.path, serializeRequest(r)]))
  }

  /** Agrega un .proto a la colección (protos/<nombre>); devuelve su ruta. */
  function addProto(name: string, text: string): string {
    const base = name.split(/[\\/]/).pop() || 'service.proto'
    const path = `${PROTO_DIR}/${base.endsWith('.proto') ? base : `${base}.proto`}`
    setProtos((prev) => ({ ...prev, [path]: text }))
    return path
  }

  /** Dónde se guarda el token de OAuth 2.0 de un request (con `inherit`, el de la colección). */
  const tokenKey = (r?: SavedRequest) => (!r || r.auth?.type === 'inherit' ? COLLECTION_TOKEN : r.path)

  /**
   * Un token de OAuth 2.0 válido: el guardado, uno refrescado o uno nuevo. El authorization code
   * abre la página del proveedor solo si `interactive` (un clic del usuario), no al enviar.
   */
  async function oauth2Token(key: string, auth: RequestAuth, interactive: boolean): Promise<OAuth2Token> {
    // Varios pasos a la vez piden el mismo token: se pide una sola vez.
    const pending = inflight.current.get(key)
    if (pending && !interactive) return pending
    const p = fetchOAuth2Token(key, auth, interactive).finally(() => inflight.current.delete(key))
    inflight.current.set(key, p)
    return p
  }

  async function fetchOAuth2Token(key: string, auth: RequestAuth, interactive: boolean): Promise<OAuth2Token> {
    const cfg = oauth2Config(auth)
    const cached = tokensRef.current[key]
    if (!interactive && tokenValid(cached)) return cached
    const save = (tok: OAuth2Token) => {
      setTokens((prev) => ({ ...prev, [key]: tok }))
      return tok
    }
    const fetchToken = async (req: HttpRequest) => {
      const res = await deps.executor(req)
      try {
        return parseTokenResponse(res)
      } catch (e) {
        throw new AuthError(t('request.oauth2.tokenFailed', { reason: (e as Error).message }))
      }
    }
    if (!interactive && cached?.refreshToken && cfg.accessTokenUrl) {
      try {
        return save(await fetchToken(tokenRequest(cfg, { refreshToken: cached.refreshToken })))
      } catch {
        /* si no se puede refrescar, se pide uno nuevo */
      }
    }
    if (!cfg.accessTokenUrl) throw new AuthError(t('request.oauth2.noTokenUrl'))
    if (cfg.grantType !== 'authorization_code') return save(await fetchToken(tokenRequest(cfg)))
    if (!interactive) throw new AuthError(t('request.oauth2.needsLogin'))
    if (!cfg.authorizationUrl) throw new AuthError(t('request.oauth2.noAuthUrl'))
    const callbackUrl = cfg.callbackUrl || (desktop ? '' : webCallbackUrl())
    if (!callbackUrl) throw new AuthError(t('request.oauth2.noCallback'))
    const state = newState()
    const pkce = cfg.pkce ? await pkcePair() : undefined
    const url = authorizationUrl({ ...cfg, callbackUrl }, state, pkce?.challenge)
    let back: string
    if (desktop) {
      const r = await desktop.oauth2Authorize(url, callbackUrl)
      if (!r.ok) throw new AuthError(r.error === 'closed' ? t('request.oauth2.closed') : r.error)
      back = r.url
    } else back = await authorizeInPopup(url)
    const code = readCallback(back, state)
    if ('error' in code) throw new AuthError(t('request.oauth2.denied', { reason: code.error }))
    return save(await fetchToken(tokenRequest({ ...cfg, callbackUrl }, { code: code.code, verifier: pkce?.verifier })))
  }

  /** Botón "Obtener token" de un request (o de la colección, sin `path`). */
  async function obtainToken(path?: string): Promise<string | undefined> {
    const r = path ? requests.find((x) => x.path === path) : undefined
    const auth = r ? effectiveAuth(r, collectionAuth) : collectionAuth
    if (auth.type !== 'oauth2') return
    await loadFaker()
    try {
      await oauth2Token(tokenKey(r), resolveTemplates(auth, deps.env().variables), true)
    } catch (e) {
      return (e as Error).message
    }
  }

  const clearToken = (key: string) => setTokens(({ [key]: _gone, ...rest }) => rest)

  /**
   * Envía un request con una autorización: Basic, Bearer y API key se agregan (sin pisar un
   * Authorization que ya venga), AWS, OAuth 1.0, WSSE y Akamai se firman, OAuth 2.0 pone su token,
   * Digest repite con la respuesta al desafío y NTLM va por el proceso principal.
   */
  async function authorizedSend(
    req: HttpRequest,
    auth: RequestAuth,
    key: string | undefined,
    exec: (r: HttpRequest) => Promise<HttpResponse>,
  ): Promise<{ response: HttpResponse; sent: HttpRequest }> {
    const hasAuthorization = Object.keys(req.headers).some((h) => h.toLowerCase() === 'authorization')
    let out = req
    try {
      if (BUILT_IN.has(auth.type)) {
        const headers = { ...req.headers }
        const url = hasAuthorization && auth.type !== 'apikey' ? req.url : applyAuth(auth, headers, req.url)
        out = { ...req, headers, url }
      } else if (!needsServer(auth)) out = await signRequest(req, auth)
      else if (auth.type === 'oauth2' && !hasAuthorization) out = applyToken(req, await oauth2Token(key ?? COLLECTION_TOKEN, auth, false), oauth2Config(auth))
    } catch (e) {
      throw e instanceof AuthError ? e : new AuthError(t('request.auth.failed', { reason: (e as Error).message }))
    }
    if (auth.type === 'ntlm') {
      if (!desktop) throw new AuthError(t('request.auth.ntlmDesktop'))
      const res = await desktop.ntlmRequest({ ...out, username: auth.username ?? '', password: auth.password ?? '', domain: auth.domain, workstation: auth.workstation })
      if (!res.ok) throw new NetworkError(t('http.unreachable', { error: res.error }), res.durationMs)
      return { response: { status: res.status, statusText: res.statusText, headers: res.headers, bodyText: res.bodyText, durationMs: res.durationMs }, sent: out }
    }
    let response = await exec(out)
    // Digest: el primer intento recibe el desafío (401) y se repite con la respuesta calculada.
    const challenge = auth.type === 'digest' && response.status === 401 ? parseDigestChallenge(response.headers['www-authenticate']) : undefined
    if (challenge) {
      const u = new URL(out.url)
      const value = await digestAuthorization(challenge, { username: auth.username ?? '', password: auth.password ?? '', method: out.method, uri: `${u.pathname}${u.search}`, body: out.body })
      const first = response.durationMs
      out = { ...out, headers: { ...out.headers, Authorization: value } }
      response = await exec(out)
      response = { ...response, durationMs: response.durationMs + first }
    }
    return { response, sent: out }
  }

  /** La autorización de un paso de un journey (journey + API → API → contrato). */
  const resolveFlow = (journey: string, source: string) => resolveFlowAuth(flowAuth, journey, source, collectionAuth, COLLECTION_TOKEN)

  /**
   * Executor para ejecutar journeys: en cada paso aplica la autorización de su API (si tiene
   * una propia); si no, deja pasar el request con las credenciales del contrato.
   */
  function flowExecutor(base: HttpExecutor, file: string, variables: Record<string, string>): HttpExecutor {
    return async (req, signal, meta) => {
      if (!meta?.workflowId || meta.dropAuth) return base(req, signal, meta)
      const resolved = resolveFlow(journeyKey(file, meta.workflowId), meta.sourceName)
      if (!resolved.auth) return base(req, signal, meta)
      const auth: RequestAuth = resolveTemplates(resolved.auth, variables)
      return (await authorizedSend(req, auth, resolved.tokenKey, (r) => base(r, signal, meta))).response
    }
  }

  /** Si una API tiene autorización propia en un journey (sus pasos no usan las del contrato). */
  const ownFlowAuth = (file: string) => (source: string, workflowId: string) => !!resolveFlow(journeyKey(file, workflowId), source).auth

  /** APIs de un journey que necesitan iniciar sesión (OAuth 2.0 con authorization code, sin token vigente). */
  function flowLoginNeeded(journey: string, sources: string[]): { source: string; tokenKey: string }[] {
    return sources.flatMap((source) => {
      const r = resolveFlow(journey, source)
      return r.auth?.type === 'oauth2' && (r.auth.grantType ?? 'client_credentials') === 'authorization_code' && !tokenValid(tokens[r.tokenKey!]) ? [{ source, tokenKey: r.tokenKey! }] : []
    })
  }

  /** "Iniciar sesión" / "Obtener token" de una API en un journey. */
  async function obtainFlowToken(journey: string, source: string): Promise<string | undefined> {
    const r = resolveFlow(journey, source)
    if (r.auth?.type !== 'oauth2') return
    await loadFaker()
    try {
      await oauth2Token(r.tokenKey!, resolveTemplates(r.auth, deps.env().variables), true)
    } catch (e) {
      return (e as Error).message
    }
  }

  // Si cambia la configuración, el token que se pidió con la anterior ya no sirve.
  const setApiAuth = (source: string, auth: RequestAuth) => {
    clearToken(apiTokenKey(source))
    setFlowAuth((prev) => ({ ...prev, apis: { ...prev.apis, [source]: auth } }))
  }
  const setJourneyAuth = (journey: string, source: string, auth: RequestAuth) => {
    clearToken(journeyTokenKey(journey, source))
    setFlowAuth((prev) => ({ ...prev, journeys: { ...prev.journeys, [journey]: { ...prev.journeys[journey], [source]: auth } } }))
  }

  async function send(path: string) {
    const saved = requests.find((r) => r.path === path)
    if (!saved || sending[path]) return
    await loadFaker()
    const env = deps.env()
    const auth: RequestAuth = resolveTemplates(effectiveAuth(saved, collectionAuth), env.variables)
    // La autorización se aplica al enviar (authorizedSend), sobre el request ya armado.
    const r = resolveRequest({ ...saved, auth: { type: 'none' } }, env.variables)
    const controller = new AbortController()
    setSending((prev) => ({ ...prev, [path]: controller }))
    const fail = (request: HttpRequest, error: string, authError = false) => setResults((prev) => ({ ...prev, [path]: { kind: 'http', request, error, at: Date.now(), authError } }))
    try {
      if (r.kind === 'grpc') {
        const result = await sendGrpc(r, controller.signal)
        setResults((prev) => ({ ...prev, [path]: { kind: 'grpc', result, at: Date.now() } }))
        return
      }
      let req: HttpRequest
      try {
        req = buildHttpRequest(r)
      } catch {
        fail({ method: r.method ?? 'POST', url: r.url, headers: {} }, t('request.badVariables'))
        return
      }
      const entry = (sent: HttpRequest) => {
        // Lo que se muestra y se registra: sin secretos del ambiente ni de la autorización.
        const hidden = [...env.secrets, ...Object.values(splitAuthSecrets(auth).secrets), ...(sent.headers.Authorization ? [sent.headers.Authorization] : [])]
        const shown = redactSecrets(sent, hidden)
        return {
          shown,
          log: {
            kind: 'http' as const,
            method: sent.method,
            url: shown.url,
            simulated: false,
            journey: t('request.devlogGroup'),
            step: saved.name,
            caseName: r.kind === 'graphql' ? 'GraphQL' : 'HTTP',
            request: { headers: shown.headers, body: parseBody(shown.body) },
          },
        }
      }
      try {
        const { response, sent } = await authorizedSend(req, auth, tokenKey(saved), (x) => deps.executor(x, controller.signal))
        const { shown, log: logEntry } = entry(sent)
        logNetwork({
          ...logEntry,
          status: response.status,
          statusText: response.statusText,
          durationMs: response.durationMs,
          size: byteSize(response.bodyText),
          failed: response.status >= 400,
          response: { headers: response.headers, body: redactSecrets(parseBody(response.bodyText), env.secrets) },
        })
        setResults((prev) => ({ ...prev, [path]: { kind: 'http', request: shown, response, at: Date.now() } }))
      } catch (e) {
        const { shown, log: logEntry } = entry(req)
        if (e instanceof AuthError) {
          fail(shown, e.message, true)
          return
        }
        logNetwork({ ...logEntry, failed: true })
        log('error', `${req.method} ${shown.url}: ${(e as Error).message}`, { source: 'app' })
        fail(shown, e instanceof NetworkError ? e.message : String((e as Error).message ?? e))
      }
    } finally {
      setSending(({ [path]: _done, ...rest }) => rest)
    }
  }

  async function sendGrpc(r: SavedRequest, signal: AbortSignal): Promise<GrpcResult> {
    if (!desktop) return { ok: false, error: t('request.grpc.desktopOnly'), durationMs: 0 }
    if (!r.proto || !protos[r.proto]) return { ok: false, error: t('request.grpc.noProto'), durationMs: 0 }
    if (!r.service || !r.rpc) return { ok: false, error: t('request.grpc.noMethod'), durationMs: 0 }
    const id = `grpc-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const cancel = () => desktop!.grpcCancel(id)
    signal.addEventListener('abort', cancel, { once: true })
    try {
      return await desktop.grpcInvoke({ id, files: protos, entry: r.proto, url: r.url, tls: r.tls, service: r.service, rpc: r.rpc, message: r.message ?? '{}', metadata: rowsToObject(r.headers) })
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }

  /** Servicios y métodos de un .proto de la colección (solo en escritorio). */
  async function describeProto(path: string): Promise<{ services: GrpcService[] } | { error: string }> {
    if (!desktop) return { error: t('request.grpc.desktopOnly') }
    if (!protos[path]) return { error: t('request.grpc.noProto') }
    const res = await desktop.grpcDescribe({ files: protos, entry: path })
    return res.ok ? { services: res.services } : { error: res.error }
  }

  function cancel(path: string) {
    sending[path]?.abort()
  }

  /** Variables del ambiente activo (WebSocket las resuelve al conectar y al enviar). */
  const variables = () => deps.env().variables
  const resolveUrl = (r: SavedRequest, vars: Record<string, string>) => urlWithParams(String(resolveTemplates(r.url.trim(), vars)), resolveTemplates(r.params ?? [], vars))
  const resolveText = (text: string) => String(resolveTemplates(text, variables()))

  /** Archivo y secretos de la autorización de los journeys (para guardarlos en la colección). */
  const flowAuthFile = () => serializeFlowAuth(flowAuth)
  const flowAuthSecrets = () => splitFlowAuthSecrets(flowAuth).secrets

  return {
    flowAuth,
    setApiAuth,
    setJourneyAuth,
    resolveFlow,
    flowExecutor,
    ownFlowAuth,
    flowLoginNeeded,
    obtainFlowToken,
    flowAuthFile,
    flowAuthSecrets,
    renameFlowFile: (from: string, to: string) => setFlowAuth((prev) => renameFlowFile(prev, from, to)),
    collectionAuth,
    setCollectionAuth: (auth: RequestAuth) => {
      clearToken(COLLECTION_TOKEN)
      setCollectionAuth(auth)
    },
    tokens,
    tokenKey,
    obtainToken,
    clearToken,
    secrets,
    rename,
    variables,
    resolveUrl,
    resolveText,
    list: requests,     protos,
    results,
    sending,
    load,
    create,
    createFromCurl,
    update,
    duplicate,
    remove,
    files,
    addProto,
    send,
    cancel,
    describeProto,
  }
}

export type RequestsApi = ReturnType<typeof useRequests>
