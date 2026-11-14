/* eslint-disable @typescript-eslint/no-explicit-any */
// Simulador: responde cada paso con los ejemplos del contrato, sin llamar a la API real.
// Sirve para probar la lógica del Arazzo (criterios y acciones) en escenarios que la API
// real no permite provocar a voluntad (403, 422, 500, 504…).
import type { Project } from './loader'
import type { Step } from './types'
import { requirementsFromCriteria, type BodyValue } from './criteria'
import { getByPointer, setByPointer } from './jsonPointer'
import { deref, listOperations, type OperationRef } from './openapi'
import type { HttpExecutor, HttpResponse, MessageExecutor, MessageResult } from './http'

export interface Scenario {
  stepId: string
  status: number
  /** Valores del body que exige la acción (de condiciones $response.body#/x == 'y'). */
  bodyValues: BodyValue[]
  /** AsyncAPI receive: no llega ningún mensaje antes del timeout. */
  timeout?: boolean
}

/** Genera un valor de ejemplo a partir de un schema (usa example/default/enum cuando existen). */
export function exampleFromSchema(schema: any, depth = 0): any {
  if (!schema || depth > 8) return undefined
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: any) => exampleFromSchema(s, depth + 1)))
  if (schema.oneOf || schema.anyOf) return exampleFromSchema((schema.oneOf ?? schema.anyOf)[0], depth + 1)
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'object' || schema.properties) {
    const out: any = {}
    for (const [k, v] of Object.entries<any>(schema.properties ?? {})) {
      const ex = exampleFromSchema(v, depth + 1)
      if (ex !== undefined) out[k] = ex
    }
    return out
  }
  if (type === 'array') {
    const item = exampleFromSchema(schema.items, depth + 1)
    return item === undefined ? [] : [item]
  }
  if (type === 'integer' || type === 'number') return schema.minimum ?? 1
  if (type === 'boolean') return true
  if (type === 'string') {
    if (schema.format === 'date-time') return '2026-01-01T00:00:00Z'
    if (schema.format === 'date') return '2026-01-01'
    if (schema.format === 'email') return 'demo@example.com'
    return 'ejemplo'
  }
  return undefined
}

function responseFor(op: OperationRef, status: number): any | undefined {
  const responses = op.operation?.responses ?? {}
  const key = [String(status), `${String(status)[0]}XX`, 'default'].find((k) => responses[k])
  return key ? deref(op.doc, responses[key]) : undefined
}

/** Cuerpo de ejemplo para un status: prefiere un ejemplo del contrato que ya cumpla los valores pedidos. */
export function exampleBody(op: OperationRef, status: number, bodyValues: BodyValue[]): any {
  let response = responseFor(op, status)
  // Status de éxito no documentado (p. ej. el Arazzo espera 201 y el contrato dice 200): se usa el 2xx documentado.
  if (!response && status >= 200 && status < 300) {
    const any2xx = Object.keys(op.operation?.responses ?? {}).find((k) => /^2\d\d$/.test(k))
    if (any2xx) response = responseFor(op, Number(any2xx))
  }
  const content = response?.content ?? {}
  const mediaKey = Object.keys(content).find((k) => /json/i.test(k)) ?? Object.keys(content)[0]
  const media = mediaKey ? content[mediaKey] : undefined
  const candidates: any[] = []
  if (media?.example !== undefined) candidates.push(media.example)
  for (const ex of Object.values<any>(media?.examples ?? {})) if (ex?.value !== undefined) candidates.push(ex.value)
  const matches = (body: any) => bodyValues.every((bv) => getByPointer(body, bv.pointer).value === bv.value)
  let body = candidates.find(matches) ?? candidates[0]
  if (body === undefined && media?.schema) body = exampleFromSchema(deref(op.doc, media.schema))
  body = structuredClone(body ?? {})
  for (const bv of bodyValues) body = setByPointer(body, bv.pointer, bv.value)
  return body
}

/** Status y body con los que el paso se considera exitoso. */
function successResponse(op: OperationRef, step: Step | undefined): { status: number; body: any } {
  const req = requirementsFromCriteria(step?.successCriteria)
  const documented2xx = Object.keys(op.operation?.responses ?? {})
    .filter((k) => /^2\d\d$/.test(k))
    .map(Number)
    .sort()
  const status = req.statuses[0] ?? documented2xx[0] ?? 200
  return { status, body: exampleBody(op, status, req.bodyValues) }
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
}

