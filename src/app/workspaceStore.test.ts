import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFs } from '../lib/workspaceFs'

const removed: string[] = []
vi.mock('../lib/secrets', () => ({
  secretStore: { get: async () => undefined, set: async () => {}, remove: async (k: string) => void removed.push(k), removePrefix: async () => {} },
}))

const { createCollection, deleteArazzo, openOrInitWorkspace, removeCollection, renameArazzo, renameCollection, collectionInfo } = await import('./workspaceStore')
const { newEnvironment } = await import('../core/environments')

/** Sistema de archivos en memoria con rutas relativas al workspace. */
function memoryFs(): WorkspaceFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    kind: 'browser',
    label: 'mem',
    files,
    async list(dir) {
      const base = dir ? `${dir}/` : ''
      const out = new Map<string, boolean>()
      for (const k of files.keys()) {
        if (!k.startsWith(base)) continue
        const rest = k.slice(base.length).split('/')
        out.set(rest[0], rest.length > 1)
      }
      return [...out].map(([name, dir]) => ({ name, dir }))
    },
    read: async (p) => files.get(p),
    write: async (p, text) => void files.set(p, text),
    remove: async (p) => void files.delete(p),
    removeDir: async (p) => {
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k)
    },
    destroy: async () => files.clear(),
  }
}

describe('operaciones del workspace', () => {
  it('renombra una colección sin mover su carpeta', async () => {
    const fs = memoryFs()
    const ws = await openOrInitWorkspace(fs, 'WS')
    const { folder } = await createCollection(fs, ws, 'Cobrand', newEnvironment('local'))
    await renameCollection(fs, folder, 'Cobrand LatAm')
    expect(await collectionInfo(fs, folder)).toEqual({ folder: 'cobrand', name: 'Cobrand LatAm' })
  })

  it('quitar del workspace deja la carpeta; eliminar la borra con sus secretos', async () => {
    const fs = memoryFs()
    let ws = await openOrInitWorkspace(fs, 'WS')
    ws = (await createCollection(fs, ws, 'A', newEnvironment('local'))).manifest
    ws = (await createCollection(fs, ws, 'B', newEnvironment('prod'))).manifest
    ws = await removeCollection(fs, ws, 'a', false)
    expect(ws.collections).toEqual(['b'])
    expect(fs.files.has('a/collection.yaml')).toBe(true)
    ws = await removeCollection(fs, ws, 'b', true)
    expect(ws.collections).toEqual([])
    expect([...fs.files.keys()].some((k) => k.startsWith('b/'))).toBe(false)
    expect(removed).toEqual([`${ws.id}|b|prod|var|*`, `${ws.id}|b|prod|cred|*`])
    expect(fs.files.get('studio.yaml')).not.toContain('- b')
  })

  it('renombra y borra un Arazzo junto con sus escenarios', async () => {
    const fs = memoryFs()
    fs.files.set('p/flows/a.arazzo.yaml', 'old')
    fs.files.set('p/scenarios/flows/a.arazzo.yaml', 'sc-old')
    await renameArazzo(fs, 'p', { from: 'flows/a.arazzo.yaml', to: 'flows/b.arazzo.yaml', text: 'new', scenarios: 'sc-new' })
    expect(Object.fromEntries(fs.files)).toEqual({ 'p/flows/b.arazzo.yaml': 'new', 'p/scenarios/flows/b.arazzo.yaml': 'sc-new' })
    await deleteArazzo(fs, 'p', 'flows/b.arazzo.yaml')
    expect(fs.files.size).toBe(0)
  })
})
