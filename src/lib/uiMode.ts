// Interfaz completa o simple. La simple oculta las herramientas técnicas (Dev Tools y la terminal)
// para quien solo prueba journeys. Se recuerda en este equipo.
import { useSyncExternalStore } from 'react'

export type UiMode = 'full' | 'simple'
const KEY = 'ui.mode'
const listeners = new Set<() => void>()

function read(): UiMode {
  try {
    return localStorage.getItem(KEY) === 'simple' ? 'simple' : 'full'
  } catch {
    return 'full'
  }
}

let current: UiMode = read()

export function setUiMode(mode: UiMode) {
  current = mode
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* sin almacenamiento: dura esta sesión */
  }
  for (const l of listeners) l()
}

export function getUiMode(): UiMode {
  return current
}

export function useUiMode(): UiMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
