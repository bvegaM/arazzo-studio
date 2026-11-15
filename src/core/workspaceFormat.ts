/* eslint-disable @typescript-eslint/no-explicit-any */
// Formato en disco de un workspace, como en Bruno: carpetas y archivos de texto que se versionan en git.
//
//   mi-workspace/
//     studio.yaml              nombre, id y colecciones del workspace
//     partners/                una colección
//       collection.yaml        nombre de la colección
//       *.arazzo.yaml, ...     los Arazzo y sus contratos, tal cual
//       environments/*.yaml    URLs base, variables y color (de los secretos, solo el nombre)
//       scenarios/<arazzo>     inputs base y casos propios de cada Arazzo
//
// Los valores de secretos y credenciales nunca se escriben en estos archivos.
import YAML from 'yaml'
import { ENV_COLORS, VARIABLE_NAME, type EnvColor, type Environment } from './environments'

export const WORKSPACE_FILE = 'studio.yaml'
export const COLLECTION_FILE = 'collection.yaml'
export const ENVIRONMENTS_DIR = 'environments'
export const SCENARIOS_DIR = 'scenarios'
export const FORMAT_VERSION = 1

export interface WorkspaceManifest {
  /** Identidad estable (para guardar sus secretos en este equipo). */
  id: string
  name: string
  /** Carpetas de las colecciones, relativas al workspace. */
  collections: string[]
}

export interface CollectionManifest {
  name: string
  /** Versión de la colección que pone el equipo (p. ej. 1.2.0); no es la del formato. */
  collectionVersion?: string
  /**
   * Autorización de la colección (la heredan los requests con `inherit`). Sin secretos escritos
   * tal cual: esos se guardan cifrados en el equipo.
   */
  auth?: Record<string, unknown> & { type: string }
}

const header = (lines: string[]) => lines.map((l) => `# ${l}\n`).join('')

export function serializeWorkspace(w: WorkspaceManifest): string {
  return (
    header(['Workspace de Arazzo Studio. Cada colección es una carpeta con su collection.yaml.']) +
    YAML.stringify({ version: FORMAT_VERSION, id: w.id, name: w.name, collections: w.collections }, { lineWidth: 0 })
  )
}

export function parseWorkspace(text: string): WorkspaceManifest {
  const doc = YAML.parse(text) ?? {}
  if (typeof doc !== 'object') throw new Error('studio.yaml')
  return {
    id: typeof doc.id === 'string' && doc.id ? doc.id : crypto.randomUUID(),
    name: typeof doc.name === 'string' && doc.name ? doc.name : 'Workspace',
    collections: Array.isArray(doc.collections) ? doc.collections.filter((c: unknown): c is string => typeof c === 'string' && !!c) : [],
  }
}

export function serializeCollection(c: CollectionManifest): string {
  return (
    header(['Colección de Arazzo Studio: los Arazzo y contratos de esta carpeta, sus ambientes y sus casos.']) +
    YAML.stringify(
      {
        version: FORMAT_VERSION,
        name: c.name,
        ...(c.collectionVersion ? { collectionVersion: c.collectionVersion } : {}),
        ...(c.auth && c.auth.type !== 'none' ? { auth: c.auth } : {}),
      },
      { lineWidth: 0 },
    )
  )
}

export function parseCollection(text: string, fallbackName: string): CollectionManifest {
  const doc = YAML.parse(text) ?? {}
  return {
    name: typeof doc?.name === 'string' && doc.name ? doc.name : fallbackName,
    ...(doc?.collectionVersion !== undefined && doc.collectionVersion !== null ? { collectionVersion: String(doc.collectionVersion) } : {}),
    ...(doc?.auth && typeof doc.auth === 'object' && typeof doc.auth.type === 'string' ? { auth: doc.auth } : {}),
  }
}

/** Nombre de archivo seguro a partir de un nombre libre: "Prod (LatAm)" → "prod-latam". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'sin-nombre'
}

/** Carpeta libre para una colección nueva: "partners", "partners-2"… */
export function uniqueFolder(name: string, taken: string[]): string {
  const base = slugify(name)
  const used = new Set(taken.map((t) => t.toLowerCase()))
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}

