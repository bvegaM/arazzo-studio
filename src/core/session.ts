/* eslint-disable @typescript-eslint/no-explicit-any */
// Sesión guardada para continuar después de recargar. Nunca incluye credenciales
// ni valores de inputs con nombre sensible (token, password…).
import type { Environment } from './environments'
import type { LoadedFile } from './loader'
import type { RunMode, TestCase } from './testcases'
import { omitSensitive } from './report'

export const SESSION_VERSION = 1

export interface SavedSession {
  version: number
  savedAt: string
  title?: string
  /** Archivos cargados (Arazzo y OpenAPI) tal cual se leyeron. */
  files: LoadedFile[]
  /** OpenAPI adjuntados a mano a una fuente cuyo nombre no coincidía. */
  attachments: { source: string; file: LoadedFile }[]
  /** Fuentes que se descargaron desde su URL: se vuelven a descargar al continuar. */
  remotes: string[]
  inputs: Record<string, Record<string, any>>
  cases: TestCase[]
  skipped: string[]
  selected: string
  mode: RunMode
  screen: number
  environments: Omit<Environment, 'credentials'>[]
  activeEnv: string
}

export interface SessionState extends Omit<SavedSession, 'version' | 'savedAt' | 'environments'> {
  environments: Environment[]
}

export function toSavedSession(state: SessionState, now = new Date()): SavedSession {
  return {
    ...state,
    version: SESSION_VERSION,
    savedAt: now.toISOString(),
    inputs: omitSensitive(state.inputs),
    cases: state.cases.map((c) => (c.inputOverrides ? { ...c, inputOverrides: omitSensitive(c.inputOverrides) } : c)),
    environments: state.environments.map((e) => ({ id: e.id, name: e.name, servers: e.servers })),
  }
}

/** La sesión si es de esta versión y tiene lo mínimo para restaurarse. */
export function readSavedSession(value: unknown): SavedSession | undefined {
  const s = value as SavedSession | undefined
  if (!s || s.version !== SESSION_VERSION || !Array.isArray(s.files) || !s.files.length) return undefined
  return s
}
