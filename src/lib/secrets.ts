// Secretos y credenciales de los ambientes, guardados cifrados en este equipo (nunca en los archivos
// del workspace). En escritorio los cifra el sistema operativo (safeStorage de Electron); en el
// navegador, WebCrypto con una clave que no se puede exportar.
import { desktop } from './desktop'
import { storeDelete, storeGet, storeKeys, storeSet } from './storage'

export interface SecretStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  /** Borra todos los secretos cuya clave empieza con `prefix`. */
  removePrefix(prefix: string): Promise<void>
}

const KEY_NAME = 'secretKey'
const entry = (key: string) => `secret/${key}`

async function browserKey(): Promise<CryptoKey | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined
  const saved = await storeGet<CryptoKey>(KEY_NAME)
  if (saved) return saved
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await storeSet(KEY_NAME, key)
  return key
}

const browserSecrets: SecretStore = {
  async get(key) {
    const saved = await storeGet<{ iv: Uint8Array; data: ArrayBuffer }>(entry(key))
    const k = saved && (await browserKey())
    if (!saved || !k) return undefined
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: saved.iv as BufferSource }, k, saved.data))
    } catch {
      return undefined
    }
  },
  async set(key, value) {
    const k = await browserKey()
    if (!k) return
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(value))
    await storeSet(entry(key), { iv, data })
  },
  async remove(key) {
    await storeDelete(entry(key))
  },
  async removePrefix(prefix) {
    if (!prefix) return
    for (const k of await storeKeys(entry(prefix))) await storeDelete(k)
  },
}

const desktopSecrets: SecretStore = {
  get: (key) => desktop!.secretGet(key),
  set: (key, value) => desktop!.secretSet(key, value),
  remove: (key) => desktop!.secretRemove(key),
  removePrefix: (prefix) => desktop!.secretRemovePrefix(prefix),
}

export const secretStore: SecretStore = desktop ? desktopSecrets : browserSecrets
