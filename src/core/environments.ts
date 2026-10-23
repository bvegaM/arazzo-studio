// Ambientes (DEV, QA, UAT…): cada uno con sus URLs base y sus credenciales.

export interface Environment {
  id: string
  name: string
  /** URL base por fuente del Arazzo. */
  servers: Record<string, string>
  /** Valor por esquema de seguridad. Nunca se guarda fuera de la pestaña. */
  credentials: Record<string, string>
}

export function newEnvironment(name: string, servers: Record<string, string> = {}): Environment {
  return { id: crypto.randomUUID(), name, servers: { ...servers }, credentials: {} }
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
