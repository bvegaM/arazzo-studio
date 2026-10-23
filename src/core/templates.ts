/* eslint-disable @typescript-eslint/no-explicit-any */
// Generadores de datos para que un caso se pueda repetir: un CPF o un email nuevos en cada corrida.

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

export const TEMPLATE_HELP: { token: string; description: string }[] = [
  { token: '{{email}}', description: 'email único' },
  { token: '{{cpf}}', description: 'CPF válido' },
  { token: '{{rut}}', description: 'RUT chileno válido' },
  { token: '{{uuid}}', description: 'UUID v4' },
  { token: '{{numero:8}}', description: 'N dígitos al azar' },
  { token: '{{fecha}}', description: 'fecha de hoy (YYYY-MM-DD)' },
  { token: '{{timestamp}}', description: 'milisegundos actuales' },
]

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
      return digits(Math.max(1, Math.min(32, Number(arg) || 6)))
    case 'fecha':
      return new Date().toISOString().slice(0, 10)
    case 'timestamp':
      return String(Date.now())
  }
  return undefined
}

const TOKEN = /\{\{\s*([a-z]+)(?::(\d+))?\s*\}\}/gi

/** Reemplaza {{generador}} en cualquier valor. Los tokens desconocidos se dejan tal cual. */
export function resolveTemplates(value: any): any {
  if (typeof value === 'string') {
    return value.replace(TOKEN, (all, name: string, arg?: string) => generate(name.toLowerCase(), arg) ?? all)
  }
  if (Array.isArray(value)) return value.map(resolveTemplates)
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v)
    return out
  }
  return value
}
