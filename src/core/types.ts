/* eslint-disable @typescript-eslint/no-explicit-any */
// Tipos mínimos de la especificación Arazzo (1.0.x y 1.1.x) que usa el estudio.

export type JsonSchema = Record<string, any>

export interface SourceDescription {
  name: string
  url: string
  type?: 'openapi' | 'asyncapi' | 'arazzo'
}

export interface ArazzoParameter {
  name: string
  in?: 'path' | 'query' | 'querystring' | 'header' | 'cookie'
  value?: unknown
  reference?: string
}

/** Arazzo 1.1: tipo de expresión con versión (jsonpath, xpath, jsonpointer). */
export interface ExpressionType {
  type: string
  version?: string
}

/** Arazzo 1.1: extrae un valor de datos estructurados con JSONPath, XPath o JSON Pointer. */
export interface Selector {
  context: string
  selector: string
  type: string | ExpressionType
}

export interface Criterion {
  context?: string
  condition: string
  type?: string | ExpressionType
}

export interface Action {
  name?: string
  type?: 'end' | 'goto' | 'retry'
  workflowId?: string
  stepId?: string
  retryAfter?: number
  retryLimit?: number
  criteria?: Criterion[]
  /** Arazzo 1.1: inputs del workflow al que se salta (workflowId). */
  parameters?: ArazzoParameter[]
  reference?: string
}

export interface RequestBody {
  contentType?: string
  payload?: unknown
  replacements?: { target: string; targetSelectorType?: string | ExpressionType; value: unknown }[]
}

export interface Step {
  stepId: string
  description?: string
  operationId?: string
  operationPath?: string
  /** Arazzo 1.1: canal de un AsyncAPI ('{$sourceDescriptions.x.url}#/channels/y'). */
  channelPath?: string
  workflowId?: string
  /** Arazzo 1.1, solo AsyncAPI: enviar o esperar un mensaje. */
  action?: 'send' | 'receive'
  /** Arazzo 1.1, solo AsyncAPI receive: identificador que debe traer el mensaje esperado. */
  correlationId?: string
  /** Arazzo 1.1: milisegundos máximos que puede tardar el paso. */
  timeout?: number
  /** Arazzo 1.1: pasos que deben haber terminado antes de este. */
  dependsOn?: string[]
  parameters?: ArazzoParameter[]
  requestBody?: RequestBody
  successCriteria?: Criterion[]
  onSuccess?: Action[]
  onFailure?: Action[]
  outputs?: Record<string, string | Selector>
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
  outputs?: Record<string, string | Selector>
  parameters?: ArazzoParameter[]
}

export interface ArazzoDoc {
  arazzo: string
  $self?: string
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
