// Operaciones de un workspace sobre su almacenamiento: crear, abrir colecciones, leerlas completas
// y calcular qué archivos escribir. El estado de la app no se toca aquí (ver useWorkspace).
import type { Environment } from '../core/environments'
import type { LoadedFile } from '../core/loader'
import {
  COLLECTION_FILE,
  ENVIRONMENTS_DIR,
  SCENARIOS_DIR,
  WORKSPACE_FILE,
  environmentPath,
  isCollectionContentPath,
  parseCollection,
  parseEnvironment,
  parseWorkspace,
  secretKey,
  collectionAuthKey,
  flowAuthKey,
  requestSecretKey,
  serializeCollection,
  serializeEnvironment,
  serializeWorkspace,
  uniqueFolder,
  type CollectionManifest,
  type WorkspaceManifest,
} from '../core/workspaceFormat'
import { secretStore } from '../lib/secrets'
import { isRequestPath, withAuthSecrets, type RequestAuth } from '../core/requests'
import { FLOW_AUTH_FILE, hasFlowSecrets, parseFlowAuth, withFlowAuthSecrets, type FlowAuth, type FlowAuthSecrets } from '../core/flowAuth'
import { listFilesDeep, type WorkspaceFs } from '../lib/workspaceFs'

export interface CollectionInfo {
  /** Carpeta relativa al workspace ("." = la raíz del workspace). */
  folder: string
  name: string
  collectionVersion?: string
}

export interface CollectionData {
  files: LoadedFile[]
  environments: Environment[]
  /** Archivo de escenarios por Arazzo (ruta del Arazzo → texto). */
  scenarios: Record<string, string>
  /** Requests sueltos (requests/*.request.yaml) y los .proto que usan los de gRPC, por ruta. */
  requests: Record<string, string>
  protos: Record<string, string>
  /** Secretos de la autorización de cada request (por ruta) y la autorización de la colección. */
  requestSecrets: Record<string, Record<string, string>>
  collectionAuth?: RequestAuth
  /** Autorización de los journeys (por API y por journey), con sus secretos. */
  flowAuth: FlowAuth
}

const inFolder = (folder: string, path: string) => (folder === '.' || !folder ? path : `${folder}/${path}`)
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export async function readManifest(fs: WorkspaceFs): Promise<WorkspaceManifest | undefined> {
  const text = await fs.read(WORKSPACE_FILE)
  return text === undefined ? undefined : parseWorkspace(text)
}

export async function writeManifest(fs: WorkspaceFs, manifest: WorkspaceManifest): Promise<void> {
  await fs.write(WORKSPACE_FILE, serializeWorkspace(manifest))
}

/**
 * Abre una carpeta como workspace. Si no tiene studio.yaml lo crea: con las subcarpetas que ya
 * son colecciones y, si en la raíz hay Arazzo o contratos, la raíz como colección.
 */
export async function openOrInitWorkspace(fs: WorkspaceFs, fallbackName: string): Promise<WorkspaceManifest> {
  const existing = await readManifest(fs)
  if (existing) return existing
  const entries = await fs.list('')
  const collections: string[] = []
  for (const e of entries) if (e.dir && (await fs.read(`${e.name}/${COLLECTION_FILE}`)) !== undefined) collections.push(e.name)
  const rootHasContent = entries.some((e) => !e.dir && isCollectionContentPath(e.name) && e.name !== WORKSPACE_FILE)
  if (rootHasContent) {
    collections.unshift('.')
    if ((await fs.read(COLLECTION_FILE)) === undefined) await fs.write(COLLECTION_FILE, serializeCollection({ name: fallbackName }))
  }
  const manifest: WorkspaceManifest = { id: crypto.randomUUID(), name: fallbackName, collections }
  await writeManifest(fs, manifest)
  return manifest
}

export async function createWorkspace(fs: WorkspaceFs, name: string): Promise<WorkspaceManifest> {
  const manifest: WorkspaceManifest = { id: crypto.randomUUID(), name, collections: [] }
  await writeManifest(fs, manifest)
  return manifest
}

