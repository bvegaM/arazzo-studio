/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkflowAnalysis } from './analyze'
import { collectReferences } from './expressions'
import { documentedStatuses } from './openapi'
import type { StepResult, WorkflowRunResult } from './runner'
import { requirementsFromCriteria } from './criteria'
import type { Scenario } from './simulator'
import type { Action } from './types'
import { resolveTemplates } from './templates'

export type CaseOrigin = 'arazzo' | 'escenario' | 'schema' | 'security' | 'datos'

export const ORIGIN_LABEL: Record<CaseOrigin, string> = {
  datos: 'Caso con datos propios',
  arazzo: 'Definido en el Arazzo',
  escenario: 'Acción definida en el Arazzo',
  schema: 'Derivado del schema de inputs',
  security: 'Derivado de la seguridad del contrato',
}

export interface CaseExpectation {
  /** response: el paso debe responder con ese status / code / acción (casos con datos propios). */
  type: 'success' | 'failure' | 'action' | 'response'
  /** Valor esperado en $response.body#/code. */
  code?: string
  /** Para escenarios: acción que debe activarse. */
  actionName?: string
  /** Paso donde se espera el error (para casos negativos). */
  stepId?: string
  /** Status aceptados; vacío = cualquier 4xx. */
  statuses?: number[]
  text: string
}

export interface TestCase {
  id: string
  workflowId: string
  title: string
  origin: CaseOrigin
  description: string
  omitInput?: string
  setInput?: { name: string; value: any }
  dropAuth?: boolean
  /** Escenario simulado: el paso indicado responde con este status y body. Siempre se ejecuta en simulación. */
  scenario?: Scenario
  /** Valores de inputs propios del caso; reemplazan a los de la base. Admiten {{generadores}}. */
  inputOverrides?: Record<string, any>
  /** Inputs que este caso no envía (además del que omite el propio caso). */
  omitInputs?: string[]
  /** Escenarios por respuesta: simularlos o ejecutarlos contra la API real con sus datos. */
  dataMode?: 'simulado' | 'real'
  expectation: CaseExpectation
  enabled: boolean
}

export type Verdict = 'passed' | 'failed' | 'inconclusive'

export const VERDICT_LABEL: Record<Verdict, string> = {
  passed: 'Pasó',
  failed: 'No pasó',
  inconclusive: 'No concluyente',
}

function firstConsumer(wa: WorkflowAnalysis, input: string) {
  return wa.steps.find((s) => collectReferences({ ...s.step, parameters: s.parameters }).inputs.includes(input))
}

function expectedClientErrors(wa: WorkflowAnalysis, stepId: string, preferred: number[]): number[] {
  const rs = wa.steps.find((s) => s.step.stepId === stepId)
  if (!rs?.op) return []
  const documented = documentedStatuses(rs.op)
    .filter((s) => /^4\d\d$/.test(s))
    .map(Number)
  const pref = documented.filter((s) => preferred.includes(s))
  return pref.length ? pref : documented
}

function statusText(statuses: number[]): string {
  return statuses.length ? statuses.join(' o ') : 'un 4xx'
}

function invalidValueFor(schema: any): { value: any; label: string } | undefined {
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
  if (schema?.enum) return { value: 'VALOR_NO_PERMITIDO', label: 'un valor fuera del enum' }
  if (type === 'integer' || type === 'number') return { value: 'texto-invalido', label: 'un texto en lugar de un número' }
  if (type === 'boolean') return { value: 'no-booleano', label: 'un texto en lugar de un booleano' }
  if (type === 'string' && schema.pattern) return { value: '###', label: `un valor que no cumple el patrón ${schema.pattern}` }
  return undefined
}

