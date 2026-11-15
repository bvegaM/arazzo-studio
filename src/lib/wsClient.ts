// Conexiones WebSocket de los requests de la colección. Viven fuera de React: una conexión sigue
// abierta aunque se cambie de pestaña (como en Postman) y cada request ve su propio historial.
import { useSyncExternalStore } from 'react'

export type WsState = 'idle' | 'connecting' | 'open' | 'closed'

export interface WsEntry {
  id: number
  dir: 'out' | 'in' | 'info' | 'error'
  text: string
  at: number
}

interface Conn {
  socket?: WebSocket
  state: WsState
  log: WsEntry[]
  openedAt?: number
}

const MAX_LOG = 1000
const conns = new Map<string, Conn>()
const listeners = new Set<() => void>()
let seq = 0
// Instantáneas inmutables para useSyncExternalStore.
let snapshot: Record<string, Conn> = {}

function emit() {
  snapshot = Object.fromEntries([...conns].map(([k, v]) => [k, { ...v }]))
  for (const l of listeners) l()
}

function conn(key: string): Conn {
  let c = conns.get(key)
  if (!c) conns.set(key, (c = { state: 'idle', log: [] }))
  return c
}

function push(key: string, dir: WsEntry['dir'], text: string) {
  const c = conn(key)
  c.log = [...c.log.slice(-(MAX_LOG - 1)), { id: ++seq, dir, text, at: Date.now() }]
}

/** Abre la conexión del request `key` (cierra la anterior si había). */
export function wsConnect(key: string, url: string, protocols: string[] = []) {
  wsDisconnect(key, true)
  const c = conn(key)
  let socket: WebSocket
  try {
    socket = new WebSocket(url, protocols.filter(Boolean))
  } catch (e) {
    push(key, 'error', (e as Error).message)
    c.state = 'closed'
    emit()
    return
  }
  c.socket = socket
  c.state = 'connecting'
  push(key, 'info', `connecting ${url}`)
  emit()
  socket.onopen = () => {
    if (c.socket !== socket) return
    c.state = 'open'
    c.openedAt = Date.now()
    push(key, 'info', `open${socket.protocol ? ` · ${socket.protocol}` : ''}`)
    emit()
  }
  socket.onmessage = async (e) => {
    if (c.socket !== socket) return
    const text = typeof e.data === 'string' ? e.data : e.data instanceof Blob ? await e.data.text() : String(e.data)
    push(key, 'in', text)
    emit()
  }
  socket.onerror = () => {
    if (c.socket !== socket) return
    push(key, 'error', 'error')
    emit()
  }
  socket.onclose = (e) => {
    if (c.socket !== socket) return
    c.state = 'closed'
    c.socket = undefined
    push(key, 'info', `closed · ${e.code}${e.reason ? ` ${e.reason}` : ''}`)
    emit()
  }
}

export function wsSend(key: string, text: string): boolean {
  const c = conns.get(key)
  if (!c?.socket || c.state !== 'open') return false
  c.socket.send(text)
  push(key, 'out', text)
  emit()
  return true
}

export function wsDisconnect(key: string, silent = false) {
  const c = conns.get(key)
  if (!c?.socket) return
  const s = c.socket
  c.socket = undefined
  c.state = 'closed'
  s.close(1000)
  if (!silent) push(key, 'info', 'closed · 1000')
  emit()
}

export function wsClear(key: string) {
  conn(key).log = []
  emit()
}

/** Cuando se borra o renombra el request. */
export function wsForget(key: string) {
  wsDisconnect(key, true)
  conns.delete(key)
  emit()
}

export function useWsConnection(key: string): { state: WsState; log: WsEntry[]; openedAt?: number } {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
  return all[key] ?? IDLE
}

const IDLE = { state: 'idle' as const, log: [] }