/** Crea una colección (carpeta con collection.yaml y un ambiente "local") y la agrega al workspace. */
export async function createCollection(
  fs: WorkspaceFs,
  manifest: WorkspaceManifest,
  name: string,
  firstEnvironment: Environment,
): Promise<{ manifest: WorkspaceManifest; folder: string }> {
  const folder = uniqueFolder(name, manifest.collections)
  await fs.write(inFolder(folder, COLLECTION_FILE), serializeCollection({ name }))
  await fs.write(inFolder(folder, environmentPath(firstEnvironment)), serializeEnvironment(firstEnvironment))
  const next = { ...manifest, collections: [...manifest.collections, folder] }
  await writeManifest(fs, next)
  return { manifest: next, folder }
}

/** Cambia datos de collection.yaml (nombre visible, versión); la carpeta no se mueve. */
export async function updateCollection(
  fs: WorkspaceFs,
  folder: string,
  patch: Partial<{ name: string; collectionVersion: string; auth: CollectionManifest['auth'] }>,
): Promise<void> {
  const text = await fs.read(inFolder(folder, COLLECTION_FILE))
  const current: CollectionManifest = text === undefined ? { name: patch.name ?? folder } : parseCollection(text, patch.name ?? folder)
  const next = { ...current, ...patch }
  if (!next.collectionVersion) delete next.collectionVersion
  if (!next.auth || next.auth.type === 'none') delete next.auth
  await fs.write(inFolder(folder, COLLECTION_FILE), serializeCollection(next))
}

/** Cambia el nombre visible de una colección (la carpeta no se mueve). */
export async function renameCollection(fs: WorkspaceFs, folder: string, name: string): Promise<void> {
  await updateCollection(fs, folder, { name })
}

/** Documentación de una colección (README.md en su carpeta). */
export const readCollectionDocs = (fs: WorkspaceFs, folder: string) => fs.read(inFolder(folder, 'README.md'))
export async function writeCollectionDocs(fs: WorkspaceFs, folder: string, text: string): Promise<void> {
  if (text.trim()) await fs.write(inFolder(folder, 'README.md'), text.endsWith('\n') ? text : `${text}\n`)
  else await fs.remove(inFolder(folder, 'README.md'))
}

/** Saca una colección del workspace. Con `deleteFiles` borra también su carpeta y sus secretos. */
export async function removeCollection(
  fs: WorkspaceFs,
  manifest: WorkspaceManifest,
  folder: string,
  deleteFiles: boolean,
): Promise<WorkspaceManifest> {
  const next = { ...manifest, collections: manifest.collections.filter((c) => c !== folder) }
  await writeManifest(fs, next)
  if (deleteFiles && folder !== '.') {
    const base = inFolder(folder, ENVIRONMENTS_DIR)
    for (const e of await fs.list(base)) {
      if (e.dir || !/\.ya?ml$/i.test(e.name)) continue
      const text = await fs.read(`${base}/${e.name}`)
      if (text === undefined) continue
      try {
        const env = parseEnvironment(text, e.name.replace(/\.ya?ml$/i, ''))
        const keys = secretKeys(manifest.id, folder, env.name)
        await secretStore.remove(keys.vars)
        await secretStore.remove(keys.creds)
      } catch {
        /* ambiente ilegible: no tiene secretos que borrar */
      }
    }
    await fs.removeDir(folder)
  }
  return next
}

/**
 * Renombra un Arazzo de una colección junto con su archivo de escenarios.
 * `next` es la ruta nueva dentro de la colección; el texto se toma de lo que está abierto.
 */
export async function renameArazzo(
  fs: WorkspaceFs,
  folder: string,
  file: { from: string; to: string; text: string; scenarios?: string },
): Promise<void> {
  await fs.write(inFolder(folder, file.to), file.text)
  if (file.scenarios !== undefined) await fs.write(inFolder(folder, `${SCENARIOS_DIR}/${file.to}`), file.scenarios)
  await fs.remove(inFolder(folder, file.from))
  await fs.remove(inFolder(folder, `${SCENARIOS_DIR}/${file.from}`))
}

/** Borra un Arazzo y su archivo de escenarios (los contratos se quedan). */
export async function deleteArazzo(fs: WorkspaceFs, folder: string, file: string): Promise<void> {
  await fs.remove(inFolder(folder, file))
  await fs.remove(inFolder(folder, `${SCENARIOS_DIR}/${file}`))
}

