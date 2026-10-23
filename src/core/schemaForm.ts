/* eslint-disable @typescript-eslint/no-explicit-any */
// Ayudas para editar valores según un JSON Schema campo a campo (objetos anidados y listas).
import { t, type MessageKey } from '../i18n'

export type FieldKind = 'enum' | 'boolean' | 'number' | 'string' | 'object' | 'array' | 'json'

/** Une allOf en un solo esquema (propiedades y required) para poder recorrerlo. */
export function normalizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema ?? {}
  if (!Array.isArray(schema.allOf)) return schema
  const { allOf, ...rest } = schema
  const parts = [rest, ...allOf.map(normalizeSchema)]
  const out: any = Object.assign({}, ...parts)
  const props = Object.assign({}, ...parts.map((p: any) => p?.properties ?? {}))
  const required = [...new Set(parts.flatMap((p: any) => p?.required ?? []))]
  if (Object.keys(props).length) out.properties = props
  if (required.length) out.required = required
  return out
}

export function schemaType(schema: any): string | undefined {
  const s = normalizeSchema(schema)
  const type = Array.isArray(s?.type) ? s.type.find((x: string) => x !== 'null') : s?.type
  if (type) return type
  if (s?.properties) return 'object'
  if (s?.items) return 'array'
  return undefined
}

/** Qué control usar: un objeto sin propiedades conocidas se sigue editando como JSON. */
export function fieldKind(schema: any): FieldKind {
  const s = normalizeSchema(schema)
  if (s?.enum) return 'enum'
  const type = schemaType(s)
  if (type === 'boolean') return 'boolean'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'object') return s.properties && Object.keys(s.properties).length ? 'object' : 'json'
  if (type === 'array') return s.items ? 'array' : 'json'
  return 'string'
}

export const isEmptyValue = (v: any) => v === undefined || v === ''

/** Devuelve el objeto con la clave cambiada; sin claves vacías y undefined si queda vacío. */
export function setKey(obj: any, key: string, value: any): Record<string, any> | undefined {
  const next = { ...(obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}) }
  if (isEmptyValue(value)) delete next[key]
  else next[key] = value
  return Object.keys(next).length ? next : undefined
}

/** Valor inicial desde example/default/enum; en objetos se arma con los ejemplos de sus propiedades. */
export function exampleValue(schema: any, depth = 0): any {
  const s = normalizeSchema(schema)
  const v = s?.example ?? s?.examples?.[0] ?? s?.default ?? s?.enum?.[0]
  if (v !== undefined || depth > 8) return v
  if (fieldKind(s) !== 'object') return undefined
  let out: Record<string, any> | undefined
  for (const [k, child] of Object.entries<any>(s.properties)) out = setKey(out, k, exampleValue(child, depth + 1))
  return out
}

/**
 * Rutas obligatorias sin valor (ej. "cliente.direccion.calle").
 * Dentro de un objeto opcional solo se revisa si el usuario empezó a llenarlo.
 */
export function missingPaths(schema: any, value: any, prefix = ''): string[] {
  const s = normalizeSchema(schema)
  if (fieldKind(s) !== 'object' || !value || typeof value !== 'object' || Array.isArray(value)) return []
  const out: string[] = []
  for (const [k, child] of Object.entries<any>(s.properties)) {
    const path = prefix ? `${prefix}.${k}` : k
    const v = value[k]
    if ((s.required ?? []).includes(k) && isEmptyValue(v)) {
      out.push(path)
      continue
    }
    if (fieldKind(child) === 'object') out.push(...missingPaths(child, v, path))
    else if (fieldKind(child) === 'array' && Array.isArray(v)) {
      v.forEach((item, i) => out.push(...missingPaths(child.items, item, `${path}[${i}]`)))
    }
  }
  return out
}

/** Obligatorios que faltan en los inputs de un workflow, incluidos los anidados. */
export function missingInputs(inputsSchema: any, values: Record<string, any> | undefined): string[] {
  return missingPaths(inputsSchema, values ?? {})
}

/** Campos simples primero y grupos (objetos y listas) al final, respetando el orden declarado. */
export function leavesFirst<T>(entries: [string, T][]): [string, T][] {
  const isGroup = ([, s]: [string, T]) => ['object', 'array'].includes(fieldKind(s))
  return [...entries.filter((e) => !isGroup(e)), ...entries.filter(isGroup)]
}

