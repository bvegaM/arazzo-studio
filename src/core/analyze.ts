/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Project } from './loader'
import type { ArazzoParameter, Criterion, JsonSchema, Step, Workflow } from './types'
import {
  MUTATING_METHODS,
  deref,
  findByLooseOperationId,
  findByOperationId,
  findByOperationPath,
  findByPathSuffix,
  getServerUrl,
  operationParameters,
  operationRequestBody,
  operationSecurity,
  type OperationRef,
  type SecurityScheme,
} from './openapi'
import { collectReferences } from './expressions'
import { statusesInCriteria } from './criteria'
import { t } from '../i18n'

export type IssueLevel = 'error' | 'warning' | 'info'

export interface Issue {
  level: IssueLevel
  message: string
  workflowId?: string
  stepId?: string
}

export interface ResolvedStep {
  step: Step
  kind: 'operation' | 'workflow' | 'unresolved'
  op?: OperationRef
  subWorkflowId?: string
  mutating: boolean
  label: string
  security: SecurityScheme[]
  /** Parámetros efectivos (con referencias de components resueltas). */
  parameters: ArazzoParameter[]
}

export interface DataEdge {
  fromStep: string
  toStep: string
  output: string
}

export interface CoverageRow {
  status: string
  description?: string
  /** Quién maneja esta respuesta en el Arazzo. */
  handledBy: string[]
  kind: 'exito' | 'accion' | 'sin-manejo'
}

export interface StepCoverage {
  stepId: string
  label: string
  rows: CoverageRow[]
}

export interface WorkflowAnalysis {
  coverage: StepCoverage[]
  workflow: Workflow
  steps: ResolvedStep[]
  dataEdges: DataEdge[]
  inputsSchema: JsonSchema
  requiredInputs: string[]
  credentials: SecurityScheme[]
  sources: { name: string; defaultServer: string }[]
  issues: Issue[]
}

export interface ProjectAnalysis {
  workflows: WorkflowAnalysis[]
  issues: Issue[]
  credentials: SecurityScheme[]
}

export function resolveParameters(project: Project, params: ArazzoParameter[] | undefined): ArazzoParameter[] {
  return (params ?? []).map((p) => {
    if (p.reference) {
      const m = p.reference.match(/^\$components\.parameters\.(.+)$/)
      const base = m ? project.arazzo.components?.parameters?.[m[1]] : undefined
      if (base) return { ...base, ...(p.value !== undefined ? { value: p.value } : {}) }
    }
    return p
  })
}

function resolveInputsSchema(project: Project, wf: Workflow): JsonSchema {
  if (!wf.inputs) return { type: 'object', properties: {} }
  const resolved = deref(project.arazzo, wf.inputs)
  return resolved ?? { type: 'object', properties: {} }
}

export function analyzeProject(project: Project): ProjectAnalysis {
  const issues: Issue[] = []
  const a = project.arazzo

  if (!/^1\./.test(String(a.arazzo))) {
    issues.push({ level: 'warning', message: t('an.version', { version: String(a.arazzo) }) })
  }
  if (!a.info?.title) issues.push({ level: 'warning', message: t('an.noTitle') })
  if (!a.sourceDescriptions?.length) issues.push({ level: 'error', message: t('an.noSources') })
  for (const s of project.sources) {
    if (s.type !== 'openapi') {
      issues.push({ level: 'warning', message: t('an.sourceType', { name: s.name, type: s.type }) })
    } else if (s.status !== 'loaded') {
      issues.push({ level: 'error', message: t('an.sourceMissing', { name: s.name, url: s.url }) })
    }
  }
  if (!a.workflows?.length) issues.push({ level: 'error', message: t('an.noWorkflows') })

  const wfIds = new Set<string>()
  for (const wf of a.workflows ?? []) {
    if (wfIds.has(wf.workflowId)) issues.push({ level: 'error', message: t('an.dupWorkflow', { id: wf.workflowId }) })
    wfIds.add(wf.workflowId)
  }

  const workflows = (a.workflows ?? []).map((wf) => analyzeWorkflow(project, wf, wfIds))
  const credentials = new Map<string, SecurityScheme>()
  for (const w of workflows) for (const c of w.credentials) credentials.set(c.key, c)

  return { workflows, issues, credentials: [...credentials.values()] }
}

