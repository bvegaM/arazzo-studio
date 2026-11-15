/* eslint-disable @typescript-eslint/no-explicit-any */
// Colección: varios archivos Arazzo (y sus contratos) abiertos a la vez. Cada journey se identifica
// por archivo + workflowId, porque dos archivos pueden tener workflows con el mismo nombre.
import type { ProjectAnalysis, WorkflowAnalysis } from './analyze'
import type { Project } from './loader'
import type { SecurityScheme } from './openapi'
import { generateTestCases, type TestCase } from './testcases'

export function journeyKey(file: string, workflowId: string): string {
  return `${file}#${workflowId}`
}

/** Separa una clave de journey en archivo y workflowId (los workflowId no llevan "#"). */
export function splitJourneyKey(key: string): { file: string; workflowId: string } {
  const i = key.lastIndexOf('#')
  return i < 0 ? { file: '', workflowId: key } : { file: key.slice(0, i), workflowId: key.slice(i + 1) }
}

export interface Journey {
  key: string
  file: string
  workflowId: string
  project: Project
  analysis: ProjectAnalysis
  wa: WorkflowAnalysis
}

export function listJourneys(projects: Project[], analyses: Record<string, ProjectAnalysis>): Journey[] {
  return projects.flatMap((project) => {
    const analysis = analyses[project.arazzoFileName]
    return (analysis?.workflows ?? []).map((wa) => ({
      key: journeyKey(project.arazzoFileName, wa.workflow.workflowId),
      file: project.arazzoFileName,
      workflowId: wa.workflow.workflowId,
      project,
      analysis,
      wa,
    }))
  })
}

/** Clave del journey al que pertenece un caso. */
export function caseJourney(tc: Pick<TestCase, 'arazzo' | 'workflowId'>): string {
  return journeyKey(tc.arazzo ?? '', tc.workflowId)
}

/** Un caso generado para un archivo: su id lleva el archivo para no chocar con los de otro. */
export function scopeCase(file: string, tc: TestCase): TestCase {
  return { ...tc, id: `${file}::${tc.id}`, arazzo: file }
}

/** El caso sin el archivo en el id (formato del archivo de escenarios). */
export function unscopeCase(tc: TestCase): TestCase {
  const prefix = `${tc.arazzo}::`
  return tc.arazzo && tc.id.startsWith(prefix) ? { ...tc, id: tc.id.slice(prefix.length) } : tc
}

/**
 * Casos de toda la colección: los generados de cada journey (conservando lo que el usuario cambió:
 * selección, datos propios, modo) y los creados a mano cuyo journey sigue existiendo.
 */
export function collectionCases(journeys: Journey[], previous: TestCase[]): TestCase[] {
  const byId = new Map(previous.map((c) => [c.id, c]))
  const keys = new Set(journeys.map((j) => j.key))
  const generated = journeys.flatMap((j) =>
    generateTestCases(j.wa).map((raw) => {
      const c = scopeCase(j.file, raw)
      const old = byId.get(c.id)
      return old ? { ...c, enabled: old.enabled, inputOverrides: old.inputOverrides, omitInputs: old.omitInputs, dataMode: old.dataMode } : c
    }),
  )
  const custom = previous.filter((c) => c.origin === 'datos' && keys.has(caseJourney(c)))
  return [...generated, ...custom]
}

/** Credenciales que piden los contratos de todos los Arazzo, sin repetir. */
export function collectionCredentials(analyses: ProjectAnalysis[]): SecurityScheme[] {
  const byKey = new Map<string, SecurityScheme>()
  for (const a of analyses) for (const c of a.credentials) byKey.set(c.key, c)
  return [...byKey.values()]
}

/**
 * Sesiones guardadas antes de las colecciones: inputs, casos y journey elegido sin archivo.
 * Se asignan al primer Arazzo de la colección.
 */
export function migrateLegacySession(
  firstFile: string,
  data: { inputs: Record<string, Record<string, any>>; cases: TestCase[]; selected: string },
): { inputs: Record<string, Record<string, any>>; cases: TestCase[]; selected: string } {
  const inputs = Object.fromEntries(Object.entries(data.inputs).map(([k, v]) => [k.includes('#') ? k : journeyKey(firstFile, k), v]))
  const cases = data.cases.map((c) => (c.arazzo ? c : scopeCase(firstFile, c)))
  const selected = !data.selected || data.selected.includes('#') ? data.selected : journeyKey(firstFile, data.selected)
  return { inputs, cases, selected }
}
