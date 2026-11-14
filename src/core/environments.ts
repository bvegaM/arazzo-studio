// Ambientes (DEV, QA, UAT…): cada uno con sus URLs base, credenciales, variables y secretos.

/** Variable de un ambiente; se usa como {{nombre}} en inputs, casos, URLs base y credenciales. */
export interface EnvVariable {
  name: string
  value: string
  /** Los secretos no se guardan y se ocultan en resultados y reportes. */
  secret: boolean
}

export interface Environment {
  id: string
  name: string
  /** URL base por fuente del Arazzo. */
  servers: Record<string, string>
  /** Valor por esquema de seguridad. Nunca se guarda fuera de la pestaña. */
  credentials: Record<string, string>
  variables: EnvVariable[]
}

/**
 * Ambiente nuevo. Si se crea a partir de otro, copia sus URLs y sus variables; de los secretos
 * copia solo el nombre, porque su valor suele ser distinto en cada ambiente.
 */
export function newEnvironment(name: string, servers: Record<string, string> = {}, variables: EnvVariable[] = []): Environment {
  return {
    id: crypto.randomUUID(),
    name,
    servers: { ...servers },
    credentials: {},
    variables: variables.map((v) => ({ ...v, value: v.secret ? '' : v.value })),
  }
}

export const VARIABLE_NAME = /^[A-Za-z_][\w.-]*$/

/** Valores por nombre para resolver {{nombre}} (las variables sin nombre válido se ignoran). */
export function variableValues(env: Pick<Environment, 'variables'>): Record<string, string> {
  return Object.fromEntries((env.variables ?? []).filter((v) => VARIABLE_NAME.test(v.name)).map((v) => [v.name, v.value]))
}

/** Valores que no deben aparecer en resultados ni reportes: secretos y credenciales. */
export function secretValues(env: Pick<Environment, 'variables' | 'credentials'>): string[] {
  const values = [...(env.variables ?? []).filter((v) => v.secret).map((v) => v.value), ...Object.values(env.credentials ?? {})]
  // Valores muy cortos no se ocultan: taparían letras sueltas en cualquier texto.
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length >= 4))]
}

/** Reemplaza cada aparición de un secreto por •••• en cualquier valor (profundo). */
export function redactSecrets<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return secrets.reduce((s, secret) => s.split(secret).join('••••'), v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}

/** Nombre libre a partir de una base: "QA", "QA 2", "QA 3"… */
export function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!taken.has(base.trim().toLowerCase())) return base
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`
}

/** Completa las URLs que falten en cada ambiente con las del contrato, sin pisar las del usuario. */
export function fillServers(envs: Environment[], defaults: Record<string, string>): Environment[] {
  return envs.map((e) => {
    const missing = Object.entries(defaults).filter(([k]) => e.servers[k] === undefined)
    return missing.length ? { ...e, servers: { ...e.servers, ...Object.fromEntries(missing) } } : e
  })
}
