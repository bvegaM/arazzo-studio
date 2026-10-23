/* eslint-disable @typescript-eslint/no-explicit-any */
import { JSONPath } from 'jsonpath-plus'
import type { Criterion } from './types'
import { evaluateExpression, type ExprContext } from './expressions'

export interface Comparison {
  left: string
  leftValue: any
  op: string
  right: string
  rightValue: any
  passed: boolean
}

export interface CriterionResult {
  condition: string
  type: string
  context?: string
  passed: boolean
  /** Explicación legible: valor esperado contra valor obtenido. */
  detail: string
}

// ---------- Condiciones simples ----------

type Token =
  | { t: 'op'; v: string }
  | { t: 'paren'; v: '(' | ')' }
  | { t: 'lit'; v: any; raw: string }
  | { t: 'expr'; v: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if (['<', '>', '!'].includes(c)) {
      tokens.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '(' || c === ')') {
      tokens.push({ t: 'paren', v: c })
      i++
      continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1]
          j += 2
        } else s += src[j++]
      }
      tokens.push({ t: 'lit', v: s, raw: src.slice(i, j + 1) })
      i = j + 1
      continue
    }
    if (c === '$') {
      let j = i
      let depth = 0
      while (j < src.length) {
        const ch = src[j]
        if (ch === '[') depth++
        if (ch === ']') depth--
        if (depth === 0 && (/\s/.test(ch) || '()=!<>&|'.includes(ch))) break
        j++
      }
      tokens.push({ t: 'expr', v: src.slice(i, j) })
      i = j
      continue
    }
    // literal sin comillas: número, true, false, null o palabra
    let j = i
    while (j < src.length && !/\s/.test(src[j]) && !'()=!<>&|'.includes(src[j])) j++
    const raw = src.slice(i, j)
    let v: any = raw
    if (raw === 'true') v = true
    else if (raw === 'false') v = false
    else if (raw === 'null') v = null
    else if (raw !== '' && !isNaN(Number(raw))) v = Number(raw)
    tokens.push({ t: 'lit', v, raw })
    i = j || i + 1
  }
  return tokens
}

function normalize(a: any, b: any): [any, any] {
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b))) return [a, Number(b)]
  if (typeof b === 'number' && typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a))) return [Number(a), b]
  // Arazzo: las comparaciones de strings no distinguen mayúsculas/minúsculas.
  if (typeof a === 'string' && typeof b === 'string') return [a.toLowerCase(), b.toLowerCase()]
  return [a, b]
}

function compare(op: string, a: any, b: any): boolean {
  const [x, y] = normalize(a, b)
  switch (op) {
    case '==':
      return x === y || (typeof x === 'object' && JSON.stringify(x) === JSON.stringify(y))
    case '!=':
      return !(x === y || (typeof x === 'object' && JSON.stringify(x) === JSON.stringify(y)))
    case '<':
      return x < y
    case '<=':
      return x <= y
    case '>':
      return x > y
    case '>=':
      return x >= y
  }
  return false
}

class Parser {
  private pos = 0
  readonly comparisons: Comparison[] = []
  private tokens: Token[]
  private ctx: ExprContext
  constructor(tokens: Token[], ctx: ExprContext) {
    this.tokens = tokens
    this.ctx = ctx
  }

  parse(): any {
    const v = this.or()
    if (this.pos < this.tokens.length) throw new Error('Sintaxis no reconocida en la condición')
    return v
  }
  private peek() {
    return this.tokens[this.pos]
  }
  private or(): any {
    let v = this.and()
    while (this.peek()?.t === 'op' && this.peek()!.v === '||') {
      this.pos++
      const r = this.and()
      v = Boolean(v) || Boolean(r)
    }
    return v
  }
  private and(): any {
    let v = this.unary()
    while (this.peek()?.t === 'op' && this.peek()!.v === '&&') {
      this.pos++
      const r = this.unary()
      v = Boolean(v) && Boolean(r)
    }
    return v
  }
  private unary(): any {
    const t = this.peek()
    if (t?.t === 'op' && t.v === '!') {
      this.pos++
      return !this.unary()
    }
    return this.comparison()
  }
  private comparison(): any {
    const leftTok = this.peek()
    const left = this.primary()
    const t = this.peek()
    if (t?.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      this.pos++
      const rightTok = this.peek()
      const right = this.primary()
      const passed = compare(t.v, left, right)
      this.comparisons.push({
        left: describe(leftTok),
        leftValue: left,
        op: t.v,
        right: describe(rightTok),
        rightValue: right,
        passed,
      })
      return passed
    }
    return left
  }
  private primary(): any {
    const t = this.tokens[this.pos++]
    if (!t) throw new Error('La condición termina de forma inesperada')
    if (t.t === 'paren' && t.v === '(') {
      const v = this.or()
      const close = this.tokens[this.pos++]
      if (close?.t !== 'paren' || close.v !== ')') throw new Error('Falta cerrar un paréntesis')
      return v
    }
    if (t.t === 'lit') return t.v
    if (t.t === 'expr') return evaluateExpression(t.v, this.ctx).value
    throw new Error(`Token inesperado "${t.v}"`)
  }
}

