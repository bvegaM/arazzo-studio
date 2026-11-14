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

export interface DesktopBridge {
  platform: string
  request: (req: HttpRequest & { id: string }) => Promise<BridgeResponse>
  abort: (id: string) => void
  openFolder: () => Promise<{ root: string; truncated: boolean; files: DesktopFile[] } | undefined>
  writeFile: (path: string, text: string) => Promise<string>
  saveAs: (suggestedName: string, text: string) => Promise<string | undefined>
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
