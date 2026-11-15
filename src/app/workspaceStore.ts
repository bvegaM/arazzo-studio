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
  serializeCollection,
  serializeEnvironment,
  serializeWorkspace,
  uniqueFolder,
  type WorkspaceManifest,
} from '../core/workspaceFormat'
import { secretStore } from '../lib/secrets'
import { listFilesDeep, type WorkspaceFs } from '../lib/workspaceFs'

export interface CollectionInfo {
  /** Carpeta relativa al workspace ("." = la raíz del workspace). */
  folder: string
  name: string
}

export interface CollectionData {
  files: LoadedFile[]
  environments: Environment[]
  /** Archivo de escenarios por Arazzo (ruta del Arazzo → texto). */
  scenarios: Record<string, string>
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

/** Cambia el nombre visible de una colección (la carpeta no se mueve). */
export async function renameCollection(fs: WorkspaceFs, folder: string, name: string): Promise<void> {
  const text = await fs.read(inFolder(folder, COLLECTION_FILE))
  const current = text === undefined ? {} : parseCollection(text, name)
  await fs.write(inFolder(folder, COLLECTION_FILE), serializeCollection({ ...current, name }))
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
  return { folder, name: text === undefined ? fallback : parseCollection(text, fallback).name }
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
  for (const path of paths) {
    const text = await fs.read(inFolder(folder, path))
    if (text === undefined) continue
    if (path.startsWith(`${ENVIRONMENTS_DIR}/`) && /\.ya?ml$/i.test(path)) {
      try {
        environments.push(await readSecrets(workspaceId, folder, parseEnvironment(text, baseName(path).replace(/\.ya?ml$/i, ''))))
      } catch {
        /* un ambiente ilegible no impide abrir la colección */
      }
    } else if (path.startsWith(`${SCENARIOS_DIR}/`)) {
      scenarios[path.slice(SCENARIOS_DIR.length + 1)] = text
    } else if (isCollectionContentPath(path)) {
      files.push({ name: path, text })
    }
  }
  return { files, environments, scenarios }
}

/** Lo que hay que escribir de una colección: contenido, ambientes y escenarios, por ruta. */
export interface CollectionSnapshot {
  files: Record<string, string>
  /** Secretos por clave (JSON de cada ambiente). */
  secrets: Record<string, string>
}

export function snapshotCollection(
  workspaceId: string,
  folder: string,
  state: { texts: LoadedFile[]; environments: Environment[]; scenarios: Record<string, string> },
): CollectionSnapshot {
  const files: Record<string, string> = {}
  for (const f of state.texts) files[inFolder(folder, f.name)] = f.text
  for (const env of state.environments) files[inFolder(folder, environmentPath(env))] = serializeEnvironment(env)
  for (const [arazzo, text] of Object.entries(state.scenarios)) files[inFolder(folder, `${SCENARIOS_DIR}/${arazzo}`)] = text
  const secrets: Record<string, string> = {}
  for (const env of state.environments) {
    const keys = secretKeys(workspaceId, folder, env.name)
    secrets[keys.vars] = JSON.stringify(Object.fromEntries(env.variables.filter((v) => v.secret && v.name).map((v) => [v.name, v.value])))
    secrets[keys.creds] = JSON.stringify(env.credentials)
  }
  return { files, secrets }
}

/**
 * Escribe lo que cambió respecto de lo último guardado. Los ambientes que ya no existen se borran
 * (archivo y secretos); los Arazzo, contratos y escenarios nunca se borran solos.
 */
export async function writeChanges(fs: WorkspaceFs, next: CollectionSnapshot, previous: CollectionSnapshot): Promise<void> {
  for (const [path, text] of Object.entries(next.files)) if (previous.files[path] !== text) await fs.write(path, text)
  for (const path of Object.keys(previous.files)) {
    if (!(path in next.files) && path.split('/').includes(ENVIRONMENTS_DIR)) await fs.remove(path)
  }
  for (const [key, value] of Object.entries(next.secrets)) if (previous.secrets[key] !== value) await secretStore.set(key, value)
  for (const key of Object.keys(previous.secrets)) if (!(key in next.secrets)) await secretStore.remove(key)
}