function describe(t: Token | undefined): string {
  if (!t) return '?'
  if (t.t === 'expr') return t.v
  if (t.t === 'lit') return t.raw
  return String(t.v)
}

export function fmt(v: any): string {
  if (v === undefined) return 'sin valor'
  if (typeof v === 'string') return `"${v}"`
  const s = JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

const OP_TEXT: Record<string, string> = {
  '==': 'igual a',
  '!=': 'distinto de',
  '<': 'menor que',
  '<=': 'menor o igual a',
  '>': 'mayor que',
  '>=': 'mayor o igual a',
}

export function evaluateCriterion(c: Criterion, ctx: ExprContext): CriterionResult {
  let type = typeof c.type === 'object' ? c.type.type : (c.type ?? 'simple')
  // Condición simple marcada por error como jsonpath ($response.body#/x == 'y'): se evalúa como simple.
  if (type === 'jsonpath' && /^\s*\$(statusCode|response|request|inputs|steps|url|method)\b.*(==|!=|<=|>=|<|>)/.test(c.condition)) {
    type = 'simple'
  }
  const base = { condition: c.condition, type, context: c.context }
  try {
    if (type === 'simple') {
      const parser = new Parser(tokenize(c.condition), ctx)
      const passed = Boolean(parser.parse())
      let detail: string
      if (parser.comparisons.length === 0) {
        detail = passed ? 'La condición se cumple.' : 'La condición evaluó a falso o no tiene valor.'
      } else {
        const relevant = passed ? parser.comparisons : parser.comparisons.filter((x) => !x.passed)
        detail = (relevant.length ? relevant : parser.comparisons)
          .map((x) =>
            x.passed
              ? `${x.left} = ${fmt(x.leftValue)} ✔`
              : `Se esperaba ${x.left} ${OP_TEXT[x.op]} ${fmt(x.rightValue)}, pero vale ${fmt(x.leftValue)}`,
          )
          .join(' · ')
      }
      return { ...base, passed, detail }
    }
    const ctxValue = c.context ? evaluateExpression(c.context, ctx) : { found: false, value: undefined }
    if (!c.context) return { ...base, passed: false, detail: `El criterio de tipo "${type}" necesita "context".` }
    if (!ctxValue.found) return { ...base, passed: false, detail: `El contexto ${c.context} no tiene valor.` }
    if (type === 'regex') {
      const text = typeof ctxValue.value === 'string' ? ctxValue.value : JSON.stringify(ctxValue.value)
      const passed = new RegExp(c.condition).test(text)
      return {
        ...base,
        passed,
        detail: passed ? `${c.context} cumple la expresión regular.` : `${c.context} = ${fmt(ctxValue.value)} no cumple /${c.condition}/`,
      }
    }
    if (type === 'jsonpath') {
      const result = JSONPath({ path: c.condition, json: ctxValue.value, wrap: true })
      const passed = Array.isArray(result) && result.length > 0 && result.some((r) => r !== false)
      return {
        ...base,
        passed,
        detail: passed
          ? `JSONPath encontró ${result.length} coincidencia(s).`
          : `JSONPath no encontró coincidencias en ${c.context}.`,
      }
    }
    return { ...base, passed: false, detail: `Tipo de criterio "${type}" no soportado todavía (XPath).` }
  } catch (e) {
    return { ...base, passed: false, detail: `No se pudo evaluar la condición: ${(e as Error).message}` }
  }
}