/** Ruta de una carpeta o archivo de la colección, relativa al workspace. */
export const collectionPath = inFolder

export async function collectionInfo(fs: WorkspaceFs, folder: string): Promise<CollectionInfo> {
  const text = await fs.read(inFolder(folder, COLLECTION_FILE))
  const fallback = folder === '.' ? 'Colección' : baseName(folder)
  if (text === undefined) return { folder, name: fallback }
  const parsed = parseCollection(text, fallback)
  return { folder, name: parsed.name, ...(parsed.collectionVersion ? { collectionVersion: parsed.collectionVersion } : {}) }
}

/** Secretos de un ambiente (variables secretas y credenciales), guardados cifrados en este equipo. */
function secretKeys(workspaceId: string, folder: string, envName: string) {
  return {
    vars: secretKey(workspaceId, folder, envName, 'var', '*'),
    creds: secretKey(workspaceId, folder, envName, 'cred', '*'),
  }
}

async function readSecrets(workspaceId: string, folder: string, env: Environment): Promise<Environment> {
  const keys = secretKeys(workspaceId, folder, env.name)
  const parse = (text?: string): Record<string, string> => {
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      return {}
    }
  }
  const vars = parse(await secretStore.get(keys.vars))
  const creds = parse(await secretStore.get(keys.creds))
  return {
    ...env,
    credentials: creds,
    variables: env.variables.map((v) => (v.secret && vars[v.name] !== undefined ? { ...v, value: vars[v.name] } : v)),
  }
}

/** Lee una colección completa: sus archivos, sus ambientes (con secretos) y sus escenarios. */
export async function readCollection(fs: WorkspaceFs, workspaceId: string, folder: string): Promise<CollectionData> {
  const base = folder === '.' ? '' : folder
  const paths = await listFilesDeep(fs, base)
  const files: LoadedFile[] = []
  const environments: Environment[] = []
  const scenarios: Record<string, string> = {}
  const requests: Record<string, string> = {}
  const protos: Record<string, string> = {}
  for (const path of paths) {
    const text = await fs.read(inFolder(folder, path))
    if (text === undefined) continue
    if (path.startsWith(`${ENVIRONMENTS_DIR}/`) && /\.ya?ml$/i.test(path)) {
      try {
        environments.push(await readSecrets(workspaceId, folder, parseEnvironment(text, baseName(path).replace(/\.ya?ml$/i, ''))))
      } catch {
        /* un ambiente ilegible no impide abrir la colección */
      }
    } else if (isRequestPath(path)) {
      requests[path] = text
    } else if (path.endsWith('.proto')) {
      protos[path] = text
    } else if (path.startsWith(`${SCENARIOS_DIR}/`)) {
      scenarios[path.slice(SCENARIOS_DIR.length + 1)] = text
    } else if (isCollectionContentPath(path)) {
      files.push({ name: path, text })
    }
  }
  // Secretos de la autorización: los de cada request y los de la colección, cifrados en este equipo.
  const readJson = async (key: string): Promise<Record<string, string> | undefined> => {
    try {
      const text = await secretStore.get(key)
      return text ? JSON.parse(text) : undefined
    } catch {
      return undefined
    }
  }
  const requestSecrets: Record<string, Record<string, string>> = {}
  for (const path of Object.keys(requests)) {
    const found = await readJson(requestSecretKey(workspaceId, folder, path))
    if (found) requestSecrets[path] = found
  }
  const manifest = await fs.read(inFolder(folder, COLLECTION_FILE))
  const publicAuth = manifest === undefined ? undefined : parseCollection(manifest, folder).auth
  const collectionAuth = publicAuth ? withAuthSecrets(publicAuth as RequestAuth, await readJson(collectionAuthKey(workspaceId, folder))) : undefined
  const flowAuth = withFlowAuthSecrets(parseFlowAuth(await fs.read(inFolder(folder, FLOW_AUTH_FILE))), (await readJson(flowAuthKey(workspaceId, folder))) as Partial<FlowAuthSecrets> | undefined)
  return { files, environments, scenarios, requests, protos, requestSecrets, collectionAuth, flowAuth }
}

