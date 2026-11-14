/* eslint-disable @typescript-eslint/no-explicit-any */
// $ref externos ('schemas.yaml#/Member', './common/errors.yaml'): se reemplazan por el contenido
// del archivo referenciado, que tiene que estar entre los cargados. Las referencias locales (#/...)
// del documento principal se dejan como están; las de un archivo externo se resuelven contra ese archivo.
import { getByPointer } from './jsonPointer'

export interface RefFile {
  name: string
  doc?: any
}

export interface BundleResult {
  doc: any
  /** Archivos (o archivo#puntero) referenciados que no se encontraron. */
  missing: string[]
}

/** Último segmento de una ruta o URL, sin query ni fragmento. */
function fileName(urlOrPath: string): string {
  const clean = urlOrPath.split('#')[0].split('?')[0]
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] ?? clean
}

/** Si el documento tiene algún $ref que apunta a otro archivo. */
export function hasExternalRefs(node: any, depth = 0): boolean {
  if (depth > 60 || node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((n) => hasExternalRefs(n, depth + 1))
  if (typeof node.$ref === 'string' && !node.$ref.startsWith('#')) return true
  return Object.values(node).some((v) => hasExternalRefs(v, depth + 1))
}

/** Reemplaza los $ref externos de `doc` (archivo `name`) por su contenido, buscándolo en `files`. */
export function bundleExternalRefs(doc: any, name: string, files: RefFile[]): BundleResult {
  if (!hasExternalRefs(doc)) return { doc, missing: [] }
  const missing = new Set<string>()
  const byName = new Map<string, RefFile>()
  for (const f of files) if (f.doc !== undefined) byName.set(fileName(f.name), f)
  const root: RefFile = { name, doc }

  // `file` es el archivo donde está escrito `node`: sus referencias locales apuntan a ese archivo.
  const resolve = (node: any, file: RefFile, seen: string[], depth: number): any => {
    if (depth > 60 || node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((n) => resolve(n, file, seen, depth + 1))
    if (typeof node.$ref === 'string') {
      const ref: string = node.$ref
      const hash = ref.indexOf('#')
      const filePart = hash >= 0 ? ref.slice(0, hash) : ref
      const pointer = hash >= 0 ? ref.slice(hash + 1) : ''
      // Referencia local del documento principal: la resuelve deref() cuando se usa.
      if (!filePart && file === root) return resolveSiblings(node, file, seen, depth)
      const target = filePart ? byName.get(fileName(filePart)) : file
      if (!target) {
        missing.add(filePart)
        return node
      }
      const key = `${fileName(target.name)}#${pointer}`
      if (seen.includes(key)) return {} // ciclo: se corta
      const found = getByPointer(target.doc, pointer)
      if (!found.found) {
        missing.add(`${filePart || fileName(file.name)}#${pointer}`)
        return node
      }
      const { $ref: _ignored, ...siblings } = node
      void _ignored
      const value = resolve(found.value, target, [...seen, key], depth + 1)
      const rest = resolve(siblings, file, seen, depth + 1)
      return value && typeof value === 'object' && !Array.isArray(value) ? { ...value, ...rest } : value
    }
    return resolveSiblings(node, file, seen, depth)
  }
  const resolveSiblings = (node: any, file: RefFile, seen: string[], depth: number): any => {
    const out: any = {}
    for (const [k, v] of Object.entries(node)) out[k] = resolve(v, file, seen, depth + 1)
    return out
  }

  return { doc: resolve(doc, root, [], 0), missing: [...missing] }
}
