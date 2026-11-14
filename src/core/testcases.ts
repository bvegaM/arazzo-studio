/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ResolvedStep, WorkflowAnalysis } from './analyze'
import { collectReferences } from './expressions'
import { documentedStatuses, isAsyncOperation } from './openapi'
import type { StepResult, WorkflowRunResult } from './runner'
import { requirementsFromCriteria } from './criteria'
import type { Scenario } from './simulator'
import type { Action } from './types'
import { resolveTemplates } from './templates'
import { exampleValue } from './schemaForm'
import { joinOr, t } from '../i18n'

export type CaseOrigin = 'arazzo' | 'escenario' | 'schema' | 'security' | 'datos'

export function originLabel(origin: CaseOrigin): string {
  return t(`origin.${origin}`)
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
  /** Archivo Arazzo de la colección al que pertenece el workflow. */
  arazzo?: string
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

export function verdictLabel(verdict: Verdict): string {
  return t(`verdict.${verdict}`)
}

// Solo pasos HTTP: los de mensajería no responden con un error a un dato inválido.
function firstConsumer(wa: WorkflowAnalysis, input: string) {
  return wa.steps.find((s) => !isAsyncOperation(s.op) && collectReferences({ ...s.step, parameters: s.parameters }).inputs.includes(input))
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
  return statuses.length ? joinOr(statuses) : t('tc.any4xx')
}

function invalidValueFor(schema: any): { value: any; label: string } | undefined {
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
  if (schema?.enum) return { value: 'VALOR_NO_PERMITIDO', label: t('tc.invalid.enum') }
  if (type === 'integer' || type === 'number') return { value: 'texto-invalido', label: t('tc.invalid.number') }
  if (type === 'boolean') return { value: 'no-booleano', label: t('tc.invalid.boolean') }
  if (type === 'string' && schema.pattern) return { value: '###', label: t('tc.invalid.pattern', { pattern: schema.pattern }) }
  return undefined
}

export function generateTestCases(wa: WorkflowAnalysis): TestCase[] {
  const wf = wa.workflow
  const cases: TestCase[] = []
  const id = (suffix: string) => `${wf.workflowId}::${suffix}`

  cases.push({
    id: id('happy'),
    workflowId: wf.workflowId,
    title: t('tc.happy.title'),
    origin: 'arazzo',
    description: t('tc.happy.description'),
    expectation: { type: 'success', text: t('tc.happy.expectation') },
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
      title: t('tc.missing.title', { name }),
      origin: 'schema',
      description: t('tc.missing.description', { name, step: consumer.step.stepId }),
      omitInput: name,
      expectation: {
        type: 'failure',
        stepId: consumer.step.stepId,
        statuses,
        text: t('tc.missing.expectation', { step: consumer.step.stepId, statuses: statusText(statuses) }),
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
      title: t('tc.invalid.title', { name, label: invalid.label }),
      origin: 'schema',
      description: t('tc.invalid.description', { value: JSON.stringify(invalid.value), name, step: consumer.step.stepId }),
      setInput: { name, value: invalid.value },
      expectation: {
        type: 'failure',
        stepId: consumer.step.stepId,
        statuses,
        text: t('tc.invalid.expectation', { step: consumer.step.stepId, statuses: statusText(statuses) }),
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
      title: t('tc.noAuth.title'),
      origin: 'security',
      description: t('tc.noAuth.description', { step: firstSecured.step.stepId }),
      dropAuth: true,
      expectation: {
        type: 'failure',
        stepId: firstSecured.step.stepId,
        statuses,
        text: t('tc.noAuth.expectation', { step: firstSecured.step.stepId, statuses: joinOr(statuses) }),
      },
      enabled: true,
    })
  }

  cases.push(...scenarioCases(wa))
  return cases
}

function actionEffect(a: Action): string {
  if (a.type === 'end') return t('tc.effect.end')
  if (a.type === 'retry') return a.retryLimit ? t('tc.effect.retryLimit', { limit: a.retryLimit }) : t('tc.effect.retry')
  if (a.type === 'goto') return a.stepId ? t('tc.effect.gotoStep', { step: a.stepId }) : t('tc.effect.gotoWorkflow', { workflow: a.workflowId ?? '' })
  return t('tc.effect.run')
}

/** Un caso por cada acción onFailure/onSuccess con criterios: se simula la respuesta que la activa. */
function scenarioCases(wa: WorkflowAnalysis): TestCase[] {
  const wf = wa.workflow
  const out: TestCase[] = []
  for (const rs of wa.steps) {
    if (rs.kind !== 'operation') continue
    if (isAsyncOperation(rs.op)) {
      out.push(...messageScenarioCases(wa, rs))
      continue
    }
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
          title: t('tc.scenario.title', { step: step.stepId, status, detail: detail ? ` ${detail}` : '', action: name }),
          origin: 'escenario',
          description: detail
            ? t('tc.scenario.descriptionBody', { step: step.stepId, status, body: bodyValues.map((b) => `${b.pointer.slice(1)} = ${JSON.stringify(b.value)}`).join(', ') })
            : t('tc.scenario.description', { step: step.stepId, status }),
          scenario: { stepId: step.stepId, status, bodyValues },
          expectation: {
            type: 'action',
            stepId: step.stepId,
            actionName: name,
            text: t('tc.scenario.expectation', { step: step.stepId, action: name, trigger, effect: actionEffect(action) }),
          },
          enabled: true,
        })
      })
    }
  }
  return out
}