/** Lo que hay que escribir de una colección: contenido, ambientes y escenarios, por ruta. */
export interface CollectionSnapshot {
  files: Record<string, string>
  /** Secretos por clave (JSON de cada ambiente). */
  secrets: Record<string, string>
  /** Autorización de la colección sin secretos (va a collection.yaml), en JSON para comparar. */
  collectionAuth?: { folder: string; json: string }
}

export function snapshotCollection(
  workspaceId: string,
  folder: string,
  state: {
    texts: LoadedFile[]
    environments: Environment[]
    scenarios: Record<string, string>
    requests?: Record<string, string>
    protos?: Record<string, string>
    requestSecrets?: Record<string, Record<string, string>>
    collectionAuthSecrets?: Record<string, string>
    collectionAuthPublic?: RequestAuth
    /** flow-auth.yaml (undefined: no hay nada configurado) y sus secretos. */
    flowAuthFile?: string
    flowAuthSecrets?: FlowAuthSecrets
  },
): CollectionSnapshot {
  const files: Record<string, string> = {}
  for (const f of state.texts) files[inFolder(folder, f.name)] = f.text
  for (const env of state.environments) files[inFolder(folder, environmentPath(env))] = serializeEnvironment(env)
  for (const [arazzo, text] of Object.entries(state.scenarios)) files[inFolder(folder, `${SCENARIOS_DIR}/${arazzo}`)] = text
  for (const [path, text] of Object.entries({ ...state.protos, ...state.requests })) files[inFolder(folder, path)] = text
  const secrets: Record<string, string> = {}
  for (const env of state.environments) {
    const keys = secretKeys(workspaceId, folder, env.name)
    secrets[keys.vars] = JSON.stringify(Object.fromEntries(env.variables.filter((v) => v.secret && v.name).map((v) => [v.name, v.value])))
    secrets[keys.creds] = JSON.stringify(env.credentials)
  }
  for (const [path, found] of Object.entries(state.requestSecrets ?? {})) secrets[requestSecretKey(workspaceId, folder, path)] = JSON.stringify(found)
  if (state.flowAuthFile) files[inFolder(folder, FLOW_AUTH_FILE)] = state.flowAuthFile
  if (state.flowAuthSecrets && hasFlowSecrets(state.flowAuthSecrets)) secrets[flowAuthKey(workspaceId, folder)] = JSON.stringify(state.flowAuthSecrets)
  if (state.collectionAuthSecrets && Object.keys(state.collectionAuthSecrets).length) secrets[collectionAuthKey(workspaceId, folder)] = JSON.stringify(state.collectionAuthSecrets)
  if (state.collectionAuthPublic) return { files, secrets, collectionAuth: { folder, json: JSON.stringify(state.collectionAuthPublic) } }
  return { files, secrets }
}

/**
 * Escribe lo que cambió respecto de lo último guardado. Los ambientes que ya no existen se borran
 * (archivo y secretos); los Arazzo, contratos y escenarios nunca se borran solos.
 */
export async function writeChanges(fs: WorkspaceFs, next: CollectionSnapshot, previous: CollectionSnapshot): Promise<void> {
  for (const [path, text] of Object.entries(next.files)) if (previous.files[path] !== text) await fs.write(path, text)
  for (const path of Object.keys(previous.files)) {
    // Ambientes y requests borrados en la app se borran del disco (los Arazzo y contratos, nunca solos).
    if (!(path in next.files) && (path.split('/').includes(ENVIRONMENTS_DIR) || isRequestPath(path) || path.split('/').pop() === FLOW_AUTH_FILE)) await fs.remove(path)
  }
  // La autorización de la colección vive en collection.yaml (sin sus secretos).
  if (next.collectionAuth && next.collectionAuth.json !== previous.collectionAuth?.json) {
    await updateCollection(fs, next.collectionAuth.folder, { auth: JSON.parse(next.collectionAuth.json) })
  }
  for (const [key, value] of Object.entries(next.secrets)) if (previous.secrets[key] !== value) await secretStore.set(key, value)
  for (const key of Object.keys(previous.secrets)) if (!(key in next.secrets)) await secretStore.remove(key)
}
