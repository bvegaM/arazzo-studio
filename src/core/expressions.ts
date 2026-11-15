/* eslint-disable @typescript-eslint/no-explicit-any */
import { selectXPath } from './xpath'
import { JSONPath } from 'jsonpath-plus'
import { getByPointer } from './jsonPointer'
import type { Selector } from './types'

export interface ExchangeRequest {
  method: string
  url: string
  headers: Record<string, string>
  query: Record<string, string>
  path: Record<string, string>
  body?: any
}

export interface ExchangeResponse {
  status: number
  headers: Record<string, string>
  body: any
}

/** Mensaje de AsyncAPI enviado o recibido por el paso ($message). */
export interface ExchangeMessage {
  headers: Record<string, any>
  payload: any
}

export interface ExprContext {
  inputs: Record<string, any>
  steps: Record<string, { outputs: Record<string, any> }>
  workflows: Record<string, { outputs: Record<string, any> }>
  sourceUrls: Record<string, string>
  components?: any
  request?: ExchangeRequest
  response?: ExchangeResponse
  message?: ExchangeMessage
  /** Valor de $self (identidad del documento Arazzo). */
  self?: string
  /** Outputs de un sub-workflow, disponibles como $outputs en un paso que lo invoca. */
  outputs?: Record<string, any>
  /** Expresiones que no pudieron resolverse (para explicar errores). */
  unresolved?: string[]
}

export interface EvalResult {
  found: boolean
  value: any
}

/** Recorre ".a.b[0]" o "#/a/b/0" sobre un valor. */
function walk(value: any, rest: string): EvalResult {
  if (!rest) return { found: value !== undefined, value }
  const hash = rest.indexOf('#')
  const pathPart = hash >= 0 ? rest.slice(0, hash) : rest
  const tokens = [...pathPart.matchAll(/\.([^.[\]]+)|\[(\d+)\]|\['([^']+)'\]/g)]
  let cur = value
  for (const t of tokens) {
    const key = t[1] ?? t[2] ?? t[3]
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(key in cur)) {
      return { found: false, value: undefined }
    }
    cur = cur[key]
  }
  // Puede venir un puntero después del camino: $response.body#/a o $steps.a.outputs.b#/c
  if (hash >= 0) return getByPointer(cur, rest.slice(hash + 1))
  return { found: cur !== undefined, value: cur }
}

function headerLookup(headers: Record<string, string> | undefined, name: string): EvalResult {
  if (!headers) return { found: false, value: undefined }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? { found: true, value: headers[key] } : { found: false, value: undefined }
}

