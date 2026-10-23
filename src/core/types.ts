/* eslint-disable @typescript-eslint/no-explicit-any */
// Tipos mínimos de la especificación Arazzo 1.0.x que usa el estudio.

export type JsonSchema = Record<string, any>

export interface SourceDescription {
  name: string
  url: string
  type?: 'openapi' | 'arazzo'
}

export interface ArazzoParameter {
  name: string
  in?: 'path' | 'query' | 'header' | 'cookie'
  value?: unknown
  reference?: string
}

export interface Criterion {
  context?: string
  condition: string
  type?: string | { type: string; version?: string }
}

export interface Action {
  name?: string
  type?: 'end' | 'goto' | 'retry'
  workflowId?: string
  stepId?: string
  retryAfter?: number
  retryLimit?: number
  criteria?: Criterion[]
  reference?: string
}

export interface RequestBody {
  contentType?: string
  payload?: unknown
  replacements?: { target: string; value: unknown }[]
}

export interface Step {
  stepId: string
  description?: string
  operationId?: string
  operationPath?: string
  workflowId?: string
  parameters?: ArazzoParameter[]
  requestBody?: RequestBody
  successCriteria?: Criterion[]
  onSuccess?: Action[]
  onFailure?: Action[]
  outputs?: Record<string, string>
}

export interface Workflow {
  workflowId: string
  summary?: string
  description?: string
  inputs?: JsonSchema
  dependsOn?: string[]
  steps: Step[]
  successActions?: Action[]
  failureActions?: Action[]
  outputs?: Record<string, string>
  parameters?: ArazzoParameter[]
}

export interface ArazzoDoc {
  arazzo: string
  info: { title: string; version: string; summary?: string; description?: string }
  sourceDescriptions: SourceDescription[]
  workflows: Workflow[]
  components?: {
    inputs?: Record<string, JsonSchema>
    parameters?: Record<string, ArazzoParameter>
    successActions?: Record<string, Action>
    failureActions?: Record<string, Action>
  }
}
