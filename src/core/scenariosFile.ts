/* eslint-disable @typescript-eslint/no-explicit-any */
// Archivo de escenarios: bases por workflow y casos con datos propios, para versionarlo junto al Arazzo.
import YAML from 'yaml'
import { t } from '../i18n'
import { createDataCase, type TestCase } from './testcases'

export interface ScenariosImport {
  bases: Record<string, Record<string, any>>
  cases: TestCase[]
  errors: string[]
  summary: string
}

function clean(obj: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!obj) return undefined
  const out = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''))
  return Object.keys(out).length ? out : undefined
}

export function exportScenarios(params: {
  title?: string
  bases: Record<string, Record<string, any>>
  cases: TestCase[]
}): string {
  const casos = params.cases
    .filter((c) => c.origin === 'datos' || clean(c.inputOverrides) || c.omitInputs?.length || c.dataMode === 'real')
    .map((c) => {
      if (c.origin === 'datos') {
        const e = c.expectation
        return {
          workflow: c.workflowId,
          nombre: c.title,
          inputs: clean(c.inputOverrides) ?? {},
          ...(c.omitInputs?.length ? { omitir: c.omitInputs } : {}),
          espera: {
            paso: e.stepId,
            ...(e.statuses?.length ? { status: e.statuses } : {}),
            ...(e.code ? { code: e.code } : {}),
            ...(e.actionName ? { accion: e.actionName } : {}),
          },
        }
      }
      return {
        workflow: c.workflowId,
        caso: c.id,
        nombre: c.title,
        ...(c.scenario ? { modo: c.dataMode ?? 'simulado' } : {}),
        inputs: clean(c.inputOverrides) ?? {},
        ...(c.omitInputs?.length ? { omitir: c.omitInputs } : {}),
      }
    })
  const doc = {
    version: 1,
    ...(params.title ? { arazzo: params.title } : {}),
    bases: Object.fromEntries(Object.entries(params.bases).map(([k, v]) => [k, clean(v) ?? {}])),
    casos,
  }
  return (
    t('scen.header')
      .split('\n')
      .map((l) => `# ${l}\n`)
      .join('') +
    YAML.stringify(doc, { lineWidth: 0 })
  )
}

/** Aplica un archivo de escenarios sobre los casos actuales. */
export function importScenarios(text: string, current: TestCase[], workflowIds: string[]): ScenariosImport {
  const errors: string[] = []
  let doc: any
  try {
    doc = YAML.parse(text)
  } catch (e) {
    return { bases: {}, cases: current, errors: [t('scen.parse', { error: (e as Error).message })], summary: '' }
  }
  if (!doc || typeof doc !== 'object') return { bases: {}, cases: current, errors: [t('scen.empty')], summary: '' }

  const bases: Record<string, Record<string, any>> = {}
  for (const [wf, values] of Object.entries<any>(doc.bases ?? {})) {
    if (!workflowIds.includes(wf)) errors.push(t('scen.baseIgnored', { workflow: wf }))
    else if (values && typeof values === 'object') bases[wf] = values
  }

  let cases = current.filter((c) => c.origin !== 'datos')
  let updated = 0
  let created = 0
  for (const [i, item] of (Array.isArray(doc.casos) ? doc.casos : []).entries()) {
    const where = `casos[${i}]${item?.nombre ? ` ("${item.nombre}")` : ''}`
    if (!item || typeof item !== 'object') continue
    if (!workflowIds.includes(item.workflow)) {
      errors.push(t('scen.noWorkflow', { where, workflow: item.workflow }))
      continue
    }
    if (item.caso) {
      const idx = cases.findIndex((c) => c.id === item.caso)
      if (idx < 0) {
        errors.push(t('scen.noCase', { where, id: item.caso }))
        continue
      }
      cases[idx] = {
        ...cases[idx],
        inputOverrides: item.inputs ?? {},
        omitInputs: Array.isArray(item.omitir) ? item.omitir : undefined,
        ...(cases[idx].scenario && item.modo ? { dataMode: item.modo === 'real' ? 'real' : 'simulado' } : {}),
      }
      updated++
      continue
    }
    const espera = item.espera ?? {}
    if (!espera.paso) {
      errors.push(t('scen.noStep', { where }))
      continue
    }
    const statuses = (Array.isArray(espera.status) ? espera.status : espera.status !== undefined ? [espera.status] : []).map(Number)
    const created_ = createDataCase({
        workflowId: item.workflow,
        title: item.nombre ?? t('scen.caseN', { n: i + 1 }),
        inputOverrides: item.inputs ?? {},
        stepId: espera.paso,
        statuses: statuses.filter((n: number) => !isNaN(n)),
        code: espera.code,
        actionName: espera.accion,
      })
    if (Array.isArray(item.omitir)) created_.omitInputs = item.omitir
    cases.push(created_)
    created++
  }
  cases = [...cases]
  return {
    bases,
    cases,
    errors,
    summary: t('scen.summary', { bases: Object.keys(bases).length, created, updated }),
  }
}
