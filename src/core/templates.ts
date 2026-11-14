/* eslint-disable @typescript-eslint/no-explicit-any */
// Generadores de datos para que un caso se pueda repetir: un CPF o un email nuevos en cada corrida.
import { t } from '../i18n'
import { DYNAMIC_NAMES, generateDynamic, isDynamicName } from './dynamicVars'

function randInt(max: number): number {
  return Math.floor(Math.random() * max)
}

function digits(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += String(randInt(10))
  return s
}

/** CPF brasileño válido (11 dígitos con sus dos dígitos verificadores). */
export function generateCpf(): string {
  let base = digits(9)
  while (/^(\d)\1+$/.test(base)) base = digits(9)
  const dv = (nums: string, factor: number) => {
    const sum = nums.split('').reduce((acc, d, i) => acc + Number(d) * (factor - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = dv(base, 10)
  const d2 = dv(base + d1, 11)
  return `${base}${d1}${d2}`
}

export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false
  const dv = (nums: string, factor: number) => {
    const sum = nums.split('').reduce((acc, d, i) => acc + Number(d) * (factor - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10])
}

/** RUT chileno válido, sin puntos ni guion (cuerpo + dígito verificador). */
export function generateRut(): string {
  const body = String(10_000_000 + randInt(15_000_000))
  let sum = 0
  let mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const r = 11 - (sum % 11)
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r)
  return `${body}${dv}`
}

/** Generadores disponibles, con los nombres del idioma actual ({{numero}} y {{number}} son equivalentes). */
export function templateHelp(): { token: string; description: string }[] {
  return [
    { token: '{{email}}', description: t('tpl.email') },
    { token: '{{cpf}}', description: t('tpl.cpf') },
    { token: '{{rut}}', description: t('tpl.rut') },
    { token: '{{uuid}}', description: 'UUID v4' },
    { token: t('tpl.numberToken'), description: t('tpl.number') },
    { token: t('tpl.dateToken'), description: t('tpl.date') },
    { token: '{{timestamp}}', description: t('tpl.timestamp') },
  ]
}

function generate(name: string, arg?: string): string | undefined {
  switch (name) {
    case 'email':
      return `prueba+${Date.now().toString(36)}${digits(3)}@example.com`
    case 'cpf':
      return generateCpf()
    case 'rut':
      return generateRut()
    case 'uuid':
      return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = randInt(16)
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
          })
    case 'numero':
    case 'number':
      return digits(Math.max(1, Math.min(32, Number(arg) || 6)))
    case 'fecha':
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'timestamp':
      return String(Date.now())
  }
  return undefined
}

const TOKEN = /\{\{\s*(\$?[A-Za-z_][\w.-]*)(?::(\d+))?\s*\}\}/g

/** Nombres de los generadores (en los dos idiomas): una variable con el mismo nombre los tapa. */
export const GENERATOR_NAMES = ['email', 'cpf', 'rut', 'uuid', 'numero', 'number', 'fecha', 'date', 'timestamp']

/** Si {{nombre}} se genera solo: un generador propio o una variable dinámica ($randomFirstName…). */
export function isGeneratorName(name: string): boolean {
  return isDynamicName(name) || GENERATOR_NAMES.includes(name.toLowerCase())
}

/** Variables dinámicas con su descripción, para sugerirlas. */
export function dynamicHelp(): { token: string; description: string }[] {
  return DYNAMIC_NAMES.map((name) => ({ token: `{{${name}}}`, description: t(`dyn.${name}` as Parameters<typeof t>[0]) }))
}

/** Un valor de ejemplo de una variable dinámica (para mostrarlo en las sugerencias). */
export function dynamicExample(name: string): string | undefined {
  return generateDynamic(name)
}

/**
 * Reemplaza {{variable}} (del ambiente activo) y {{generador}} en cualquier valor.
 * Las variables tienen prioridad; los tokens desconocidos se dejan tal cual.
 */
export function resolveTemplates(value: any, variables: Record<string, string> = {}): any {
  if (typeof value === 'string') {
    return value.replace(TOKEN, (all, name: string, arg?: string) =>
      arg === undefined && Object.hasOwn(variables, name)
        ? variables[name]
        : (generateDynamic(name) ?? (name.startsWith('$') ? undefined : generate(name.toLowerCase(), arg)) ?? all),
    )
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, variables))
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v, variables)
    return out
  }
  return value
}

/** Los {{nombre}} de un valor que no son variables ni generadores (para avisar antes de enviarlos). */
export function unknownTemplates(value: unknown, variables: Record<string, string> = {}): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const found = [...text.matchAll(TOKEN)].map((m) => m[1]).filter((n) => !Object.hasOwn(variables, n) && !isGeneratorName(n))
  return [...new Set(found)]
}
