// App de escritorio (Electron): lo que expone electron/preload.cjs. En el navegador no existe.
import { NetworkError, type HttpExecutor, type HttpRequest } from '../core/http'
import { t } from '../i18n'

export interface DesktopFile {
  /** Ruta relativa a la carpeta abierta (sirve como nombre en la app). */
  name: string
  /** Ruta completa en disco, para guardar sobre el mismo archivo. */
  path: string
  text: string
}

type BridgeResponse =
  | { ok: true; status: number; statusText: string; headers: Record<string, string>; bodyText: string; durationMs: number }
  | { ok: false; aborted: boolean; error: string; durationMs: number }

export interface AppMetrics {
  cpu: number
  memory: number
  uptime: number
  pid: number
  processes: { type: string; pid: number; cpu: number; memory: number }[]
}

export interface GrpcMethod {
  name: string
  requestStream: boolean
  responseStream: boolean
  requestType?: string
  responseType?: string
  /** Mensaje de ejemplo con todos los campos del request. */
  sample: unknown
}

export interface GrpcService {
  /** Nombre completo (paquete.Servicio). */
  name: string
  methods: GrpcMethod[]
}

export interface GrpcCall {
  id: string
  files: Record<string, string>
  entry: string
  url: string
  tls?: boolean
  service: string
  rpc: string
  /** Mensaje en JSON. */
  message: string
  metadata: Record<string, string>
  timeoutMs?: number
}

export type GrpcResult =
  | {
      ok: true
      code: number
      codeName: string
      details: string
      messages: unknown[]
      headers: Record<string, string>
      trailers: Record<string, string>
      durationMs: number
    }
  | { ok: false; error: string; durationMs: number }

export interface DesktopBridge {
  platform: string
  request: (req: HttpRequest & { id: string }) => Promise<BridgeResponse>
  abort: (id: string) => void
  /** gRPC desde el proceso principal: servicios de un .proto y llamadas a sus métodos. */
  grpcDescribe: (req: { files: Record<string, string>; entry: string }) => Promise<{ ok: true; services: GrpcService[] } | { ok: false; error: string }>
  grpcInvoke: (req: GrpcCall) => Promise<GrpcResult>
  grpcCancel: (id: string) => void
  /** NTLM: el intercambio completo en una conexión, desde el proceso principal. */
  ntlmRequest: (req: HttpRequest & { username: string; password: string; domain?: string; workstation?: string }) => Promise<BridgeResponse>
  /** OAuth 2.0: abre la página de autorización y devuelve la URL de callback (con el código). */
  oauth2Authorize: (url: string, callbackUrl: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
  openFolder: () => Promise<{ root: string; truncated: boolean; files: DesktopFile[] } | undefined>
  writeFile: (path: string, text: string) => Promise<string>
  saveAs: (suggestedName: string, text: string) => Promise<string | undefined>
  /** Workspaces en disco: elegir una carpeta y leer o escribir dentro de ella. */
  wsPickFolder: (mode: 'open' | 'create') => Promise<string | undefined>
  wsList: (root: string, dir: string) => Promise<{ name: string; dir: boolean }[]>
  wsRead: (root: string, path: string) => Promise<string | undefined>
  wsWrite: (root: string, path: string, text: string) => Promise<void>
  wsRemove: (root: string, path: string) => Promise<void>
  wsRemoveDir: (root: string, path: string) => Promise<void>
  /** Ubicación propuesta para workspaces nuevos (Documentos/Arazzo Studio). */
  wsDefaultLocation: () => Promise<string>
  wsPickLocation: (current?: string) => Promise<string | undefined>
  /** Crea la carpeta `folder` dentro de `parent` y devuelve su ruta. */
  wsCreateAt: (parent: string, folder: string) => Promise<string>
  wsReveal: (root: string, path: string) => Promise<void>
  /** Manda la carpeta del workspace a la papelera. */
  wsTrash: (root: string) => Promise<void>
  /** Secretos cifrados por el sistema operativo. */
  secretGet: (key: string) => Promise<string | undefined>
  secretSet: (key: string, value: string) => Promise<void>
  secretRemove: (key: string) => Promise<void>
  secretRemovePrefix: (prefix: string) => Promise<void>
  appSetTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  appToggleDevTools: () => Promise<void>
  /** CPU (%), memoria (bytes), tiempo encendida (s) y PID del proceso principal. */
  appMetrics: () => Promise<AppMetrics>
  appIsFullscreen: () => Promise<boolean>
  /** Avisa al entrar o salir de pantalla completa; devuelve la función para dejar de escuchar. */
  /** Atajos de pestañas que el proceso principal intercepta (⌘W, ⇧⌘W, ⌘N). */
  onShortcut: (cb: (name: 'closeTab' | 'closeAll' | 'newArazzo') => void) => () => void
  onFullscreen: (cb: (fullscreen: boolean) => void) => () => void
  /** Terminal integrada: abre la shell del sistema (en `cwd` si es un workspace autorizado). */
  termCreate: (opts: { cols: number; rows: number; cwd?: string }) => Promise<{ id: string; cwd: string; shell: string }>
  termWrite: (id: string, data: string) => void
  termResize: (id: string, cols: number, rows: number) => void
  termKill: (id: string) => Promise<void>
  onTermData: (cb: (msg: { id: string; data: string }) => void) => () => void
  onTermExit: (cb: (msg: { id: string; exitCode: number }) => void) => () => void
}

/** El puente de la app de escritorio, o undefined en el navegador. */
export const desktop: DesktopBridge | undefined =
  typeof window !== 'undefined' ? (window as unknown as { arazzoDesktop?: DesktopBridge }).arazzoDesktop : undefined

/** Peticiones HTTP hechas por el proceso principal: sin CORS y con cualquier header. */
export function createDesktopExecutor(bridge: DesktopBridge): HttpExecutor {
  let seq = 0
  return async (req, signal) => {
    const id = `req-${Date.now()}-${++seq}`
    const abort = () => bridge.abort(id)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const res = await bridge.request({ ...req, method: req.method.toUpperCase(), id })
      if (!res.ok) throw new NetworkError(res.aborted ? t('run.cancelled') : t('http.unreachable', { error: res.error }), res.durationMs)
      return { status: res.status, statusText: res.statusText, headers: res.headers, bodyText: res.bodyText, durationMs: res.durationMs }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
}
