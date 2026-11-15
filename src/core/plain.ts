// Lenguaje simple para quien no es técnico (PMs, negocio): los criterios de éxito en palabras y un
// veredicto de la ejecución que responde "¿funciona la integración?".
import { humanizeId } from './format'
import { t, type MessageKey } from '../i18n'
import type { CaseRun } from './testcases'

const STATUS_NAMES = [200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503]

/** "200 (OK)", "404 (no encontrado)". */
export function statusName(code: number): string {
  return STATUS_NAMES.includes(code) ? `${code} (${t(`plain.http.${code}` as MessageKey)})` : String(code)
}

const OPS: Record<string, MessageKey> = {
  '==': 'plain.op.eq',
  '!=': 'plain.op.ne',
  '>': 'plain.op.gt',
  '>=': 'plain.op.ge',
  '<': 'plain.op.lt',
  '<=': 'plain.op.le',
}

/** "/damage_relations/double_damage_to/0" o ".damage_relations.double_damage_to[0]" → "damage relations › double damage to". */
function fieldName(path: string): string {
  const parts = path
    .replace(/\[(\d+|\*)\]/g, '')
    .split(/[/.]/)
    .filter((p) => p && !/^\d+$/.test(p) && p !== '$' && p !== '*')
  return parts.map((p) => humanizeId(p).toLowerCase()).join(' › ')
}