function analyzeWorkflow(project: Project, wf: Workflow, wfIds: Set<string>): WorkflowAnalysis {
  const issues: Issue[] = []
  const add = (level: IssueLevel, message: string, stepId?: string) =>
    issues.push({ level, message, workflowId: wf.workflowId, stepId })

  const inputsSchema = resolveInputsSchema(project, wf)
  const inputProps = Object.keys(inputsSchema.properties ?? {})
  const requiredInputs: string[] = inputsSchema.required ?? []

  const stepIds = new Set<string>()
  const steps: ResolvedStep[] = []
  const dataEdges: DataEdge[] = []
  const credentials = new Map<string, SecurityScheme>()
  const sources = new Map<string, string>()

  ;(wf.steps ?? []).forEach((step, index) => {
    if (stepIds.has(step.stepId)) add('error', t('an.dupStep', { id: step.stepId }), step.stepId)
    const kinds = [step.operationId, step.operationPath, step.workflowId].filter(Boolean).length
    if (kinds !== 1) {
      add('error', t('an.stepKind'), step.stepId)
    }

    const parameters = resolveParameters(project, [...(wf.parameters ?? []), ...(step.parameters ?? [])])
    let resolved: ResolvedStep = {
      step,
      kind: 'unresolved',
      mutating: false,
      label: step.operationId ?? step.operationPath ?? step.workflowId ?? t('an.noOperation'),
      security: [],
      parameters,
    }

    if (step.operationId) {
      let matches = findByOperationId(project, step.operationId)
      if (matches.length === 0) {
        matches = findByLooseOperationId(project, step.operationId)
        if (matches.length) {
          const src = matches[0].sourceName
          const opName = step.operationId.slice(src.length + 1)
          add(
            'warning',
            t('an.looseOpId', { id: step.operationId, op: `${matches[0].method.toUpperCase()} ${matches[0].path}`, fixed: `$sourceDescriptions.${src}.${opName}` }),
            step.stepId,
          )
        }
      }
      if (matches.length === 0) add('error', t('an.opMissing', { id: step.operationId }), step.stepId)
      else {
        if (matches.length > 1) {
          add('warning', t('an.opAmbiguous', { id: step.operationId, source: matches[0].sourceName }), step.stepId)
        }
        resolved = withOperation(resolved, matches[0])
      }
    } else if (step.operationPath) {
      const op = findByOperationPath(project, step.operationPath)
      if (op) resolved = withOperation(resolved, op)
      else {
        const suggestion = findByPathSuffix(project, step.operationPath)
        if (suggestion) {
          add(
            'warning',
            t('an.pathSuffix', { op: `${suggestion.method.toUpperCase()} ${suggestion.path}`, path: suggestion.path }),
            step.stepId,
          )
          resolved = withOperation(resolved, suggestion)
        } else add('error', t('an.pathMissing', { path: step.operationPath }), step.stepId)
      }
    } else if (step.workflowId) {
      if (!wfIds.has(step.workflowId)) add('error', t('an.subMissing', { id: step.workflowId }), step.stepId)
      else resolved = { ...resolved, kind: 'workflow', subWorkflowId: step.workflowId, label: `workflow: ${step.workflowId}` }
    }

    if (resolved.op) {
      const documented = Object.keys(resolved.op.operation?.responses ?? {})
      const expected = statusesInCriteria(step.successCriteria)
      const undocumented = expected.filter((c) => !documented.includes(String(c)) && !documented.includes(`${String(c)[0]}XX`))
      if (undocumented.length && expected.length) {
        add(
          'warning',
          t('an.undocumented', { expected: undocumented.join(', '), op: resolved.label, documented: documented.join(', ') || t('an.noResponses') }),
          step.stepId,
        )
      }
      sources.set(resolved.op.sourceName, getServerUrl(project.sources.find((s) => s.name === resolved.op!.sourceName)))
      for (const c of resolved.security) credentials.set(c.key, c)
      checkOperationCoverage(resolved, add)
    }

    // Referencias a otros pasos e inputs
    const refs = collectReferences({ ...step, parameters })
    for (const r of refs.steps) {
      const targetIndex = (wf.steps ?? []).findIndex((s) => s.stepId === r.stepId)
      if (targetIndex < 0) add('error', t('an.refStepMissing', { step: r.stepId, output: r.output }), step.stepId)
      else if (targetIndex >= index) add('warning', t('an.refLater', { step: r.stepId }), step.stepId)
      else {
        const producer = wf.steps[targetIndex]
        if (!producer.outputs || !(r.output in producer.outputs)) {
          add('error', t('an.refOutputMissing', { step: r.stepId, output: r.output }), step.stepId)
        }
        if (!dataEdges.some((e) => e.fromStep === r.stepId && e.toStep === step.stepId && e.output === r.output)) {
          dataEdges.push({ fromStep: r.stepId, toStep: step.stepId, output: r.output })
        }
      }
    }
    for (const input of refs.inputs) {
      if (!inputProps.includes(input)) add('warning', t('an.refInputMissing', { input }), step.stepId)
    }
    const mislabeled = [
      ...checkCriteria(step.successCriteria, 'successCriteria', (l, m) => add(l, m, step.stepId)),
      ...[...(step.onSuccess ?? []), ...(step.onFailure ?? [])].flatMap((action) =>
        checkCriteria(action.criteria, t('an.actionCriteria', { action: action.name ?? action.type ?? '' }), (l, m) => add(l, m, step.stepId)),
      ),
    ]
    if (mislabeled.length) {
      add(
        'warning',
        t('an.mislabeled', { n: mislabeled.length, example: mislabeled[0] }),
        step.stepId,
      )
    }
    if (!step.successCriteria?.length) {
      add('info', t('an.noCriteria'), step.stepId)
    }
    for (const action of [...(step.onSuccess ?? []), ...(step.onFailure ?? [])]) {
      if (action.type !== 'retry' && (action.retryLimit !== undefined || action.retryAfter !== undefined)) {
        add(
          'warning',
          t('an.retryFields', { action: action.name ?? action.type ?? '', type: action.type ?? '' }),
          step.stepId,
        )
      }
      if (action.type === 'goto' && action.stepId && !(wf.steps ?? []).some((s) => s.stepId === action.stepId)) {
        add('error', t('an.gotoMissing', { action: action.name ?? 'goto', step: action.stepId }), step.stepId)
      }
    }

    stepIds.add(step.stepId)
    steps.push(resolved)
  })

  return {
    workflow: wf,
    coverage: steps.filter((s) => s.op).map((s) => stepCoverage(s, wf)),
    steps,
    dataEdges,
    inputsSchema,
    requiredInputs,
    credentials: [...credentials.values()],
    sources: [...sources.entries()].map(([name, defaultServer]) => ({ name, defaultServer })),
    issues,
  }
}