export function generateTestCases(wa: WorkflowAnalysis): TestCase[] {
  const wf = wa.workflow
  const cases: TestCase[] = []
  const id = (suffix: string) => `${wf.workflowId}::${suffix}`

  cases.push({
    id: id('happy'),
    workflowId: wf.workflowId,
    title: 'Camino feliz',
    origin: 'arazzo',
    description: 'Ejecuta todos los pasos con los inputs indicados; cada paso debe cumplir sus successCriteria.',
    expectation: { type: 'success', text: 'Todos los pasos cumplen sus criterios.' },
    enabled: true,
  })

  const props = wa.inputsSchema.properties ?? {}

  for (const name of wa.requiredInputs) {
    const consumer = firstConsumer(wa, name)
    if (!consumer) continue
    const statuses = expectedClientErrors(wa, consumer.step.stepId, [400, 422])
    cases.push({
      id: id(`missing-${name}`),
      workflowId: wf.workflowId,
      title: `Sin el input obligatorio "${name}"`,
      origin: 'schema',
      description: `Omite "${name}". El primer paso que lo usa es "${consumer.step.stepId}".`,
      omitInput: name,
      expectation: {
        type: 'failure',
        stepId: consumer.step.stepId,
        statuses,
        text: `El paso "${consumer.step.stepId}" debe rechazar la petición con ${statusText(statuses)}.`,
      },
      enabled: true,
    })
  }

  for (const [name, schema] of Object.entries<any>(props)) {
    const invalid = invalidValueFor(schema)
    const consumer = firstConsumer(wa, name)
    if (!invalid || !consumer) continue
    const statuses = expectedClientErrors(wa, consumer.step.stepId, [400, 422])
    cases.push({
      id: id(`invalid-${name}`),
      workflowId: wf.workflowId,
      title: `"${name}" con ${invalid.label}`,
      origin: 'schema',
      description: `Envía ${JSON.stringify(invalid.value)} en "${name}". El primer paso que lo usa es "${consumer.step.stepId}".`,
      setInput: { name, value: invalid.value },
      expectation: {
        type: 'failure',
        stepId: consumer.step.stepId,
        statuses,
        text: `El paso "${consumer.step.stepId}" debe rechazar el dato con ${statusText(statuses)}.`,
      },
      enabled: true,
    })
  }

  const firstSecured = wa.steps.find((s) => s.security.length > 0)
  if (firstSecured) {
    const statuses = [401, 403]
    cases.push({
      id: id('no-auth'),
      workflowId: wf.workflowId,
      title: 'Sin credenciales',
      origin: 'security',
      description: `Ejecuta sin enviar credenciales. El primer paso protegido es "${firstSecured.step.stepId}".`,
      dropAuth: true,
      expectation: {
        type: 'failure',
        stepId: firstSecured.step.stepId,
        statuses,
        text: `El paso "${firstSecured.step.stepId}" debe responder 401 o 403.`,
      },
      enabled: true,
    })
  }

  cases.push(...scenarioCases(wa))
  return cases
}

function actionEffect(a: Action): string {
  if (a.type === 'end') return 'terminar el workflow'
  if (a.type === 'retry') return `reintentar el paso${a.retryLimit ? ` (hasta ${a.retryLimit} vez/veces)` : ''}`
  if (a.type === 'goto') return a.stepId ? `ir al paso "${a.stepId}"` : `continuar en el workflow "${a.workflowId}"`
  return 'ejecutarse'
}