function value(raw: string): string {
  const v = raw.trim()
  if (/^(['"]).*\1$/.test(v)) return `«${v.slice(1, -1)}»`
  if (v === 'true') return t('plain.value.true')
  if (v === 'false') return t('plain.value.false')
  if (v === 'null') return t('plain.value.null')
  return v
}

/** De quién habla una expresión: el status, un header, un dato de la respuesta o del mensaje. */
function subject(expr: string): string | undefined {
  const e = expr.trim()
  if (e === '$statusCode') return t('plain.subject.status')
  let m = /^\$response\.header\.([\w-]+)$/i.exec(e)
  if (m) return t('plain.subject.header', { name: m[1] })
  m = /^\$(response\.body|message\.payload)(?:#(\/.*)|\.(.+))?$/.exec(e)
  if (m) {
    const field = fieldName(m[2] ?? m[3] ?? '')
    const where = m[1] === 'message.payload' ? 'message' : 'response'
    return field ? t(`plain.subject.field.${where}`, { field }) : t(`plain.subject.${where}`)
  }
  m = /^\$inputs\.([\w.-]+)$/.exec(e)
  if (m) return t('plain.subject.input', { name: m[1] })
  m = /^\$steps\.([\w-]+)\.outputs\.([\w.-]+)$/.exec(e)
  if (m) return t('plain.subject.output', { name: fieldName(m[2]), step: humanizeId(m[1]).toLowerCase() })
  return undefined
}

/** Una expresión de runtime en palabras ("$inputs.pokemon" → "el input «pokemon»"); el texto tal cual si no lo es. */
export function plainExpression(v: unknown): string {
  if (typeof v !== 'string') return typeof v === 'object' ? JSON.stringify(v) : String(v)
  const who = /^\$[\w.#/-]+$/.test(v.trim()) ? subject(v) : undefined
  return who ? capitalize(who) : v
}

/** Una comparación simple: "$statusCode == 200". */
function simplePart(part: string): string | undefined {
  const m = /^\s*(\$[^\s=!<>]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/.exec(part)
  if (!m) return undefined
  const [, lhs, op, rhs] = m
  if (lhs === '$statusCode' && op === '==' && /^\d{3}$/.test(rhs)) return t('plain.crit.status', { status: statusName(Number(rhs)) })
  const who = subject(lhs)
  if (!who || /\|\||&&/.test(rhs)) return undefined
  // El otro lado también puede ser una expresión ("$steps.a.outputs.id"): en palabras o nada.
  const other = rhs.startsWith('$') ? subject(rhs) : value(rhs)
  return other ? t('plain.crit.compare', { who, op: t(OPS[op]), value: other }) : undefined
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/**
 * Un criterio de éxito en palabras: "$statusCode == 200" → "La API responde 200 (OK)".
 * Si no se puede traducir con seguridad, una frase genérica (la regla técnica se muestra aparte).
 */
export function plainCriterion(c: { condition: string; context?: string; type?: string }): string {
  const type = c.type ?? 'simple'
  if (type === 'simple' && !c.context) {
    const parts = c.condition.split(/\s*&&\s*/)
    const texts = parts.map(simplePart)
    if (texts.every(Boolean)) return capitalize(texts.join(t('plain.and')))
    return t('plain.crit.generic')
  }
  const where = (c.context && subject(c.context)) || t('plain.subject.response')
  if (type === 'regex') return capitalize(t('plain.crit.regex', { who: where }))
  if (type === 'jsonpath' || type === 'xpath') {
    // "$.abilities[?(@.is_hidden == false)]" → "abilities" (con condición); "/pokemon/name" → "pokemon › name".
    const filtered = /\[\?/.test(c.condition)
    const field = fieldName(c.condition.replace(/\[\?.*$/, '').replace(/^\/\//, '/'))
    if (!field) return capitalize(t('plain.crit.matches', { who: where }))
    return capitalize(t(filtered ? 'plain.crit.includesWhere' : 'plain.crit.includes', { who: where, field }))
  }
  return t('plain.crit.generic')
}

export type SummaryTone = 'ok' | 'warn' | 'err'

/** Lo que hace falta de cada caso (sirve para la ejecución en curso y para el reporte). */
export type SummaryCase = Pick<CaseRun, 'tc' | 'verdict' | 'steps'> & { state?: CaseRun['state'] }

export interface RunSummary {
  tone: SummaryTone
  headline: string
  /** Detalle en frases cortas (lo que no pasó, las advertencias, lo que no se pudo comprobar). */
  points: string[]
}

/** El primer paso que falló, con su motivo, para decir dónde se rompió el flujo. */
function failurePoint(r: SummaryCase): string {
  const step = r.steps.find((s) => s.status === 'failed')
  return step ? humanizeId(step.stepId).toLowerCase() : ''
}

/**
 * Veredicto de una ejecución en lenguaje de negocio: si el flujo principal (camino feliz) funciona
 * y qué comprobaciones extra no salieron como se esperaba. undefined mientras haya casos sin terminar.
 */
export function summarizeRuns(runs: SummaryCase[]): RunSummary | undefined {
  if (!runs.length || runs.some((r) => (r.state ? r.state !== 'done' : !r.verdict))) return undefined
  const main = runs.find((r) => r.tc.origin === 'arazzo' && r.tc.expectation.type === 'success')
  const others = runs.filter((r) => r !== main)
  const failed = others.filter((r) => r.verdict === 'failed')
  const warnings = others.filter((r) => r.verdict === 'warning')
  const unknown = others.filter((r) => r.verdict === 'inconclusive')
  const points: string[] = []
  if (failed.length) points.push(t('plain.sum.failed', { n: failed.length, cases: failed.map((r) => `«${r.tc.title}»`).join(', ') }))
  if (warnings.length) points.push(t('plain.sum.warnings', { n: warnings.length, cases: warnings.map((r) => `«${r.tc.title}»`).join(', ') }))
  if (unknown.length) points.push(t('plain.sum.unknown', { n: unknown.length }))

  let tone: SummaryTone = failed.length ? 'err' : warnings.length || unknown.length ? 'warn' : 'ok'
  let headline: string
  if (main?.verdict === 'passed') {
    headline = t(others.length && !failed.length && !warnings.length && !unknown.length ? 'plain.sum.mainOkAll' : 'plain.sum.mainOk')
  } else if (main?.verdict === 'failed') {
    tone = 'err'
    const step = failurePoint(main)
    headline = step ? t('plain.sum.mainFailedAt', { step }) : t('plain.sum.mainFailed')
  } else if (main) {
    tone = tone === 'err' ? 'err' : 'warn'
    headline = t('plain.sum.mainUnknown')
  } else {
    const passed = others.filter((r) => r.verdict === 'passed').length
    headline = t('plain.sum.noMain', { passed, total: others.length })
  }
  return { tone, headline, points }
}
