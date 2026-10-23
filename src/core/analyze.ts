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
import { statusesInCriteria } from './simulator'

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
    issues.push({ level: 'warning', message: `Versión de Arazzo "${a.arazzo}" no reconocida; se espera 1.x.` })
  }
  if (!a.info?.title) issues.push({ level: 'warning', message: 'Falta info.title en el documento Arazzo.' })
  if (!a.sourceDescriptions?.length) issues.push({ level: 'error', message: 'El Arazzo no declara sourceDescriptions.' })
  for (const s of project.sources) {
    if (s.type !== 'openapi') {
      issues.push({ level: 'warning', message: `La fuente "${s.name}" es de tipo "${s.type}"; solo se ejecutan contratos OpenAPI.` })
    } else if (s.status !== 'loaded') {
      issues.push({ level: 'error', message: `Falta el contrato de la fuente "${s.name}" (${s.url}).` })
    }
  }
  if (!a.workflows?.length) issues.push({ level: 'error', message: 'El Arazzo no tiene workflows.' })

  const wfIds = new Set<string>()
  for (const wf of a.workflows ?? []) {
    if (wfIds.has(wf.workflowId)) issues.push({ level: 'error', message: `workflowId duplicado: "${wf.workflowId}".` })
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
    if (stepIds.has(step.stepId)) add('error', `stepId duplicado: "${step.stepId}".`, step.stepId)
    const kinds = [step.operationId, step.operationPath, step.workflowId].filter(Boolean).length
    if (kinds !== 1) {
      add('error', 'Cada paso debe tener exactamente uno de: operationId, operationPath o workflowId.', step.stepId)
    }

    const parameters = resolveParameters(project, [...(wf.parameters ?? []), ...(step.parameters ?? [])])
    let resolved: ResolvedStep = {
      step,
      kind: 'unresolved',
      mutating: false,
      label: step.operationId ?? step.operationPath ?? step.workflowId ?? '(sin operación)',
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
            `"${step.operationId}" no es la forma estándar de Arazzo. Se resolvió como ${matches[0].method.toUpperCase()} ${matches[0].path}; corrígelo a "$sourceDescriptions.${src}.${opName}".`,
            step.stepId,
          )
        }
      }
      if (matches.length === 0) add('error', `La operación "${step.operationId}" no existe en los contratos cargados.`, step.stepId)
      else {
        if (matches.length > 1) {
          add('warning', `"${step.operationId}" existe en varias fuentes; se usa "${matches[0].sourceName}". Usa la forma $sourceDescriptions.<fuente>.<operationId>.`, step.stepId)
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
            `El operationPath apunta a una ruta que no existe en el contrato; se resolvió como ${suggestion.method.toUpperCase()} ${suggestion.path}. Probablemente incluye el prefijo del servidor: corrige la ruta del puntero a "${suggestion.path}".`,
            step.stepId,
          )
          resolved = withOperation(resolved, suggestion)
        } else add('error', `No se encontró la operación de operationPath "${step.operationPath}".`, step.stepId)
      }
    } else if (step.workflowId) {
      if (!wfIds.has(step.workflowId)) add('error', `El sub-workflow "${step.workflowId}" no existe.`, step.stepId)
      else resolved = { ...resolved, kind: 'workflow', subWorkflowId: step.workflowId, label: `workflow: ${step.workflowId}` }
    }

    if (resolved.op) {
      const documented = Object.keys(resolved.op.operation?.responses ?? {})
      const expected = statusesInCriteria(step.successCriteria)
      const undocumented = expected.filter((c) => !documented.includes(String(c)) && !documented.includes(`${String(c)[0]}XX`))
      if (undocumented.length && expected.length) {
        add(
          'warning',
          `Los successCriteria esperan ${undocumented.join(', ')}, pero el contrato de ${resolved.label} solo documenta ${documented.join(', ') || 'ninguna respuesta'}. Alinea el Arazzo o el contrato.`,
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
      if (targetIndex < 0) add('error', `Usa $steps.${r.stepId}.outputs.${r.output}, pero el paso "${r.stepId}" no existe.`, step.stepId)
      else if (targetIndex >= index) add('warning', `Usa un output de "${r.stepId}", que se ejecuta después.`, step.stepId)
      else {
        const producer = wf.steps[targetIndex]
        if (!producer.outputs || !(r.output in producer.outputs)) {
          add('error', `Usa $steps.${r.stepId}.outputs.${r.output}, pero "${r.stepId}" no declara ese output.`, step.stepId)
        }
        if (!dataEdges.some((e) => e.fromStep === r.stepId && e.toStep === step.stepId && e.output === r.output)) {
          dataEdges.push({ fromStep: r.stepId, toStep: step.stepId, output: r.output })
        }
      }
    }
    for (const input of refs.inputs) {
      if (!inputProps.includes(input)) add('warning', `Usa $inputs.${input}, que no está definido en inputs del workflow.`, step.stepId)
    }
    const mislabeled = [
      ...checkCriteria(step.successCriteria, 'successCriteria', (l, m) => add(l, m, step.stepId)),
      ...[...(step.onSuccess ?? []), ...(step.onFailure ?? [])].flatMap((action) =>
        checkCriteria(action.criteria, `los criterios de la acción "${action.name ?? action.type}"`, (l, m) => add(l, m, step.stepId)),
      ),
    ]
    if (mislabeled.length) {
      add(
        'warning',
        `${mislabeled.length} condición(es) están marcadas como "type: jsonpath" pero son condiciones simples (por ejemplo "${mislabeled[0]}"). Se evaluarán como simples; quita "type: jsonpath" y "context" en ellas.`,
        step.stepId,
      )
    }
    if (!step.successCriteria?.length) {
      add('info', 'Sin successCriteria: se considerará exitoso cualquier respuesta 2xx.', step.stepId)
    }
    for (const action of [...(step.onSuccess ?? []), ...(step.onFailure ?? [])]) {
      if (action.type !== 'retry' && (action.retryLimit !== undefined || action.retryAfter !== undefined)) {
        add(
          'warning',
          `La acción "${action.name ?? action.type}" es de tipo ${action.type} y define retryLimit/retryAfter, que solo aplican a type: retry. Con ${action.type} no hay límite de repeticiones.`,
          step.stepId,
        )
      }
      if (action.type === 'goto' && action.stepId && !(wf.steps ?? []).some((s) => s.stepId === action.stepId)) {
        add('error', `La acción "${action.name ?? 'goto'}" apunta al paso inexistente "${action.stepId}".`, step.stepId)
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
    if (!provided) add('warning', `El contrato exige el parámetro ${p.in} "${p.name}" y el paso no lo envía.`, r.step.stepId)
  }
  const body = operationRequestBody(op)
  if (body?.required && !r.step.requestBody) add('warning', 'El contrato exige un body y el paso no define requestBody.', r.step.stepId)
  if (r.parameters.some((p) => p.in === 'cookie')) {
    add('warning', 'El navegador no permite enviar cookies manualmente; los parámetros cookie se omitirán.', r.step.stepId)
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
      `En ${where} hay ${codes.length} condiciones $statusCode == (${codes.join(', ')}). Arazzo exige que se cumplan todas a la vez, así que nunca se cumplirán. Únelas en una sola: "${codes.map((c) => `$statusCode == ${c}`).join(' || ')}".`,
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
        .map((a) => a.name ?? a.type ?? '(sin nombre)')
      const catchAll = (isSuccess ? successActions : failureActions).filter((a) => !a.criteria?.length).map((a) => `${a.name ?? a.type} (sin criterios)`)
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
