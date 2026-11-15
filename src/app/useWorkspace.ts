/* eslint-disable @typescript-eslint/no-explicit-any */
// Workspace en disco (como Bruno): colecciones en carpetas y guardado automático de cada cambio.
import { splitAuthSecrets } from '../core/requests'
import { useEffect, useRef, useState } from 'react'
import { newEnvironment } from '../core/environments'
import { flowAuthKey, slugify, uniqueFolder, type WorkspaceManifest } from '../core/workspaceFormat'
import { FLOW_AUTH_FILE, hasFlowSecrets, renameFlowFile, serializeFlowAuth, splitFlowAuthSecrets } from '../core/flowAuth'
import { desktop } from '../lib/desktop'
import {
  browserFs,
  browserWorkspaces,
  canPickFolder,
  ensureFolderPermission,
  desktopFs,
  folderFs,
  forgetWorkspace,
  lastWorkspace,
  pickFolder,
  rememberWorkspace,
  reopen,
  type WorkspaceFs,
  type WorkspaceRef,
} from '../lib/workspaceFs'
import { secretStore } from '../lib/secrets'
import { log } from '../lib/devlog'
import { t } from '../i18n'
import type { Studio } from './useStudio'
import {
  collectionInfo,
  collectionPath,
  createCollection as createCollectionFiles,
  deleteArazzo as deleteArazzoFiles,
  openOrInitWorkspace,
  removeCollection as removeCollectionFiles,
  renameArazzo as renameArazzoFiles,
  renameCollection as renameCollectionFile,
  readCollectionDocs,
  updateCollection,
  writeCollectionDocs,
  readCollection,
  snapshotCollection,
  writeChanges,
  writeManifest,
  type CollectionInfo,
  type CollectionSnapshot,
} from './workspaceStore'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
/** Dónde se guarda un workspace nuevo. */
export type WorkspaceLocation = 'desktop' | 'folder' | 'browser'

/** Carpeta donde se crea un workspace nuevo (dentro se crea la carpeta del workspace). */
export type ParentLocation =
  | { kind: 'desktop'; path: string }
  | { kind: 'folder'; handle: any; label: string }
  | { kind: 'browser' }

const LAST_PARENT_KEY = 'ws.lastParent'
const DOCS_FILE = 'README.md'

interface Open {
  fs: WorkspaceFs
  manifest: WorkspaceManifest
  ref: WorkspaceRef
}

const EMPTY: CollectionSnapshot = { files: {}, secrets: {} }
const activeEnvKey = (ws: string, folder: string) => `ws.activeEnv.${ws}.${folder}`

function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

/** Lugares donde se puede guardar un workspace en este entorno. */
export function workspaceLocations(): WorkspaceLocation[] {
  if (desktop) return ['desktop']
  return canPickFolder() ? ['folder', 'browser'] : ['browser']
}

