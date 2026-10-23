/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Project } from './loader'
import type { Action, Workflow } from './types'
import type { ProjectAnalysis, ResolvedStep, WorkflowAnalysis } from './analyze'
import { evaluateCriterion, type CriterionResult } from './criteria'
import { evaluateExpression, interpolate, isRuntimeExpression, type ExprContext } from './expressions'
import { setByPointer } from './jsonPointer'
import { getServerUrl, operationRequestBody, type SecurityScheme } from './openapi'
import { validateAgainstContract } from './contract'
import { NetworkError, type HttpExecutor } from './http'
import { t } from '../i18n'

export type StepStatus = 'success' | 'warning' | 'failed' | 'skipped'

export type ReasonCategory =
  | 'criterio'
  | 'contrato'
  | 'autenticacion'
  | 'red'
  | 'dato-previo'
  | 'operacion'
  | 'dependencia'
  | 'error-api'
  | 'output'

export function reasonLabel(category: ReasonCategory): string {
  return t(`reason.${category}`)
}

export interface Reason {
  category: ReasonCategory
  message: string
  /** Detalle de las fallas de red, para poder dar ayuda específica. */
  code?: 'network' | 'no-server' | 'cancelled'
}

export interface StepResult {
  stepId: string
  label: string
  description?: string
  status: StepStatus
  attempts: number
  request?: { method: string; url: string; headers: Record<string, string>; body?: any }
  response?: { status: number; statusText: string; headers: Record<string, string>; body: any; durationMs: number }
  criteria: CriterionResult[]
  outputs: Record<string, any>
  missingOutputs: string[]
  contractIssues: string[]
  unresolved: string[]
  reason?: Reason
  action?: string
  /** Acción del Arazzo que se activó después de este paso. */
  actionName?: string
  actionType?: string
  simulated?: boolean
  subRun?: WorkflowRunResult
}

export interface WorkflowRunResult {
  workflowId: string
  status: 'success' | 'failed'
  steps: StepResult[]
  outputs: Record<string, any>
  durationMs: number
  reason?: Reason
  /** Acciones activadas, en orden de ejecución. */
  actions: { stepId: string; name: string; type: string }[]
}

export interface RunOptions {
  inputs: Record<string, any>
  credentials: Record<string, string>
  servers: Record<string, string>
  dropAuth?: boolean
  executor: HttpExecutor
  signal?: AbortSignal
  onStep?: (r: StepResult) => void
  maxRetryWaitMs?: number
}

const MAX_EXECUTIONS = 200
const SENSITIVE_HEADER = /authorization|token|secret|api[-_]?key|password|cookie/i

function apiMessage(body: any): string | undefined {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body.length < 200 ? body : undefined
  const m = body.message ?? body.error_description ?? body.detail ?? body.title ?? body.error
  return typeof m === 'string' ? m : undefined
}

function mask(value: string): string {
  if (value.length <= 4) return '••••'
  const [scheme, rest] = value.includes(' ') ? [value.split(' ')[0] + ' ', value.split(' ').slice(1).join(' ')] : ['', value]
  return `${scheme}${rest.slice(0, 2)}••••${rest.slice(-2)}`
}

function resolveAction(project: Project, a: Action): Action {
  if (!a.reference) return a
  const m = a.reference.match(/^\$components\.(successActions|failureActions)\.(.+)$/)
  const base = m ? (project.arazzo.components as any)?.[m[1]]?.[m[2]] : undefined
  return base ? { ...base, ...a } : a
}

function chooseAction(project: Project, actions: Action[] | undefined, ctx: ExprContext): Action | undefined {
  for (const raw of actions ?? []) {
    const a = resolveAction(project, raw)
    if (!a.criteria?.length || a.criteria.every((c) => evaluateCriterion(c, ctx).passed)) return a
  }
  return undefined
}