/**
 * Executor simulado. Cada paso responde como exitoso, salvo el paso del escenario:
 * la primera vez que se ejecuta devuelve la respuesta del escenario (después, éxito,
 * para que se vea cómo continúa el flujo tras un goto o retry).
 */
export function createSimulatedExecutor(project: Project, steps: Step[], scenario?: Scenario): HttpExecutor {
  let scenarioServed = false
  return async (_req, _signal, meta): Promise<HttpResponse> => {
    const source = project.sources.find((s) => s.name === meta?.sourceName)
    const op = source ? listOperations(source).find((o) => o.method === meta?.method && o.path === meta?.path) : undefined
    let status = 200
    let body: any = {}
    if (op) {
      if (scenario && meta?.stepId === scenario.stepId && !scenarioServed) {
        scenarioServed = true
        status = scenario.status
        body = exampleBody(op, status, scenario.bodyValues)
      } else {
        ;({ status, body } = successResponse(op, steps.find((s) => s.stepId === meta?.stepId)))
      }
    }
    return {
      status,
      statusText: STATUS_TEXT[status] ?? '',
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify(body),
      durationMs: 0,
      simulated: true,
    }
  }
}

/** Un mensaje de ejemplo de la operación AsyncAPI que cumpla los valores pedidos. */
export function exampleMessage(op: OperationRef, bodyValues: BodyValue[]): { headers: Record<string, any>; payload: any } {
  const messages = op.messages ?? []
  const candidates = messages.flatMap((m) => m.examples.map((ex) => ({ m, ex })))
  const matches = (payload: any) => bodyValues.every((bv) => getByPointer(payload, bv.pointer).value === bv.value)
  const picked = candidates.find((c) => matches(c.ex.payload)) ?? candidates[0]
  const message = picked?.m ?? messages[0]
  let payload = picked?.ex.payload ?? (message?.payload ? exampleFromSchema(message.payload) : undefined)
  let headers = picked?.ex.headers ?? (message?.headers ? exampleFromSchema(message.headers) : undefined)
  payload = structuredClone(payload ?? {})
  headers = structuredClone(headers && typeof headers === 'object' ? headers : {})
  for (const bv of bodyValues) payload = setByPointer(payload, bv.pointer, bv.value)
  return { headers, payload }
}

/** Escribe el identificador de correlación donde lo declara el AsyncAPI ('$message.header#/id'). */
function applyCorrelation(op: OperationRef, message: { headers: Record<string, any>; payload: any }, value: unknown) {
  if (value === undefined || value === null || value === '') return
  const location = op.messages?.find((m) => m.correlationLocation)?.correlationLocation
  const m = location?.match(/^\$message\.(header|payload)#(\/.*)$/)
  if (!m) return
  if (m[1] === 'header') message.headers = setByPointer(message.headers, m[2], value)
  else message.payload = setByPointer(message.payload, m[2], value)
}

/**
 * Mensajería simulada. send siempre se envía; receive recibe un mensaje de ejemplo que cumple
 * los criterios de éxito del paso (con el identificador de correlación esperado), salvo el paso
 * del escenario, que la primera vez recibe el mensaje del escenario o ninguno (timeout).
 */
export function createSimulatedMessenger(steps: Step[], scenario?: Scenario): MessageExecutor {
  let scenarioServed = false
  return async (msg, _signal, meta): Promise<MessageResult> => {
    if (msg.action === 'send') {
      return { status: 'sent', message: { headers: msg.headers, payload: msg.payload }, durationMs: 0, simulated: true }
    }
    const op = meta?.op
    let bodyValues = requirementsFromCriteria(steps.find((s) => s.stepId === meta?.stepId)?.successCriteria).bodyValues
    if (scenario && meta?.stepId === scenario.stepId && !scenarioServed) {
      scenarioServed = true
      if (scenario.timeout) return { status: 'timeout', durationMs: msg.timeoutMs ?? 0, simulated: true }
      bodyValues = scenario.bodyValues
    }
    const message = op ? exampleMessage(op, bodyValues) : { headers: {}, payload: {} }
    if (op) applyCorrelation(op, message, msg.correlationId)
    return { status: 'received', message, durationMs: 0, simulated: true }
  }
}
