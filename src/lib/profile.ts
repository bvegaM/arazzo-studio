// Perfil de quien usa la app (como el onboarding de Postman): su rol y para qué la quiere. Con eso
// se elige la interfaz (simple o completa) y por dónde le conviene empezar. Se recuerda en este equipo.
import { useSyncExternalStore } from 'react'
import { setUiMode, type UiMode } from './uiMode'

export type Role = 'product' | 'business' | 'qa' | 'developer' | 'architect' | 'other'
export type Purpose = 'partner' | 'journeys' | 'contracts' | 'author' | 'learn'
export type Start = 'tour' | 'example' | 'create'

export const ROLES: Role[] = ['product', 'business', 'qa', 'developer', 'architect', 'other']
export const PURPOSES: Purpose[] = ['partner', 'journeys', 'contracts', 'author', 'learn']

export interface Profile {
  role: Role
  purposes: Purpose[]
}

/** Interfaz que le conviene a cada rol: producto y negocio ven el lenguaje simple. */
export function modeFor(role: Role): UiMode {
  return role === 'product' || role === 'business' ? 'simple' : 'full'
}

/** Por dónde empezar: el tour si quiere conocer, el ejemplo si va a probar, crear si va a escribir. */
export function recommendedStart(p: Profile): Start {
  if (p.purposes.includes('learn') || !p.purposes.length) return 'tour'
  if (p.purposes.includes('author') || p.purposes.includes('contracts')) return modeFor(p.role) === 'full' ? 'create' : 'example'
  return 'example'
}

const KEY = 'profile'
const listeners = new Set<() => void>()

function read(): Profile | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && ROLES.includes(raw.role)) return { role: raw.role, purposes: (raw.purposes ?? []).filter((p: Purpose) => PURPOSES.includes(p)) }
  } catch {
    /* sin almacenamiento o dato corrupto: se vuelve a preguntar */
  }
  return undefined
}

let current = read()

/** Guarda el perfil y ajusta la interfaz al rol. */
export function setProfile(profile: Profile) {
  current = profile
  try {
    localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    /* sin almacenamiento: dura esta sesión */
  }
  setUiMode(modeFor(profile.role))
  for (const l of listeners) l()
}

export function useProfile(): Profile | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