/** Un caso por cada acción onFailure/onSuccess con criterios: se simula la respuesta que la activa. */
function scenarioCases(wa: WorkflowAnalysis): TestCase[] {
  const wf = wa.workflow
  const out: TestCase[] = []
  for (const rs of wa.steps) {
    if (rs.kind !== 'operation') continue
    const step = rs.step
    const groups: ['onFailure' | 'onSuccess', Action[]][] = [
      ['onFailure', step.onFailure ?? wf.failureActions ?? []],
      ['onSuccess', step.onSuccess ?? wf.successActions ?? []],
    ]
    for (const [trigger, actions] of groups) {
      actions.forEach((action, index) => {
        if (!action.criteria?.length) return
        const req = requirementsFromCriteria(action.criteria)
        const success = requirementsFromCriteria(step.successCriteria)
        const status = req.statuses[0] ?? (trigger === 'onSuccess' ? success.statuses[0] : undefined)
        if (status === undefined) return
        const bodyValues = trigger === 'onSuccess' ? [...success.bodyValues, ...req.bodyValues] : req.bodyValues
        const name = action.name ?? `${trigger}[${index}]`
        const detail = bodyValues.map((b) => String(b.value)).join(' ')
        out.push({
          id: `${wf.workflowId}::scenario-${step.stepId}-${trigger}-${name}`,
          workflowId: wf.workflowId,
          title: `${step.stepId} responde ${status}${detail ? ` ${detail}` : ''} → ${name}`,
          origin: 'escenario',
          description: `Simula que "${step.stepId}" responde ${status}${detail ? ` con ${bodyValues.map((b) => `${b.pointer.slice(1)} = ${JSON.stringify(b.value)}`).join(', ')}` : ''} usando los ejemplos del contrato. Los demás pasos responden con éxito.`,
          scenario: { stepId: step.stepId, status, bodyValues },
          expectation: {
            type: 'action',
            stepId: step.stepId,
            actionName: name,
            text: `El paso "${step.stepId}" debe activar la acción "${name}" (${trigger}) y ${actionEffect(action)}.`,
          },
          enabled: true,
        })
      })
    }
  }
  return out
}

/** Inputs con los que corre el caso: base → cambios del caso → datos propios → generadores. */
export function applyCaseInputs(tc: TestCase, inputs: Record<string, any>): Record<string, any> {
  const out = { ...inputs, ...(tc.inputOverrides ?? {}) }
  if (tc.omitInput) delete out[tc.omitInput]
  for (const k of tc.omitInputs ?? []) delete out[k]
  if (tc.setInput) out[tc.setInput.name] = tc.setInput.value
  for (const [k, v] of Object.entries(out)) if (v === undefined || v === '') delete out[k]
  return resolveTemplates(out)
}

/** Texto corto que dice con qué datos corre el caso. */
export function dataSummary(tc: TestCase): string {
  const parts: string[] = []
  const overrides = Object.entries(tc.inputOverrides ?? {}).filter(([, v]) => v !== undefined && v !== '')
  for (const [k, v] of overrides) parts.push(`${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  if (tc.omitInput) parts.push(`sin ${tc.omitInput}`)
  for (const k of tc.omitInputs ?? []) parts.push(`sin ${k}`)
  if (tc.setInput) parts.push(`${tc.setInput.name} = ${JSON.stringify(tc.setInput.value)}`)
  if (tc.dropAuth) parts.push('sin credenciales')
  return parts.length ? `por defecto + ${parts.join(', ')}` : 'valores por defecto'
}

export type RunMode = 'real' | 'simulado'

/** Si el caso se va a simular o se ejecuta contra la API real. */
export function isSimulated(tc: TestCase, mode: RunMode): boolean {
  if (tc.scenario) return tc.dataMode !== 'real'
  if (tc.origin === 'datos') return false
  return mode === 'simulado'
}

/** Si el caso se puede ejecutar tal como está configurado; si no, por qué. */
export function runnability(tc: TestCase, mode: RunMode): { ok: boolean; reason?: string } {
  const hasData = Object.values(tc.inputOverrides ?? {}).some((v) => v !== undefined && v !== '') || (tc.omitInputs?.length ?? 0) > 0
  if (tc.scenario && tc.dataMode === 'real' && !hasData) {
    return { ok: false, reason: 'Para probarlo contra la API real, cambia en Parámetros los valores que provocan esta respuesta.' }
  }
  if (tc.origin === 'datos' && mode === 'simulado') {
    return { ok: false, reason: 'Los casos con datos propios solo tienen sentido contra la API real.' }
  }
  if (!tc.scenario && tc.expectation.type === 'failure' && mode === 'simulado') {
    return { ok: false, reason: 'Necesita la API real: la simulación no valida los datos enviados.' }
  }
  return { ok: true }
}

/** Caso nuevo con datos propios y una expectativa concreta. */
export function createDataCase(params: {
  workflowId: string
  title: string
  inputOverrides: Record<string, any>
  stepId: string
  statuses: number[]
  code?: string
  actionName?: string
}): TestCase {
  const parts = [
    params.statuses.length ? `responder ${params.statuses.join(' o ')}` : '',
    params.code ? `con code ${params.code}` : '',
    params.actionName ? `y activar "${params.actionName}"` : '',
  ].filter(Boolean)
  return {
    id: `${params.workflowId}::datos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    workflowId: params.workflowId,
    title: params.title,
    origin: 'datos',
    description: 'Caso definido por el usuario con su propia combinación de datos.',
    inputOverrides: params.inputOverrides,
    expectation: {
      type: 'response',
      stepId: params.stepId,
      statuses: params.statuses,
      code: params.code,
      actionName: params.actionName,
      text: `El paso "${params.stepId}" debe ${parts.join(' ') || 'ejecutarse'}.`,
    },
    enabled: true,
  }
}