/**
 * Escenarios de un paso AsyncAPI receive: un mensaje con los valores que activa cada acción
 * con criterios, y "no llega ningún mensaje" para la acción onFailure sin criterios.
 */
function messageScenarioCases(wa: WorkflowAnalysis, rs: ResolvedStep): TestCase[] {
  const wf = wa.workflow
  const step = rs.step
  if ((step.action ?? rs.op?.method) !== 'receive') return []
  const out: TestCase[] = []
  const success = requirementsFromCriteria(step.successCriteria)
  const push = (trigger: 'onFailure' | 'onSuccess', action: Action, name: string, scenario: Scenario, title: string, description: string) =>
    out.push({
      id: `${wf.workflowId}::scenario-${step.stepId}-${trigger}-${name}`,
      workflowId: wf.workflowId,
      title,
      origin: 'escenario',
      description,
      scenario,
      expectation: {
        type: 'action',
        stepId: step.stepId,
        actionName: name,
        text: t('tc.scenario.expectation', { step: step.stepId, action: name, trigger, effect: actionEffect(action) }),
      },
      enabled: true,
    })

  const groups: ['onFailure' | 'onSuccess', Action[]][] = [
    ['onFailure', step.onFailure ?? wf.failureActions ?? []],
    ['onSuccess', step.onSuccess ?? wf.successActions ?? []],
  ]
  for (const [trigger, actions] of groups) {
    actions.forEach((action, index) => {
      const name = action.name ?? `${trigger}[${index}]`
      if (!action.criteria?.length) return
      const req = requirementsFromCriteria(action.criteria)
      if (!req.bodyValues.length) return
      const bodyValues = trigger === 'onSuccess' ? [...success.bodyValues, ...req.bodyValues] : req.bodyValues
      const detail = bodyValues.map((b) => `${b.pointer.slice(1)} = ${JSON.stringify(b.value)}`).join(', ')
      push(
        trigger,
        action,
        name,
        { stepId: step.stepId, status: 0, bodyValues },
        t('tc.msg.title', { step: step.stepId, detail: ` ${bodyValues.map((b) => String(b.value)).join(' ')}`, action: name }),
        t('tc.msg.description', { step: step.stepId, body: detail }),
      )
    })
  }
  const failures = step.onFailure ?? wf.failureActions ?? []
  const catchAll = failures.findIndex((a) => !a.criteria?.length)
  if (catchAll >= 0) {
    const action = failures[catchAll]
    const name = action.name ?? `onFailure[${catchAll}]`
    push(
      'onFailure',
      action,
      name,
      { stepId: step.stepId, status: 0, bodyValues: [], timeout: true },
      t('tc.msg.timeoutTitle', { step: step.stepId, action: name }),
      t('tc.msg.timeoutDescription', { step: step.stepId }),
    )
  }
  return out
}

