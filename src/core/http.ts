// Ejecución HTTP. Hoy solo usa fetch del navegador; si algún día se necesita un proxy,
// basta con otra implementación de HttpExecutor.

export interface HttpRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyText: string
  durationMs: number
  /** true cuando la respuesta la generó el simulador a partir del contrato. */
  simulated?: boolean
}

/** Contexto del paso que hace la petición (lo usa el simulador; fetch lo ignora). */
export interface RequestMeta {
  stepId: string
  sourceName: string
  method: string
  path: string
}

export type HttpExecutor = (req: HttpRequest, signal?: AbortSignal, meta?: RequestMeta) => Promise<HttpResponse>

export class NetworkError extends Error {
  durationMs: number
  constructor(message: string, durationMs: number) {
    super(message)
    this.durationMs = durationMs
  }
}

export const fetchExecutor: HttpExecutor = async (req, signal) => {
  const started = performance.now()
  let res: Response
  try {
    res = await fetch(req.url, {
      method: req.method.toUpperCase(),
      headers: req.headers,
      body: req.body,
      signal,
      mode: 'cors',
    })
  } catch (e) {
    const ms = Math.round(performance.now() - started)
    if ((e as Error).name === 'AbortError') throw new NetworkError('La ejecución fue cancelada.', ms)
    throw new NetworkError(
      'No se pudo conectar: la API no permite CORS desde este origen o no es accesible. Verifica la configuración de CORS y la URL del ambiente.',
      ms,
    )
  }
  const bodyText = await res.text()
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    bodyText,
    durationMs: Math.round(performance.now() - started),
  }
}