function withOperation(r: ResolvedStep, op: OperationRef): ResolvedStep {
  return {
    ...r,
    kind: 'operation',
    op,
    mutating: MUTATING_METHODS.has(op.method),
    label: `${op.method.toUpperCase()} ${op.path}`,
    security: operationSecurity(op),
  }
}

function checkOperationCoverage(r: ResolvedStep, add: (l: IssueLevel, m: string, s?: string) => void) {
  const op = r.op!
  const authHeaders = new Set(
    r.security.filter((s) => s.in === 'header' && s.paramName).map((s) => s.paramName!.toLowerCase()),
  )
  for (const p of operationParameters(op)) {
    const required = p.in === 'path' || p.required === true
    if (!required) continue
    if (p.in === 'header' && (String(p.name).toLowerCase() === 'authorization' || authHeaders.has(String(p.name).toLowerCase()))) continue
    const provided = r.parameters.some(
      (sp) => String(sp.name).toLowerCase() === String(p.name).toLowerCase() && (!sp.in || sp.in === p.in),
    )
    if (!provided) add('warning', t('an.paramMissing', { in: p.in, name: p.name }), r.step.stepId)
  }
  const body = operationRequestBody(op)
  if (body?.required && !r.step.requestBody) add('warning', t('an.bodyMissing'), r.step.stepId)
  if (r.parameters.some((p) => p.in === 'cookie')) {
    add('warning', t('an.cookies'), r.step.stepId)
  }
}

const RUNTIME_COMPARISON = /^\s*\$(statusCode|response|request|inputs|steps|url|method)\b.*(==|!=|<=|>=|<|>)/

/** Valida criterios; devuelve las condiciones simples marcadas por error como jsonpath. */
function checkCriteria(criteria: Criterion[] | undefined, where: string, add: (l: IssueLevel, m: string) => void): string[] {
  if (!criteria?.length) return []
  // Todos los criterios deben cumplirse a la vez (AND): dos $statusCode == distintos nunca se cumplen.
  const codes = [...new Set(
    criteria
      .map((c) => c.condition.match(/^\s*\$statusCode\s*==\s*(\d{3})\s*$/)?.[1])
      .filter((x): x is string => !!x),
  )]
  if (codes.length > 1) {
    add(
      'error',
      t('an.statusAnd', { where, n: codes.length, codes: codes.join(', '), fixed: codes.map((c) => `$statusCode == ${c}`).join(' || ') }),
    )
  }
  return criteria
    .filter((c) => (typeof c.type === 'object' ? c.type.type : c.type) === 'jsonpath' && RUNTIME_COMPARISON.test(c.condition))
    .map((c) => c.condition)
}

/** Respuestas documentadas en el contrato frente a cómo las maneja el Arazzo. */
function stepCoverage(rs: ResolvedStep, wf: Workflow): StepCoverage {
  const responses = rs.op!.operation?.responses ?? {}
  const successStatuses = statusesInCriteria(rs.step.successCriteria)
  const failureActions = rs.step.onFailure ?? wf.failureActions ?? []
  const successActions = rs.step.onSuccess ?? wf.successActions ?? []
  const rows: CoverageRow[] = Object.keys(responses)
    .filter((k) => k !== 'default')
    .map((code) => {
      const n = Number(code)
      const isSuccess = successStatuses.length ? successStatuses.includes(n) : /^2/.test(code)
      const actions = (isSuccess ? successActions : failureActions)
        .filter((a) => statusesInCriteria(a.criteria).includes(n))
        .map((a) => a.name ?? a.type ?? t('common.unnamed'))
      const catchAll = (isSuccess ? successActions : failureActions).filter((a) => !a.criteria?.length).map((a) => t('an.noCriteriaAction', { action: a.name ?? a.type ?? '' }))
      const handledBy = isSuccess ? ['successCriteria', ...actions] : actions.length ? actions : catchAll
      return {
        status: code,
        description: responses[code]?.description,
        handledBy,
        kind: isSuccess ? 'exito' : handledBy.length ? 'accion' : 'sin-manejo',
      } as CoverageRow
    })
  return { stepId: rs.step.stepId, label: rs.label, rows }
}