/** Inputs con los que corre el caso: base → cambios del caso → datos propios → variables y generadores. */
export function applyCaseInputs(tc: TestCase, inputs: Record<string, any>, variables: Record<string, string> = {}): Record<string, any> {
  const out = { ...inputs, ...(tc.inputOverrides ?? {}) }
  if (tc.omitInput) delete out[tc.omitInput]
  for (const k of tc.omitInputs ?? []) delete out[k]
  if (tc.setInput) out[tc.setInput.name] = tc.setInput.value
  for (const [k, v] of Object.entries(out)) if (v === undefined || v === '') delete out[k]
  return resolveTemplates(out, variables)
}

/** Texto corto que dice con qué datos corre el caso. */
export function dataSummary(tc: TestCase): string {
  const parts: string[] = []
  const overrides = Object.entries(tc.inputOverrides ?? {}).filter(([, v]) => v !== undefined && v !== '')
  for (const [k, v] of overrides) parts.push(`${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  if (tc.omitInput) parts.push(t('tc.summary.without', { name: tc.omitInput }))
  for (const k of tc.omitInputs ?? []) parts.push(t('tc.summary.without', { name: k }))
  if (tc.setInput) parts.push(`${tc.setInput.name} = ${JSON.stringify(tc.setInput.value)}`)
  if (tc.dropAuth) parts.push(t('tc.summary.noAuth'))
  return parts.length ? t('tc.summary.defaultsPlus', { parts: parts.join(', ') }) : t('tc.summary.defaults')
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
    return { ok: false, reason: t('tc.run.needsData') }
  }
  if (tc.origin === 'datos' && mode === 'simulado') {
    return { ok: false, reason: t('tc.run.dataOnlyReal') }
  }
  if (!tc.scenario && tc.expectation.type === 'failure' && mode === 'simulado') {
    return { ok: false, reason: t('tc.run.needsReal') }
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
    params.statuses.length ? t('tc.data.respond', { statuses: joinOr(params.statuses) }) : '',
    params.code ? t('tc.data.withCode', { code: params.code }) : '',
    params.actionName ? t('tc.data.andAction', { action: params.actionName }) : '',
  ].filter(Boolean)
  return {
    id: `${params.workflowId}::datos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
    workflowId: params.workflowId,
    title: params.title,
    origin: 'datos',
    description: t('tc.data.description'),
    inputOverrides: params.inputOverrides,
    expectation: {
      type: 'response',
      stepId: params.stepId,
      statuses: params.statuses,
      code: params.code,
      actionName: params.actionName,
      text: t('tc.data.expectation', { step: params.stepId, what: parts.join(' ') || t('tc.effect.run') }),
    },
    enabled: true,
  }
}

