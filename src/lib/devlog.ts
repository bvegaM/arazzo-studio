// Registro de la sesión para el panel de desarrollo: la consola (qué pasó) y la red (cada petición
// HTTP o mensaje AsyncAPI que hizo el runner). Vive solo en memoria: no se guarda en ningún lado.
// Lo que llega aquí ya viene con los secretos tapados (••••).
import { useSyncExternalStore } from 'react'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: number
  level: LogLevel
  /** De dónde viene: una ejecución, la app (carga, guardado…) o un error de JavaScript. */
  source: 'run' | 'app' | 'js'
  message: string
  detail?: string
}

export interface NetworkEntry {
  id: number
  time: number
  kind: 'http' | 'message'
  /** GET, POST… o SEND / RECEIVE en los mensajes. */
  method: string
  url: string
  status?: number
  statusText?: string
  durationMs?: number
  /** Tamaño aproximado de la respuesta (o del mensaje), en bytes. */
  size?: number
  failed: boolean
  simulated: boolean
  journey: string
  step: string
  caseName: string
  request: { headers: Record<string, unknown>; body?: unknown }
  response?: { headers: Record<string, unknown>; body?: unknown }
}

const LIMIT = 500
let nextId = 1
let state: { logs: LogEntry[]; network: NetworkEntry[] } = { logs: [], network: [] }
const listeners = new Set<() => void>()

function emit(next: typeof state) {
  state = next
  for (const l of listeners) l()
}

export function log(level: LogLevel, message: string, opts: { source?: LogEntry['source']; detail?: string } = {}) {
  const entry: LogEntry = { id: nextId++, time: Date.now(), level, source: opts.source ?? 'app', message, detail: opts.detail }
  emit({ ...state, logs: [...state.logs, entry].slice(-LIMIT) })
}

export function logNetwork(entry: Omit<NetworkEntry, 'id' | 'time'>) {
  emit({ ...state, network: [...state.network, { ...entry, id: nextId++, time: Date.now() }].slice(-LIMIT) })
}

export function clearLogs() {
  emit({ ...state, logs: [] })
}

export function clearNetwork() {
  emit({ ...state, network: [] })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDevLog() {
  return useSyncExternalStore(subscribe, () => state)
}

/** Tamaño aproximado de un valor como se enviaría (texto o JSON). */
export function byteSize(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return new TextEncoder().encode(text ?? '').length
}

let captured = false
/** Captura los errores de JavaScript que nadie atrapó (una sola vez). */
export function captureErrors() {
  if (captured || typeof window === 'undefined') return
  captured = true
  window.addEventListener('error', (e) => log('error', e.message || String(e.error), { source: 'js', detail: e.error?.stack }))
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as Error | undefined
    log('error', reason?.message ?? String(e.reason), { source: 'js', detail: reason?.stack })
  })
}