export function environmentPath(env: Pick<Environment, 'name'>): string {
  return `${ENVIRONMENTS_DIR}/${slugify(env.name)}.yaml`
}

/** Un ambiente como archivo: URLs, variables y color. De los secretos solo va el nombre. */
export function serializeEnvironment(env: Environment): string {
  const variables = Object.fromEntries(env.variables.filter((v) => !v.secret && v.name).map((v) => [v.name, v.value]))
  const secrets = env.variables.filter((v) => v.secret && v.name).map((v) => v.name)
  const doc = {
    name: env.name,
    ...(env.color ? { color: env.color } : {}),
    // Las URLs vacías (p. ej. de fuentes AsyncAPI) no se guardan.
    servers: Object.fromEntries(Object.entries(env.servers).filter(([, url]) => url)),
    ...(Object.keys(variables).length ? { variables } : {}),
    ...(secrets.length ? { secrets } : {}),
  }
  return (
    header(['Ambiente de Arazzo Studio. Los valores de secretos y credenciales no se guardan aquí: viven cifrados en cada equipo.']) +
    YAML.stringify(doc, { lineWidth: 0 })
  )
}

/** Lee un ambiente; los secretos quedan sin valor (se completan desde el almacén de secretos). */
export function parseEnvironment(text: string, fallbackName: string): Environment {
  const doc = YAML.parse(text) ?? {}
  const variables = Object.entries<any>(doc.variables ?? {})
    .filter(([name]) => VARIABLE_NAME.test(name))
    .map(([name, value]) => ({ name, value: value === null || value === undefined ? '' : String(value), secret: false }))
  const secrets = (Array.isArray(doc.secrets) ? doc.secrets : [])
    .filter((n: unknown): n is string => typeof n === 'string' && VARIABLE_NAME.test(n))
    .map((name: string) => ({ name, value: '', secret: true }))
  const servers = Object.fromEntries(Object.entries<any>(doc.servers ?? {}).map(([k, v]) => [k, String(v ?? '')]))
  return {
    id: crypto.randomUUID(),
    name: typeof doc.name === 'string' && doc.name ? doc.name : fallbackName,
    ...(ENV_COLORS.includes(doc.color) ? { color: doc.color as EnvColor } : {}),
    servers,
    credentials: {},
    variables: [...variables, ...secrets],
  }
}

/** Archivo de escenarios de un Arazzo de la colección (misma ruta, dentro de scenarios/). */
export function scenariosPath(arazzoFile: string): string {
  return `${SCENARIOS_DIR}/${arazzoFile}`
}

/** Archivos propios de Arazzo Studio dentro de una colección (no son Arazzo ni contratos). */
export function isStudioDataPath(path: string): boolean {
  return path === COLLECTION_FILE || path === 'flow-auth.yaml' || path.startsWith(`${ENVIRONMENTS_DIR}/`) || path.startsWith(`${SCENARIOS_DIR}/`)
}

/** Archivos que se cargan como parte de la colección: YAML y JSON fuera de las carpetas de datos. */
export function isCollectionContentPath(path: string): boolean {
  const name = path.split('/').pop() ?? path
  // Los requests sueltos (requests/*.request.yaml) se leen aparte, no como Arazzo ni contratos.
  return /\.(ya?ml|json)$/i.test(name) && !name.startsWith('.') && !name.endsWith('.request.yaml') && !isStudioDataPath(path)
}

/** Claves de los secretos de la autorización de un request y de la colección. */
export const requestSecretKey = (workspaceId: string, collection: string, path: string) => [workspaceId, collection, 'request', path].join('|')
export const collectionAuthKey = (workspaceId: string, collection: string) => [workspaceId, collection, 'collection-auth'].join('|')
export const flowAuthKey = (workspaceId: string, collection: string) => [workspaceId, collection, 'flow-auth'].join('|')

/** Clave de un secreto en el almacén de este equipo. */
export function secretKey(workspaceId: string, collection: string, envName: string, kind: 'var' | 'cred', name: string): string {
  return [workspaceId, collection, envName, kind, name].join('|')
}