export function evaluateExpression(expr: string, ctx: ExprContext): EvalResult {
  const e = expr.trim()
  if (e === '$url') return { found: !!ctx.request, value: ctx.request?.url }
  if (e === '$method') return { found: !!ctx.request, value: ctx.request?.method.toUpperCase() }
  if (e === '$statusCode') return { found: !!ctx.response, value: ctx.response?.status }
  if (e === '$self') return { found: ctx.self !== undefined, value: ctx.self }

  let m: RegExpMatchArray | null
  if ((m = e.match(/^\$response\.header\.(.+)$/))) return headerLookup(ctx.response?.headers, m[1])
  if ((m = e.match(/^\$response\.body(.*)$/))) return ctx.response ? walk(ctx.response.body, m[1]) : { found: false, value: undefined }
  if ((m = e.match(/^\$message\.header\.(.+)$/))) return headerLookup(ctx.message?.headers, m[1])
  if ((m = e.match(/^\$message\.(?:payload|body)(.*)$/))) return ctx.message ? walk(ctx.message.payload, m[1]) : { found: false, value: undefined }
  if ((m = e.match(/^\$request\.header\.(.+)$/))) return headerLookup(ctx.request?.headers, m[1])
  if ((m = e.match(/^\$request\.query\.(.+)$/))) {
    const v = ctx.request?.query[m[1]]
    return { found: v !== undefined, value: v }
  }
  if ((m = e.match(/^\$request\.path\.(.+)$/))) {
    const v = ctx.request?.path[m[1]]
    return { found: v !== undefined, value: v }
  }
  if ((m = e.match(/^\$request\.body(.*)$/))) return ctx.request ? walk(ctx.request.body, m[1]) : { found: false, value: undefined }
  if ((m = e.match(/^\$inputs(.*)$/))) return walk(ctx.inputs, m[1])
  if ((m = e.match(/^\$outputs(.*)$/))) return walk(ctx.outputs ?? {}, m[1])
  if ((m = e.match(/^\$steps\.([^.#]+)(.*)$/))) {
    const step = ctx.steps[m[1]]
    return step ? walk(step, m[2]) : { found: false, value: undefined }
  }
  if ((m = e.match(/^\$workflows\.([^.#]+)(.*)$/))) {
    const wf = ctx.workflows[m[1]]
    return wf ? walk(wf, m[2]) : { found: false, value: undefined }
  }
  if ((m = e.match(/^\$sourceDescriptions\.([^.]+)\.url$/))) {
    const v = ctx.sourceUrls[m[1]]
    return { found: v !== undefined, value: v }
  }
  if ((m = e.match(/^\$components(.*)$/))) return walk(ctx.components ?? {}, m[1])
  return { found: false, value: undefined }
}

const FULL_EXPR = /^\$(url|method|statusCode|request|response|message|inputs|outputs|steps|workflows|sourceDescriptions|components|self)\b[^\s{}]*$/
const EMBEDDED = /\{(\$[^{}]+)\}/g

export function isRuntimeExpression(s: unknown): boolean {
  return typeof s === "string" && FULL_EXPR.test(s.trim())
}

/** Arazzo 1.1: un objeto { context, selector, type } en lugar de un valor literal. */
export function isSelector(value: unknown): value is Selector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    Object.keys(v).length === 3 &&
    typeof v.context === 'string' &&
    typeof v.selector === 'string' &&
    (typeof v.type === 'string' || (!!v.type && typeof v.type === 'object'))
  )
}

export function selectorType(type: Selector['type'] | undefined): string {
  return (typeof type === 'object' ? type.type : type) ?? ''
}

/** Aplica un Selector Object (JSON Pointer, JSONPath o XPath 1.0 sobre XML). */
export function evaluateSelector(sel: Selector, ctx: ExprContext): EvalResult {
  const base = evaluateExpression(sel.context, ctx)
  if (!base.found) return base
  let data = base.value
  if (typeof data === 'string' && /^\s*[[{]/.test(data)) {
    try {
      data = JSON.parse(data)
    } catch {
      /* se deja como texto */
    }
  }
  const type = selectorType(sel.type)
  if (type === 'xpath') {
    try {
      const r = selectXPath(base.value, sel.selector)
      return { found: r.found, value: r.value }
    } catch {
      return { found: false, value: undefined }
    }
  }
  if (type === 'jsonpointer') return getByPointer(data, sel.selector)
  if (type === 'jsonpath') {
    try {
      const out = JSONPath({ path: sel.selector, json: data, wrap: true }) as any[]
      return out.length ? { found: true, value: out[0] } : { found: false, value: undefined }
    } catch {
      return { found: false, value: undefined }
    }
  }
  return { found: false, value: undefined }
}

/** Valor de un output o parámetro: expresión, Selector Object o literal (con expresiones embebidas). */
export function evaluateValue(value: unknown, ctx: ExprContext): EvalResult {
  if (isRuntimeExpression(value)) return evaluateExpression(value as string, ctx)
  if (isSelector(value)) return evaluateSelector(value, ctx)
  return { found: true, value: interpolate(value, { ...ctx, unresolved: [] }) }
}

/** Sustituye expresiones en cualquier valor (profundo). Una expresión completa conserva su tipo. */
export function interpolate(value: any, ctx: ExprContext): any {
  if (isSelector(value)) {
    const r = evaluateSelector(value, ctx)
    if (!r.found) ctx.unresolved?.push(`${value.context} → ${value.selector}`)
    return r.value
  }
  if (typeof value === 'string') {
    if (isRuntimeExpression(value)) {
      const r = evaluateExpression(value, ctx)
      if (!r.found) ctx.unresolved?.push(value.trim())
      return r.value
    }
    if (value.includes('{$')) {
      return value.replace(EMBEDDED, (_all, expr: string) => {
        const r = evaluateExpression(expr, ctx)
        if (!r.found) {
          ctx.unresolved?.push(expr.trim())
          return ''
        }
        return typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)
      })
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, ctx))
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, ctx)
    return out
  }
  return value
}

/** Referencias que un objeto usa: $steps.X.outputs.Y y $inputs.Z */
export function collectReferences(value: unknown): { steps: { stepId: string; output: string }[]; inputs: string[] } {
  const text = JSON.stringify(value ?? null)
  const steps = [...text.matchAll(/\$steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g)].map((m) => ({
    stepId: m[1],
    output: m[2],
  }))
  const inputs = [...text.matchAll(/\$inputs\.([A-Za-z0-9_-]+)/g)].map((m) => m[1])
  return { steps, inputs: [...new Set(inputs)] }
}