export function evaluateCase(tc: TestCase, run: WorkflowRunResult): { verdict: Verdict; explanation: string } {
  const failed = run.steps.find((s) => s.status === 'failed')

  if (tc.expectation.type === 'response') {
    const e = tc.expectation
    const target = run.steps.find((s) => s.stepId === e.stepId)
    if (!target || target.status === 'skipped' || !target.response) {
      return {
        verdict: 'inconclusive',
        explanation: target?.response
          ? ''
          : failed
            ? `No se llegó a una respuesta de "${e.stepId}": el flujo se detuvo en "${failed.stepId}" (${failed.reason?.message ?? ''}).`
            : (target?.reason?.message ?? `No se ejecutó "${e.stepId}".`),
      }
    }
    const problems: string[] = []
    const status = target.response.status
    if (e.statuses?.length && !e.statuses.includes(status)) problems.push(`respondió ${status} y se esperaba ${e.statuses.join(' o ')}`)
    const code = target.response.body && typeof target.response.body === 'object' ? target.response.body.code : undefined
    if (e.code && code !== e.code) problems.push(`el code fue ${code === undefined ? '(sin code)' : `"${code}"`} y se esperaba "${e.code}"`)
    const action = run.actions.find((a) => a.stepId === e.stepId)
    if (e.actionName && action?.name !== e.actionName) {
      problems.push(action ? `se activó "${action.name}" en lugar de "${e.actionName}"` : `no se activó "${e.actionName}"`)
    }
    return problems.length
      ? { verdict: 'failed', explanation: `"${e.stepId}" ${problems.join('; ')}.` }
      : {
          verdict: 'passed',
          explanation: `"${e.stepId}" respondió ${status}${code ? ` con code "${code}"` : ''}${action ? ` y activó "${action.name}"` : ''}, como se esperaba.`,
        }
  }

  if (tc.expectation.type === 'success') {
    if (run.status === 'success') {
      const warnings = run.steps.filter((s) => s.status === 'warning')
      return {
        verdict: 'passed',
        explanation: warnings.length
          ? `El flujo terminó bien, con advertencias en: ${warnings.map((w) => `"${w.stepId}"`).join(', ')}.`
          : 'Todos los pasos cumplieron sus criterios.',
      }
    }
    return {
      verdict: failed?.reason?.category === 'red' ? 'inconclusive' : 'failed',
      explanation: failed
        ? `Falló en el paso "${failed.stepId}": ${failed.reason?.message ?? ''}`
        : (run.reason?.message ?? 'El workflow no terminó correctamente.'),
    }
  }

  if (tc.expectation.type === 'action') {
    const stepId = tc.expectation.stepId
    const first = run.steps.find((s) => s.stepId === stepId)
    const triggered = run.actions.find((a) => a.stepId === stepId)
    if (!first || first.status === 'skipped') {
      const failedBefore = run.steps.find((s) => s.status === 'failed')
      return {
        verdict: 'inconclusive',
        explanation: failedBefore
          ? `No se llegó a "${stepId}": el flujo se detuvo en "${failedBefore.stepId}" (${failedBefore.reason?.message ?? ''}). ${
              run.steps.some((s) => s.simulated)
                ? 'Revisa que los pasos anteriores cumplan sus criterios con los ejemplos del contrato.'
                : 'Revisa los parámetros del caso: los pasos anteriores deben poder completarse.'
            }`
          : `No se llegó a ejecutar "${stepId}".`,
      }
    }
    const then = run.status === 'success' ? 'El workflow terminó con éxito.' : 'El workflow terminó con error.'
    if (triggered && triggered.name === tc.expectation.actionName) {
      return {
        verdict: 'passed',
        explanation: `Con la respuesta ${first.response?.status ?? ''}, "${stepId}" activó "${triggered.name}" (${triggered.type}), como se esperaba. ${then}`,
      }
    }
    if (triggered) {
      return {
        verdict: 'failed',
        explanation: `Con la respuesta ${first.response?.status ?? ''}, "${stepId}" activó "${triggered.name}" en lugar de "${tc.expectation.actionName}". Revisa el orden o los criterios de las acciones: se usa la primera cuyos criterios se cumplen.`,
      }
    }
    return {
      verdict: 'failed',
      explanation: `Con la respuesta ${first.response?.status ?? ''}, ninguna acción de "${stepId}" coincidió, así que no se activó "${tc.expectation.actionName}". Revisa sus criterios.`,
    }
  }

  // Caso negativo
  const target = run.steps.find((s) => s.stepId === tc.expectation.stepId)
  const accepted = tc.expectation.statuses ?? []
  if (!target || target.status === 'skipped') {
    return {
      verdict: 'inconclusive',
      explanation: failed
        ? `El flujo se detuvo antes, en "${failed.stepId}" (${failed.reason?.message ?? ''}), así que no se pudo comprobar "${tc.expectation.stepId}".`
        : `No se llegó a ejecutar "${tc.expectation.stepId}".`,
    }
  }
  if (!target.response) {
    return { verdict: 'inconclusive', explanation: target.reason?.message ?? 'No hubo respuesta de la API.' }
  }
  const status = target.response.status
  const ok = accepted.length ? accepted.includes(status) : status >= 400 && status < 500
  if (ok) {
    return { verdict: 'passed', explanation: `"${target.stepId}" rechazó la petición con ${status}, como se esperaba.` }
  }
  if (status >= 200 && status < 300) {
    return {
      verdict: 'failed',
      explanation: `"${target.stepId}" aceptó la petición (${status}) cuando debía rechazarla con ${statusText(accepted)}.`,
    }
  }
  return {
    verdict: 'failed',
    explanation: `"${target.stepId}" respondió ${status}; se esperaba ${statusText(accepted)}.`,
  }
}

/** Estado de la ejecución de un caso. */
export interface CaseRun {
  tc: TestCase
  state: 'pending' | 'running' | 'done'
  steps: StepResult[]
  result?: WorkflowRunResult
  verdict?: Verdict
  explanation?: string
  /** Parámetros con los que corrió el caso (ya con generadores resueltos). */
  inputsUsed?: Record<string, any>
  simulated?: boolean
}

/** Valores iniciales de los inputs de un workflow, tomados de example/default/enum del schema. */
export function defaultInputs(schema: any): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [name, s] of Object.entries<any>(schema?.properties ?? {})) {
    const v = s.example ?? s.examples?.[0] ?? s.default ?? s.enum?.[0]
    if (v !== undefined) out[name] = v
  }
  return out
}