/** Resumen corto de un valor para mostrar en un grupo plegado (ej. "nombre: Ana · direccion: {…}"). */
export function valueSummary(value: any, max = 3): string {
  const show = (v: any) => (Array.isArray(v) ? `[${v.length}]` : v && typeof v === 'object' ? '{…}' : String(v))
  if (Array.isArray(value)) return value.filter((v) => !isEmptyValue(v)).slice(0, max).map(show).join(' · ')
  if (!value || typeof value !== 'object') return isEmptyValue(value) ? '' : String(value)
  const parts = Object.entries(value).filter(([, v]) => !isEmptyValue(v))
  const text = parts.slice(0, max).map(([k, v]) => `${k}: ${show(v)}`).join(' · ')
  return parts.length > max ? `${text} · …` : text
}

/** Nombre del tipo en lenguaje normal; el tipo técnico queda en el tooltip. */
export function typeLabel(schema: any): string {
  const kind = fieldKind(schema)
  const raw = schemaType(schema)
  const key = kind === 'enum' || kind === 'json' ? kind : (raw ?? 'any')
  const label = t(`params.type.${key}` as MessageKey)
  return schema?.format ? `${label} · ${schema.format}` : label
}

const FORMATS: Record<string, { test: (v: string) => boolean; key: MessageKey }> = {
  email: { test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), key: 'val.email' },
  uuid: { test: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), key: 'val.uuid' },
  date: { test: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)), key: 'val.date' },
  'date-time': { test: (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v)), key: 'val.dateTime' },
  uri: { test: (v) => URL.canParse(v), key: 'val.uri' },
  url: { test: (v) => URL.canParse(v), key: 'val.uri' },
}

function matches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(value)
  } catch {
    return true // un patrón que no entendemos no debe bloquear al usuario
  }
}

/**
 * Primer problema de un valor simple o de una lista frente a su esquema, en lenguaje normal.
 * Los valores con generadores ({{email}}) no se revisan: se resuelven al ejecutar.
 */
export function validateValue(schema: any, value: any): string | undefined {
  const s = normalizeSchema(schema)
  if (isEmptyValue(value) || (typeof value === 'string' && value.includes('{{'))) return undefined
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) return t('val.minItems', { n: s.minItems })
    if (s.maxItems !== undefined && value.length > s.maxItems) return t('val.maxItems', { n: s.maxItems })
    return undefined
  }
  if (s.enum && !s.enum.some((e: any) => e === value)) return t('val.enum')
  const type = schemaType(s)
  if (typeof value === 'number' || type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || isNaN(value)) return t('val.number')
    if (type === 'integer' && !Number.isInteger(value)) return t('val.integer')
    if (s.minimum !== undefined && value < s.minimum) return t('val.minimum', { n: s.minimum })
    if (s.maximum !== undefined && value > s.maximum) return t('val.maximum', { n: s.maximum })
    if (typeof s.exclusiveMinimum === 'number' && value <= s.exclusiveMinimum) return t('val.exclusiveMinimum', { n: s.exclusiveMinimum })
    if (typeof s.exclusiveMaximum === 'number' && value >= s.exclusiveMaximum) return t('val.exclusiveMaximum', { n: s.exclusiveMaximum })
    return undefined
  }
  if (typeof value === 'string') {
    if (s.minLength !== undefined && value.length < s.minLength) return t('val.minLength', { n: s.minLength })
    if (s.maxLength !== undefined && value.length > s.maxLength) return t('val.maxLength', { n: s.maxLength })
    if (s.pattern && !matches(s.pattern, value)) return t('val.pattern', { pattern: s.pattern })
    const format = s.format && FORMATS[s.format]
    if (format && !format.test(value)) return t(format.key)
  }
  return undefined
}

/** Rutas con valores que no cumplen el esquema (ej. "cliente.email", "items[0].sku"). */
export function invalidPaths(schema: any, value: any, prefix = ''): string[] {
  const s = normalizeSchema(schema)
  const kind = fieldKind(s)
  if (kind === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return Object.entries<any>(s.properties).flatMap(([k, child]) => invalidPaths(child, value[k], prefix ? `${prefix}.${k}` : k))
  }
  const own = validateValue(s, value) ? [prefix] : []
  if (kind === 'array' && Array.isArray(value)) {
    return [...own, ...value.flatMap((item, i) => invalidPaths(s.items, item, `${prefix}[${i}]`))]
  }
  return own
}