/** Aplica las credenciales y devuelve los nombres de query que llevan un secreto. */
function applyAuth(
  schemes: SecurityScheme[],
  credentials: Record<string, string>,
  headers: Record<string, string>,
  display: Record<string, string>,
  query: URLSearchParams,
): string[] {
  const secretQuery: string[] = []
  for (const s of schemes) {
    const value = credentials[s.key]?.trim()
    if (!value) continue
    if (s.type === 'bearer' || s.type === 'oauth2' || s.type === 'openIdConnect') {
      headers['Authorization'] = /^bearer\s/i.test(value) ? value : `Bearer ${value}`
      display['Authorization'] = mask(headers['Authorization'])
    } else if (s.type === 'basic') {
      headers['Authorization'] = /^basic\s/i.test(value) ? value : `Basic ${btoa(value)}`
      display['Authorization'] = 'Basic ••••'
    } else if (s.type === 'apiKey' && s.paramName) {
      if (s.in === 'header') {
        headers[s.paramName] = value
        display[s.paramName] = mask(value)
      } else if (s.in === 'query') {
        query.set(s.paramName, value)
        secretQuery.push(s.paramName)
      }
    }
  }
  return secretQuery
}

// Petición real (sin enmascarar) de cada paso. Se guarda aparte para que los secretos
// no queden en el resultado, que se muestra, se exporta y va al reporte.
const realRequests = new WeakMap<object, { url: string; headers: Record<string, string> }>()

/** La petición con los valores reales de URL y headers, si se ejecutó en esta sesión. */
export function realRequest<T extends { url: string; headers: Record<string, string> }>(request: T): T {
  const real = realRequests.get(request)
  return real ? { ...request, ...real } : request
}

function parseBody(text: string, contentType: string): any {
  if (!text) return undefined
  const t = text.trim()
  if (/json/i.test(contentType) || t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      return text
    }
  }
  return text
}

