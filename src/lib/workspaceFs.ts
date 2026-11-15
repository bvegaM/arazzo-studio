/* eslint-disable @typescript-eslint/no-explicit-any */
// Dónde vive un workspace: en disco (app de escritorio), en una carpeta elegida en el navegador
// (Chrome y Edge) o en el almacenamiento del navegador. Las rutas son relativas al workspace, con "/".
import { desktop } from './desktop'
import { storeDelete, storeGet, storeKeys, storeSet } from './storage'

export interface FsEntry {
  name: string
  dir: boolean
}

export interface WorkspaceFs {
  kind: 'desktop' | 'folder' | 'browser'
  /** Ruta o nombre que se muestra. */
  label: string
  list(dir: string): Promise<FsEntry[]>
  /** Contenido del archivo, o undefined si no existe. */
  read(path: string): Promise<string | undefined>
  /** Escribe el archivo, creando las carpetas que falten. */
  write(path: string, text: string): Promise<void>
  remove(path: string): Promise<void>
  /** Borra una carpeta con todo su contenido. */
  removeDir(path: string): Promise<void>
  /** Solo escritorio: muestra la carpeta o el archivo en Finder / el explorador. */
  reveal?(path: string): Promise<void>
  /** Elimina el workspace entero (en escritorio, a la papelera). */
  destroy(): Promise<void>
}

/** Cómo volver a abrir el último workspace (se guarda en este equipo). */
export type WorkspaceRef = (
  | { kind: 'desktop'; root: string; label: string }
  | { kind: 'folder'; handle: any; label: string }
  | { kind: 'browser'; id: string; label: string }
) & {
  /** Nombre del workspace (el de studio.yaml) para mostrarlo. */
  name?: string
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
const parts = (path: string) => path.split('/').filter(Boolean)

/** Todos los archivos bajo `dir` (rutas relativas a `dir`), sin carpetas ocultas ni node_modules. */
export async function listFilesDeep(fs: WorkspaceFs, dir: string, depth = 6): Promise<string[]> {
  if (depth < 0) return []
  const out: string[] = []
  for (const e of await fs.list(dir)) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const path = join(dir, e.name)
    if (e.dir) out.push(...(await listFilesDeep(fs, path, depth - 1)).map((p) => join(e.name, p)))
    else out.push(e.name)
  }
  return out
}

// --- Escritorio: el proceso principal lee y escribe en disco ---

export function desktopFs(root: string): WorkspaceFs {
  const bridge = desktop!
  return {
    kind: 'desktop',
    label: root,
    list: (dir) => bridge.wsList(root, dir),
    read: (path) => bridge.wsRead(root, path),
    write: (path, text) => bridge.wsWrite(root, path, text),
    remove: (path) => bridge.wsRemove(root, path),
    removeDir: (path) => bridge.wsRemoveDir(root, path),
    reveal: (path) => bridge.wsReveal(root, path),
    destroy: () => bridge.wsTrash(root),
  }
}

// --- Navegador con carpeta real (File System Access API: Chrome y Edge) ---

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Pide al usuario una carpeta con permiso de escritura. */
export async function pickFolder(): Promise<any | undefined> {
  try {
    return await (window as any).showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return undefined
  }
}

/** Confirma el permiso de escritura de una carpeta guardada (puede pedirlo; requiere un clic). */
export async function ensureFolderPermission(handle: any, ask: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission?.(opts)) === 'granted') return true
  return ask ? (await handle.requestPermission?.(opts)) === 'granted' : false
}

export function folderFs(root: any): WorkspaceFs {
  const dirHandle = async (path: string, create: boolean) => {
    let h = root
    for (const p of parts(path)) h = await h.getDirectoryHandle(p, { create })
    return h
  }
  const split = (path: string) => {
    const ps = parts(path)
    return { dir: ps.slice(0, -1).join('/'), name: ps[ps.length - 1] }
  }
  return {
    kind: 'folder',
    label: root.name,
    async list(dir) {
      try {
        const h = await dirHandle(dir, false)
        const out: FsEntry[] = []
        for await (const [name, entry] of h.entries()) out.push({ name, dir: entry.kind === 'directory' })
        return out
      } catch {
        return []
      }
    },
    async read(path) {
      try {
        const { dir, name } = split(path)
        const file = await (await (await dirHandle(dir, false)).getFileHandle(name)).getFile()
        return await file.text()
      } catch {
        return undefined
      }
    },
    async write(path, text) {
      const { dir, name } = split(path)
      const handle = await (await dirHandle(dir, true)).getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    async remove(path) {
      try {
        const { dir, name } = split(path)
        await (await dirHandle(dir, false)).removeEntry(name)
      } catch {
        /* ya no existía */
      }
    },
    async removeDir(path) {
      try {
        const { dir, name } = split(path)
        await (await dirHandle(dir, false)).removeEntry(name, { recursive: true })
      } catch {
        /* ya no existía */
      }
    },
    async destroy() {
      // Chrome permite borrar la carpeta elegida; si no, se vacía.
      if (typeof root.remove === 'function') return root.remove({ recursive: true })
      for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true })
    },
  }
}

// --- Navegador sin acceso a carpetas: los archivos viven en IndexedDB ---

const browserKey = (id: string, path: string) => `wsfs/${id}/${path}`

export function browserFs(id: string, label: string): WorkspaceFs {
  const prefix = browserKey(id, '')
  return {
    kind: 'browser',
    label,
    async list(dir) {
      const base = dir ? `${dir}/` : ''
      const entries = new Map<string, boolean>()
      for (const key of await storeKeys(prefix + base)) {
        const rest = key.slice(prefix.length + base.length).split('/')
        entries.set(rest[0], rest.length > 1 || entries.get(rest[0]) === true)
      }
      return [...entries].map(([name, dir]) => ({ name, dir }))
    },
    read: (path) => storeGet<string>(browserKey(id, path)),
    write: async (path, text) => {
      await storeSet(browserKey(id, path), text)
    },
    remove: async (path) => {
      await storeDelete(browserKey(id, path))
    },
    removeDir: async (path) => {
      for (const key of await storeKeys(browserKey(id, `${path}/`))) await storeDelete(key)
    },
    destroy: async () => {
      for (const key of await storeKeys(prefix)) await storeDelete(key)
    },
  }
}

/** Workspaces guardados en el navegador (sin carpeta en disco). */
export async function browserWorkspaces(): Promise<{ id: string; label: string }[]> {
  const ids = new Set((await storeKeys('wsfs/')).map((k) => k.split('/')[1]))
  const out: { id: string; label: string }[] = []
  for (const id of ids) {
    const text = await storeGet<string>(browserKey(id, 'studio.yaml'))
    const name = text?.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    if (name) out.push({ id, label: name.replace(/^["']|["']$/g, '') })
  }
  return out
}

// --- Último workspace abierto ---

const LAST_KEY = 'lastWorkspace'

export const rememberWorkspace = (ref: WorkspaceRef) => storeSet(LAST_KEY, ref)
export const forgetWorkspace = () => storeDelete(LAST_KEY)
export const lastWorkspace = () => storeGet<WorkspaceRef>(LAST_KEY)

/** Vuelve a abrir un workspace guardado. `ask` permite pedir permiso de carpeta (requiere un clic). */
export async function reopen(ref: WorkspaceRef, ask: boolean): Promise<WorkspaceFs | undefined> {
  if (ref.kind === 'desktop') return desktop ? desktopFs(ref.root) : undefined
  if (ref.kind === 'browser') return browserFs(ref.id, ref.label)
  return (await ensureFolderPermission(ref.handle, ask)) ? folderFs(ref.handle) : undefined
}
