// Almacenamiento clave-valor en IndexedDB (admite contratos grandes, a diferencia de localStorage).
// Si el navegador lo bloquea (modo privado, permisos), las funciones fallan en silencio.

const DB_NAME = 'arazzo-studio'
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await openDb()
    return await new Promise<T>((resolve, reject) => {
      const req = action(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    }).finally(() => db.close())
  } catch {
    return undefined
  }
}

export const storeGet = <T>(key: string) => run<T>('readonly', (s) => s.get(key))
export const storeSet = (key: string, value: unknown) => run<void>('readwrite', (s) => s.put(value, key))
export const storeDelete = (key: string) => run<void>('readwrite', (s) => s.delete(key))