/** Cómo terminó un paso, para los textos: status HTTP o, en mensajería, si llegó mensaje. */
function responseLabel(step: StepResult): string | number {
  if (step.response) return step.response.status
  if (step.message?.action === 'receive') return t('ev.msg.received')
  return step.request?.method === 'RECEIVE' ? t('ev.msg.none') : ''
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
            ? t('ev.noResponseStopped', { step: e.stepId, failed: failed.stepId, reason: failed.reason?.message ?? '' })
            : (target?.reason?.message ?? t('ev.notRun', { step: e.stepId })),
      }
    }
    const problems: string[] = []
    const status = target.response.status
    if (e.statuses?.length && !e.statuses.includes(status)) problems.push(t('ev.problem.status', { status, expected: joinOr(e.statuses) }))
    const code = target.response.body && typeof target.response.body === 'object' ? target.response.body.code : undefined
    if (e.code && code !== e.code) problems.push(t('ev.problem.code', { code: code === undefined ? t('ev.noCode') : `"${code}"`, expected: e.code }))
    const action = run.actions.find((a) => a.stepId === e.stepId)
    if (e.actionName && action?.name !== e.actionName) {
      problems.push(action ? t('ev.problem.otherAction', { action: action.name, expected: e.actionName }) : t('ev.problem.noAction', { expected: e.actionName }))
    }
    return problems.length
      ? { verdict: 'failed', explanation: t('ev.problems', { step: e.stepId, problems: problems.join('; ') }) }
      : {
          verdict: 'passed',
          explanation: t('ev.responseOk', {
            step: e.stepId,
            status,
            code: code ? t('ev.withCode', { code }) : '',
            action: action ? t('ev.andActivated', { action: action.name }) : '',
          }),
        }
  }

  if (tc.expectation.type === 'success') {
    if (run.status === 'success') {
      const warnings = run.steps.filter((s) => s.status === 'warning')
      return {
        verdict: 'passed',
        explanation: warnings.length
          ? t('ev.successWithWarnings', { steps: warnings.map((w) => `"${w.stepId}"`).join(', ') })
          : t('ev.allPassed'),
      }
    }
    return {
      verdict: failed?.reason?.category === 'red' ? 'inconclusive' : 'failed',
      explanation: failed
        ? t('ev.failedAt', { step: failed.stepId, reason: failed.reason?.message ?? '' })
        : (run.reason?.message ?? t('ev.workflowFailed')),
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
          ? t('ev.notReached', {
              step: stepId ?? '',
              failed: failedBefore.stepId,
              reason: failedBefore.reason?.message ?? '',
              hint: run.steps.some((s) => s.simulated) ? t('ev.hint.simulated') : t('ev.hint.real'),
            })
          : t('ev.notExecuted', { step: stepId ?? '' }),
      }
    }
    const then = run.status === 'success' ? t('ev.endedOk') : t('ev.endedError')
    if (triggered && triggered.name === tc.expectation.actionName) {
      return {
        verdict: 'passed',
        explanation: t('ev.action.ok', { status: responseLabel(first), step: stepId ?? '', action: triggered.name, type: triggered.type, then }),
      }
    }
    if (triggered) {
      return {
        verdict: 'failed',
        explanation: t('ev.action.other', { status: responseLabel(first), step: stepId ?? '', action: triggered.name, expected: tc.expectation.actionName ?? '' }),
      }
    }
    return {
      verdict: 'failed',
      explanation: t('ev.action.none', { status: responseLabel(first), step: stepId ?? '', expected: tc.expectation.actionName ?? '' }),
    }
  }

  // Caso negativo
  const target = run.steps.find((s) => s.stepId === tc.expectation.stepId)
  const accepted = tc.expectation.statuses ?? []
  if (!target || target.status === 'skipped') {
    return {
      verdict: 'inconclusive',
      explanation: failed
        ? t('ev.stoppedBefore', { failed: failed.stepId, reason: failed.reason?.message ?? '', step: tc.expectation.stepId ?? '' })
        : t('ev.notExecuted', { step: tc.expectation.stepId ?? '' }),
    }
  }
  if (!target.response) {
    return { verdict: 'inconclusive', explanation: target.reason?.message ?? t('ev.noApiResponse') }
  }
  const status = target.response.status
  const ok = accepted.length ? accepted.includes(status) : status >= 400 && status < 500
  if (ok) {
    return { verdict: 'passed', explanation: t('ev.rejectedOk', { step: target.stepId, status }) }
  }
  if (status >= 200 && status < 300) {
    return {
      verdict: 'failed',
      explanation: t('ev.acceptedWrongly', { step: target.stepId, status, expected: statusText(accepted) }),
    }
  }
  return {
    verdict: 'failed',
    explanation: t('ev.wrongStatus', { step: target.stepId, status, expected: statusText(accepted) }),
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
    const v = exampleValue(s)
    if (v !== undefined) out[name] = v
  }
  return out
}