async function executeOperationStep(
  rs: ResolvedStep,
  project: Project,
  ctx: ExprContext,
  opts: RunOptions,
  requiredInputs: string[],
  consumedOutputs: string[],
): Promise<StepResult> {
  const op = rs.op!
  const step = rs.step
  const unresolved: string[] = []
  ctx.unresolved = unresolved
  ctx.request = undefined
  ctx.response = undefined

  const source = project.sources.find((s) => s.name === op.sourceName)
  const server = (opts.servers[op.sourceName] || getServerUrl(source)).replace(/\/$/, '')

  // Parámetros: el último definido gana (workflow → paso)
  const byKey = new Map<string, (typeof rs.parameters)[number]>()
  for (const p of rs.parameters) {
    const inferredIn = p.in ?? (op.path.includes(`{${p.name}}`) ? 'path' : 'query')
    byKey.set(`${inferredIn}:${p.name.toLowerCase()}`, { ...p, in: inferredIn })
  }
  const headers: Record<string, string> = {}
  const displayHeaders: Record<string, string> = {}
  const query = new URLSearchParams()
  const pathParams: Record<string, string> = {}

  for (const p of byKey.values()) {
    const value = interpolate(p.value, ctx)
    if (p.in === 'path') pathParams[p.name] = value === undefined || value === null ? '' : String(value)
    else if (value === undefined || value === null) continue
    else if (p.in === 'query') {
      if (Array.isArray(value)) value.forEach((v) => query.append(p.name, String(v)))
      else query.set(p.name, typeof value === 'object' ? JSON.stringify(value) : String(value))
    } else if (p.in === 'header') {
      headers[p.name] = String(value)
      displayHeaders[p.name] = SENSITIVE_HEADER.test(p.name) ? mask(String(value)) : String(value)
    }
  }

  const secretQuery = opts.dropAuth ? [] : applyAuth(rs.security, opts.credentials, headers, displayHeaders, query)

  // Body
  let payload: any
  let bodyText: string | undefined
  if (step.requestBody) {
    const contract = operationRequestBody(op)
    const contentType =
      step.requestBody.contentType ?? Object.keys(contract?.content ?? {})[0] ?? 'application/json'
    payload = interpolate(structuredClone(step.requestBody.payload ?? null), ctx)
    for (const r of step.requestBody.replacements ?? []) payload = setByPointer(payload, r.target, interpolate(r.value, ctx))
    if (/json/i.test(contentType)) bodyText = payload === undefined ? undefined : JSON.stringify(payload)
    else if (/x-www-form-urlencoded/i.test(contentType) && payload && typeof payload === 'object') {
      bodyText = new URLSearchParams(
        Object.entries(payload).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
      ).toString()
    } else bodyText = payload === undefined ? undefined : String(payload)
    headers['Content-Type'] = contentType
    displayHeaders['Content-Type'] = contentType
  }

  const path = op.path.replace(/\{([^}]+)\}/g, (_m, n: string) => encodeURIComponent(pathParams[n] ?? ''))
  const qs = query.toString()
  const url = `${server}${path}${qs ? `?${qs}` : ''}`
  // En la URL que se muestra, los secretos de la query van enmascarados (sin codificar la máscara).
  const displayQs = [...query.entries()]
    .map(([k, v]) => `${encodeURIComponent(k)}=${secretQuery.includes(k) || SENSITIVE_HEADER.test(k) ? mask(v) : encodeURIComponent(v)}`)
    .join('&')
  const displayUrl = `${server}${path}${displayQs ? `?${displayQs}` : ''}`

  ctx.request = {
    method: op.method,
    url,
    headers,
    query: Object.fromEntries(query.entries()),
    path: pathParams,
    body: payload,
  }

  const request = { method: op.method.toUpperCase(), url: displayUrl, headers: displayHeaders, body: payload }
  realRequests.set(request, { url, headers: { ...headers } })
  const result: StepResult = {
    stepId: step.stepId,
    label: rs.label,
    description: step.description,
    status: 'failed',
    attempts: 1,
    request,
    criteria: [],
    outputs: {},
    missingOutputs: [],
    contractIssues: [],
    unresolved,
  }

  if (!server) {
    result.reason = {
      category: 'red',
      code: 'no-server',
      message: t('run.noServer', { source: op.sourceName }),
    }
    return result
  }

  let response
  try {
    response = await opts.executor({ method: op.method, url, headers, body: bodyText }, opts.signal, {
      stepId: step.stepId,
      sourceName: op.sourceName,
      method: op.method,
      path: op.path,
    })
  } catch (e) {
    const cancelled = opts.signal?.aborted
    result.reason = {
      category: 'red',
      code: e instanceof NetworkError ? (cancelled ? 'cancelled' : 'network') : undefined,
      message: e instanceof NetworkError ? e.message : t('run.unexpected', { error: (e as Error).message }),
    }
    return result
  }

  const contentType = response.headers['content-type'] ?? ''
  const body = parseBody(response.bodyText, contentType)
  ctx.response = { status: response.status, headers: response.headers, body }
  result.simulated = response.simulated
  result.response = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body,
    durationMs: response.durationMs,
  }

  // Criterios
  if (step.successCriteria?.length) {
    result.criteria = step.successCriteria.map((c) => evaluateCriterion(c, ctx))
  } else {
    const ok = response.status >= 200 && response.status < 300
    result.criteria = [
      {
        condition: t('run.implicit2xx'),
        type: 'simple',
        passed: ok,
        detail: ok ? `$statusCode = ${response.status} ✔` : t('run.expected2xx', { status: response.status }),
      },
    ]
  }

  result.contractIssues = validateAgainstContract(op, response.status, body, contentType)

  // Outputs
  for (const [name, expr] of Object.entries(step.outputs ?? {})) {
    const r = isRuntimeExpression(expr)
      ? evaluateExpression(expr, ctx)
      : { found: true, value: interpolate(expr, { ...ctx, unresolved: [] }) }
    if (r.found) result.outputs[name] = r.value
    else result.missingOutputs.push(name)
  }
  ctx.steps[step.stepId] = { outputs: result.outputs }

  // Los inputs opcionales sin valor no explican un fallo; los datos de pasos previos e inputs obligatorios sí.
  const relevantUnresolved = [...new Set(unresolved)].filter((u) => {
    const m = u.match(/^\$inputs\.([^.#[]+)/)
    return !m || requiredInputs.includes(m[1])
  })
  const passed = result.criteria.every((c) => c.passed)
  const failedCriterion = result.criteria.find((c) => !c.passed)
  const msg = apiMessage(body)

  if (passed) {
    if (result.contractIssues.length) {
      result.status = 'warning'
      result.reason = {
        category: 'contrato',
        message: t('run.contractWarning', { status: response.status, issue: result.contractIssues[0] }),
      }
    } else if (result.missingOutputs.some((o) => consumedOutputs.includes(o))) {
      const used = result.missingOutputs.filter((o) => consumedOutputs.includes(o))
      result.status = 'warning'
      result.reason = {
        category: 'output',
        message: t('run.outputMissing', { outputs: used.map((o) => `"${o}"`).join(', ') }),
      }
    } else result.status = 'success'
  } else {
    result.status = 'failed'
    if (response.status === 401 || response.status === 403) {
      const names = rs.security.map((s) => s.schemeName).join(', ')
      result.reason = {
        category: 'autenticacion',
        message: opts.dropAuth
          ? t('run.authDropped', { status: response.status })
          : t(names ? 'run.authFailedOf' : 'run.authFailed', { status: response.status, msg: msg ? ` ("${msg}")` : '', names }),
      }
    } else if (relevantUnresolved.length) {
      result.reason = {
        category: 'dato-previo',
        message: t('run.unresolved', { refs: relevantUnresolved.join(', '), status: response.status, msg: msg ? ` ("${msg}")` : '' }),
      }
    } else if (response.status >= 400) {
      result.reason = {
        category: 'error-api',
        message: t('run.apiError', { status: `${response.status} ${response.statusText}`.trim(), msg: msg ? `: "${msg}"` : '', detail: failedCriterion?.detail ?? '' }).trim(),
      }
    } else {
      result.reason = { category: 'criterio', message: failedCriterion?.detail ?? t('run.criterionFailed') }
    }
  }
  return result
}

function workflowById(project: Project, id: string): Workflow | undefined {
  return project.arazzo.workflows.find((w) => w.workflowId === id)
}

export async function runWorkflow(
  project: Project,
  analysis: ProjectAnalysis,
  workflowId: string,
  opts: RunOptions,
  depth = 0,
): Promise<WorkflowRunResult> {
  const started = performance.now()
  const wa = analysis.workflows.find((w) => w.workflow.workflowId === workflowId) as WorkflowAnalysis
  const wf = wa.workflow
  const ctx: ExprContext = {
    inputs: opts.inputs,
    steps: {},
    workflows: {},
    sourceUrls: Object.fromEntries(project.sources.map((s) => [s.name, s.url])),
    components: project.arazzo.components,
  }

  const results: StepResult[] = []
  const executed = new Set<string>()
  let status: 'success' | 'failed' = 'success'
  let failure: Reason | undefined
  let i = 0
  let executions = 0
  const retries: Record<string, number> = {}
  const actions: WorkflowRunResult['actions'] = []

  while (i < wa.steps.length) {
    if (opts.signal?.aborted) {
      status = 'failed'
      failure = { category: 'red', code: 'cancelled', message: t('run.cancelled') }
      break
    }
    if (++executions > MAX_EXECUTIONS) {
      status = 'failed'
      failure = { category: 'criterio', message: t('run.loop') }
      break
    }
    const rs = wa.steps[i]
    const step = rs.step
    let result: StepResult

    if (rs.kind === 'unresolved') {
      result = {
        stepId: step.stepId,
        label: rs.label,
        description: step.description,
        status: 'failed',
        attempts: 1,
        criteria: [],
        outputs: {},
        missingOutputs: [],
        contractIssues: [],
        unresolved: [],
        reason: { category: 'operacion', message: t('run.opNotFound', { op: rs.label }) },
      }
    } else if (rs.kind === 'workflow') {
      const subInputs: Record<string, any> = {}
      for (const p of rs.parameters) subInputs[p.name] = interpolate(p.value, ctx)
      const sub =
        depth < 5
          ? await runWorkflow(project, analysis, rs.subWorkflowId!, { ...opts, inputs: subInputs, onStep: undefined }, depth + 1)
          : undefined
      ctx.workflows[rs.subWorkflowId!] = { outputs: sub?.outputs ?? {} }
      const outputs: Record<string, any> = {}
      const missing: string[] = []
      for (const [name, expr] of Object.entries(step.outputs ?? {})) {
        const r = evaluateExpression(expr, { ...ctx, outputs: sub?.outputs ?? {} })
        if (r.found) outputs[name] = r.value
        else missing.push(name)
      }
      ctx.steps[step.stepId] = { outputs }
      const failedStep = sub?.steps.find((s) => s.status === 'failed')
      result = {
        stepId: step.stepId,
        label: rs.label,
        description: step.description,
        status: !sub ? 'failed' : sub.status === 'success' ? 'success' : 'failed',
        attempts: 1,
        criteria: [],
        outputs,
        missingOutputs: missing,
        contractIssues: [],
        unresolved: [],
        subRun: sub,
        reason: !sub
          ? { category: 'criterio', message: t('run.tooDeep') }
          : sub.status === 'failed'
            ? {
                category: 'dependencia',
                message: failedStep
                  ? t('run.subFailedAt', { workflow: rs.subWorkflowId ?? '', step: failedStep.stepId, reason: failedStep.reason?.message ?? '' })
                  : t('run.subFailed', { workflow: rs.subWorkflowId ?? '' }),
              }
            : undefined,
      }
      if (step.successCriteria?.length) {
        result.criteria = step.successCriteria.map((c) => evaluateCriterion(c, ctx))
        if (result.criteria.some((c) => !c.passed)) {
          result.status = 'failed'
          result.reason = { category: 'criterio', message: result.criteria.find((c) => !c.passed)!.detail }
        }
      }
    } else {
      result = await executeOperationStep(
        rs,
        project,
        ctx,
        opts,
        wa.requiredInputs,
        wa.dataEdges.filter((e) => e.fromStep === step.stepId).map((e) => e.output),
      )
    }

    result.attempts = (retries[step.stepId] ?? 0) + 1
    executed.add(step.stepId)
    results.push(result)

    const succeeded = result.status !== 'failed'
    const action = succeeded
      ? chooseAction(project, step.onSuccess ?? wf.successActions, ctx)
      : chooseAction(project, step.onFailure ?? wf.failureActions, ctx)
    if (action) {
      result.actionName = action.name ?? action.type ?? t('common.unnamed')
      result.actionType = action.type
      actions.push({ stepId: step.stepId, name: result.actionName, type: action.type ?? '' })
    }
    opts.onStep?.(result)

    if (action?.type === 'retry' && !succeeded) {
      const limit = action.retryLimit ?? 1
      const done = retries[step.stepId] ?? 0
      if (done < limit) {
        retries[step.stepId] = done + 1
        result.action = t('run.action.retry', { n: done + 1, limit, action: action.name ?? 'retry' })
        const wait = Math.min((action.retryAfter ?? 0) * 1000, opts.maxRetryWaitMs ?? 10000)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        continue
      }
      result.action = t('run.action.retriesExhausted', { limit })
    }

    if (action?.type === 'goto') {
      if (action.stepId) {
        const target = wa.steps.findIndex((s) => s.step.stepId === action.stepId)
        if (target >= 0) {
          result.action = t('run.action.goto', { step: action.stepId, action: action.name ?? 'goto' })
          i = target
          continue
        }
      } else if (action.workflowId && workflowById(project, action.workflowId)) {
        result.action = t('run.action.gotoWorkflow', { workflow: action.workflowId })
        const sub = await runWorkflow(project, analysis, action.workflowId, { ...opts, onStep: undefined }, depth + 1)
        result.subRun = sub
        status = sub.status
        failure = sub.reason
        break
      }
    }

    if (action?.type === 'end') {
      result.action = t('run.action.end', { action: action.name ?? 'end' })
      if (!succeeded) {
        status = 'failed'
        failure = result.reason
      }
      break
    }

    if (!succeeded) {
      status = 'failed'
      failure = result.reason
      break
    }
    i++
  }

  // Pasos que no llegaron a ejecutarse
  const failedStep = results.find((r) => r.status === 'failed')
  for (const rs of wa.steps) {
    if (executed.has(rs.step.stepId)) continue
    results.push({
      stepId: rs.step.stepId,
      label: rs.label,
      description: rs.step.description,
      status: 'skipped',
      attempts: 0,
      criteria: [],
      outputs: {},
      missingOutputs: [],
      contractIssues: [],
      unresolved: [],
      reason:
        status === 'failed'
          ? {
              category: 'dependencia',
              message: failedStep ? t('run.skipped.stepFailed', { step: failedStep.stepId }) : t('run.skipped.stopped'),
            }
          : { category: 'dependencia', message: t('run.skipped.ended') },
    })
  }

  // Outputs del workflow
  const outputs: Record<string, any> = {}
  for (const [name, expr] of Object.entries(wf.outputs ?? {})) {
    const r = evaluateExpression(expr, ctx)
    if (r.found) outputs[name] = r.value
  }

  return {
    workflowId,
    status,
    steps: results,
    outputs,
    durationMs: Math.round(performance.now() - started),
    reason: failure,
    actions,
  }
}