export function useWorkspace(studio: Studio) {
  const [open, setOpen] = useState<Open>()
  const [collections, setCollections] = useState<CollectionInfo[]>([])
  const [active, setActive] = useState<string>()
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string>()
  const [last, setLast] = useState<WorkspaceRef>()
  // Documentación del workspace (README.md en su carpeta), para el inicio.
  const [docs, setDocs] = useState<string>()
  // Documentación de la colección abierta (README.md en su carpeta).
  const [collectionDocs, setCollectionDocs] = useState<string>()
  const written = useRef<CollectionSnapshot>(EMPTY)
  // Al abrir una colección, lo leído de disco es el punto de partida: no se vuelve a escribir.
  const baseline = useRef(false)

  useEffect(() => {
    void lastWorkspace().then(setLast)
  }, [])

  const snapshot = (o: Open, folder: string) =>
    snapshotCollection(o.manifest.id, folder, {
      texts: studio.texts,
      environments: studio.environments,
      scenarios: studio.scenarioFiles(),
      requests: studio.requests.files(),
      protos: studio.requests.protos,
      requestSecrets: studio.requests.secrets(),
      collectionAuthSecrets: splitAuthSecrets(studio.requests.collectionAuth).secrets,
      collectionAuthPublic: splitAuthSecrets(studio.requests.collectionAuth).auth,
      flowAuthFile: studio.requests.flowAuthFile(),
      flowAuthSecrets: studio.requests.flowAuthSecrets(),
    })

  async function save(o: Open, snap: CollectionSnapshot) {
    setStatus('saving')
    try {
      await writeChanges(o.fs, snap, written.current)
      written.current = snap
      setStatus('saved')
      setError(undefined)
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
      log('error', t('devlog.saveFailed'), { detail: (e as Error).message })
    }
  }

  // Guardado automático: medio segundo después del último cambio, solo lo que cambió.
  useEffect(() => {
    if (!open || !active) return
    const snap = snapshot(open, active)
    if (baseline.current) {
      baseline.current = false
      written.current = snap
      return
    }
    const timer = setTimeout(() => void save(open, snap), 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, studio.texts, studio.environments, studio.cases, studio.inputs, studio.projects, studio.requests.list, studio.requests.protos, studio.requests.collectionAuth, studio.requests.flowAuth])

  // Recuerda el ambiente elegido en cada colección (en este equipo).
  useEffect(() => {
    if (open && active) writeLocal(activeEnvKey(open.manifest.id, active), studio.activeEnv.name)
  }, [open, active, studio.activeEnv.name])

  /** Guarda ya lo pendiente (antes de cambiar de colección o al pulsar Guardar). */
  async function saveNow() {
    if (open && active) await save(open, snapshot(open, active))
  }

  async function openCollection(folder: string, o: Open | undefined = open, save = true, selectFile?: string) {
    if (!o) return
    if (save && o === open && active) await saveNow()
    const data = await readCollection(o.fs, o.manifest.id, folder)
    baseline.current = true
    written.current = EMPTY
    studio.openCollectionData({ ...data, activeEnv: readLocal(activeEnvKey(o.manifest.id, folder)), selectFile })
    setCollectionDocs(await readCollectionDocs(o.fs, folder))
    log('info', t('devlog.collectionOpened', { folder, files: data.files.length, envs: data.environments.length }))
    setActive(folder)
    setStatus('idle')
  }

  async function attach(o: Open) {
    setOpen(o)
    setDocs(await o.fs.read(DOCS_FILE))
    log('info', t('devlog.workspaceOpened', { name: o.manifest.name, place: o.ref.label }))
    const ref = { ...o.ref, name: o.manifest.name }
    setLast(ref)
    await rememberWorkspace(ref)
    studio.setSessionPaused(true)
    const infos = await Promise.all(o.manifest.collections.map((f) => collectionInfo(o.fs, f)))
    setCollections(infos)
    if (infos[0]) await openCollection(infos[0].folder, o)
    else {
      studio.openCollectionData({ files: [], environments: [], scenarios: {}, requests: {}, protos: {}, flowAuth: { apis: {}, journeys: {} } })
      setActive(undefined)
    }
  }

  /** Elige dónde vive el workspace: carpeta en disco (escritorio o navegador) o el navegador. */
  async function pick(location: WorkspaceLocation, name: string, mode: 'open' | 'create'): Promise<{ fs: WorkspaceFs; ref: WorkspaceRef } | undefined> {
    if (location === 'desktop') {
      const root = await desktop?.wsPickFolder(mode)
      return root ? { fs: desktopFs(root), ref: { kind: 'desktop', root, label: root } } : undefined
    }
    if (location === 'folder') {
      const handle = await pickFolder()
      return handle ? { fs: folderFs(handle), ref: { kind: 'folder', handle, label: handle.name } } : undefined
    }
    const id = crypto.randomUUID()
    return { fs: browserFs(id, name), ref: { kind: 'browser', id, label: name } }
  }

  /** Ubicación propuesta para un workspace nuevo: la última usada o Documentos/Arazzo Studio. */
  async function defaultParent(): Promise<ParentLocation> {
    if (desktop) return { kind: 'desktop', path: readLocal(LAST_PARENT_KEY) || (await desktop.wsDefaultLocation()) }
    return { kind: 'browser' }
  }

  /** Elige otra ubicación (diálogo de carpetas). */
  async function pickParent(current?: ParentLocation): Promise<ParentLocation | undefined> {
    if (desktop) {
      const path = await desktop.wsPickLocation(current?.kind === 'desktop' ? current.path : undefined)
      return path ? { kind: 'desktop', path } : undefined
    }
    const handle = await pickFolder()
    return handle ? { kind: 'folder', handle, label: handle.name } : undefined
  }

  /**
   * Crea el workspace en `parent/folder`. Si esa carpeta ya era un workspace, se abre el que está;
   * si tenía colecciones o Arazzo sueltos, se incorporan.
   */
  async function createWorkspace(name: string, parent: ParentLocation, folder: string) {
    let picked: { fs: WorkspaceFs; ref: WorkspaceRef }
    try {
      if (parent.kind === 'desktop') {
        const root = await desktop!.wsCreateAt(parent.path, folder)
        writeLocal(LAST_PARENT_KEY, parent.path)
        picked = { fs: desktopFs(root), ref: { kind: 'desktop', root, label: root } }
      } else if (parent.kind === 'folder') {
        if (!(await ensureFolderPermission(parent.handle, true))) throw new Error(t('studio.reopenDenied'))
        const handle = await parent.handle.getDirectoryHandle(folder, { create: true })
        picked = { fs: folderFs(handle), ref: { kind: 'folder', handle, label: `${parent.label}/${folder}` } }
      } else {
        const id = crypto.randomUUID()
        picked = { fs: browserFs(id, name), ref: { kind: 'browser', id, label: name } }
      }
      await attach({ ...picked, manifest: await openOrInitWorkspace(picked.fs, name) })
    } catch (e) {
      setError((e as Error).message)
      setStatus('error')
    }
  }

  async function openWorkspace(location: WorkspaceLocation) {
    const picked = await pick(location, '', 'open')
    if (!picked) return
    const fallback = picked.ref.label.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace'
    await attach({ ...picked, manifest: await openOrInitWorkspace(picked.fs, fallback) })
  }

  /** Abre un workspace guardado en el navegador. */
  async function openBrowserWorkspace(id: string, label: string) {
    const fs = browserFs(id, label)
    await attach({ fs, ref: { kind: 'browser', id, label }, manifest: await openOrInitWorkspace(fs, label) })
  }

  /** Vuelve a abrir el último workspace (en el navegador puede pedir permiso de carpeta). */
  async function reopenLast() {
    if (!last) return
    const fs = await reopen(last, true)
    if (!fs) {
      setError(t('studio.reopenDenied'))
      return
    }
    await attach({ fs, ref: last, manifest: await openOrInitWorkspace(fs, last.label) })
  }

  async function closeWorkspace() {
    await saveNow()
    setOpen(undefined)
    setCollections([])
    setActive(undefined)
    setStatus('idle')
    studio.setSessionPaused(false)
    studio.reset()
  }

  async function forgetLast() {
    await forgetWorkspace()
    setLast(undefined)
  }

  async function createCollection(name: string) {
    if (!open) return
    await saveNow()
    const result = await createCollectionFiles(open.fs, open.manifest, name, newEnvironment('local'))
    const next = { ...open, manifest: result.manifest }
    setOpen(next)
    setCollections((prev) => [...prev, { folder: result.folder, name }])
    await openCollection(result.folder, next)
  }

  /** Cambia el nombre del workspace (en studio.yaml; la carpeta no se mueve). */
  async function renameWorkspace(name: string) {
    if (!open || !name.trim()) return
    const manifest = { ...open.manifest, name: name.trim() }
    await writeManifest(open.fs, manifest)
    const next = { ...open, manifest }
    setOpen(next)
    const ref = { ...open.ref, name: manifest.name, ...(open.ref.kind === 'browser' ? { label: manifest.name } : {}) }
    setLast(ref)
    await rememberWorkspace(ref)
  }

  /**
   * Elimina el workspace abierto: en escritorio su carpeta va a la papelera; en el navegador se
   * borra. También se borran sus secretos de este equipo. No se guarda nada pendiente.
   */
  async function deleteWorkspace() {
    if (!open) return
    const o = open
    setOpen(undefined)
    setCollections([])
    setActive(undefined)
    try {
      await o.fs.destroy()
      await secretStore.removePrefix(`${o.manifest.id}|`)
      await forgetWorkspace()
      setLast(undefined)
      setStatus('idle')
      setError(undefined)
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
    }
    studio.setSessionPaused(false)
    studio.reset()
  }

  /** Cambia la versión de una colección (vacía, la quita). */
  async function setCollectionVersion(folder: string, version: string) {
    if (!open) return
    await updateCollection(open.fs, folder, { collectionVersion: version.trim() })
    setCollections((prev) => prev.map((c) => (c.folder === folder ? { ...c, collectionVersion: version.trim() || undefined } : c)))
  }

  /** Guarda la documentación de la colección abierta. */
  async function saveCollectionDocs(text: string) {
    if (!open || !active) return
    await writeCollectionDocs(open.fs, active, text)
    setCollectionDocs(text.trim() ? text : undefined)
  }

  /** Ordena las colecciones por nombre (A-Z) y guarda ese orden en studio.yaml. */
  async function sortCollections() {
    if (!open) return
    const sorted = [...collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const manifest = { ...open.manifest, collections: sorted.map((c) => c.folder) }
    await writeManifest(open.fs, manifest)
    setOpen({ ...open, manifest })
    setCollections(sorted)
  }

  /** Guarda la documentación del workspace (README.md); vacía, borra el archivo. */
  async function saveDocs(text: string) {
    if (!open) return
    if (text.trim()) await open.fs.write(DOCS_FILE, text.endsWith('\n') ? text : `${text}\n`)
    else await open.fs.remove(DOCS_FILE)
    setDocs(text.trim() ? text : undefined)
  }

  /** Carpeta que tendrá una colección nueva con ese nombre. */
  const collectionFolderFor = (name: string) => (open ? uniqueFolder(name, open.manifest.collections) : slugify(name))

  async function renameCollection(folder: string, name: string) {
    if (!open) return
    await renameCollectionFile(open.fs, folder, name)
    setCollections((prev) => prev.map((c) => (c.folder === folder ? { ...c, name } : c)))
  }

  /** Saca una colección del workspace; con `deleteFiles`, borra también su carpeta del disco. */
  async function removeCollection(folder: string, deleteFiles: boolean) {
    if (!open) return
    if (folder === active) await saveNow()
    const manifest = await removeCollectionFiles(open.fs, open.manifest, folder, deleteFiles)
    const next = { ...open, manifest }
    setOpen(next)
    const rest = collections.filter((c) => c.folder !== folder)
    setCollections(rest)
    if (folder !== active) return
    if (rest[0]) await openCollection(rest[0].folder, next, false)
    else {
      setActive(undefined)
      studio.openCollectionData({ files: [], environments: [], scenarios: {}, requests: {}, protos: {}, flowAuth: { apis: {}, journeys: {} } })
    }
  }

  /** Vuelve a leer la colección activa del disco (tras mover o borrar archivos). */
  async function reloadActive(selectFile?: string) {
    if (!open || !active) return
    await openCollection(active, open, false, selectFile)
  }

  /** Renombra un Arazzo de la colección activa (con sus casos e inputs, que viven en sus escenarios). */
  async function renameArazzo(file: string, newName: string) {
    if (!open || !active) return
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : ''
    const to = dir + newName.trim()
    if (!newName.trim() || to === file) return
    if (studio.texts.some((f) => f.name === to)) throw new Error(t('studio.fileExists', { name: newName.trim() }))
    await saveNow()
    const text = studio.texts.find((f) => f.name === file)?.text ?? ''
    await renameArazzoFiles(open.fs, active, { from: file, to, text, scenarios: studio.scenarioFiles()[file] })
    // La autorización por journey se guarda por archivo#workflowId: sigue al archivo renombrado.
    const renamedAuth = renameFlowFile(studio.requests.flowAuth, file, to)
    const authText = serializeFlowAuth(renamedAuth)
    if (authText) await open.fs.write(collectionPath(active, FLOW_AUTH_FILE), authText)
    const authSecrets = splitFlowAuthSecrets(renamedAuth).secrets
    if (hasFlowSecrets(authSecrets)) await secretStore.set(flowAuthKey(open.manifest.id, active), JSON.stringify(authSecrets))
    await reloadActive(to)
  }

  async function deleteArazzo(file: string) {
    if (!open || !active) return
    await saveNow()
    await deleteArazzoFiles(open.fs, active, file)
    await reloadActive()
  }

  /** Muestra en Finder / el explorador una ruta de la colección activa ('' = la carpeta). */
  const reveal = open?.fs.reveal
    ? (folder: string, path = '') => void open.fs.reveal!(path ? collectionPath(folder, path) : folder === '.' ? '' : folder)
    : undefined

  return {
    isOpen: !!open,
    name: open?.manifest.name,
    location: open?.ref.label,
    kind: open?.fs.kind,
    collections,
    activeCollection: collections.find((c) => c.folder === active),
    status,
    error,
    last,
    locations: workspaceLocations(),
    createWorkspace,
    defaultParent,
    pickParent,
    collectionFolderFor,
    renameWorkspace,
    docs,
    saveDocs,
    sortCollections,
    collectionDocs,
    saveCollectionDocs,
    setCollectionVersion,
    /** Carpeta en disco de una colección (escritorio), para abrir una terminal ahí. */
    folderPath: (folder: string) => (open?.fs.kind === 'desktop' ? (folder === '.' ? open.ref.label : `${open.ref.label}/${folder}`) : undefined),
    deleteWorkspace,
    renameCollection,
    removeCollection,
    renameArazzo,
    deleteArazzo,
    reveal,
    /** Muestra la carpeta del workspace en Finder (solo escritorio). */
    revealWorkspace: open?.fs.reveal ? () => void open.fs.reveal!('') : undefined,
    openWorkspace,
    openBrowserWorkspace,
    browserWorkspaces,
    reopenLast,
    forgetLast,
    closeWorkspace,
    createCollection,
    openCollection: (folder: string) => openCollection(folder),
    saveNow,
  }
}

export type WorkspaceState = ReturnType<typeof useWorkspace>
