// Internacionalización sin dependencias. `es` es la fuente de las claves; `en` debe tener las mismas
// (lo exige TypeScript). Los textos admiten parámetros con la forma {nombre}.
import { es } from './locales/es'
import { en } from './locales/en'

export type Locale = 'es' | 'en'
export type MessageKey = keyof typeof es
export type Messages = Record<MessageKey, string>
/** Un parámetro sin valor se muestra vacío. */
export type Params = Record<string, string | number | undefined>

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
]

const DICTIONARIES: Record<Locale, Messages> = { es, en }
const STORAGE_KEY = 'arazzo-studio.locale'

function isLocale(v: unknown): v is Locale {
  return v === 'es' || v === 'en'
}

function detectLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // Almacenamiento bloqueado: se usa el idioma del navegador.
  }
  const lang = globalThis.navigator?.language ?? ''
  return lang.toLowerCase().startsWith('en') ? 'en' : 'es'
}

let current: Locale = detectLocale()
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale) {
  if (locale === current) return
  current = locale
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    // Sin almacenamiento el idioma dura solo esta sesión.
  }
  listeners.forEach((l) => l())
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Traduce una clave al idioma actual, reemplazando los {parámetros}. */
export function t(key: MessageKey, params?: Params): string {
  const text = DICTIONARIES[current][key] ?? es[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name] ?? '') : m))
}

/** Une alternativas en una lista legible: "400 o 422" / "400 or 422". */
export function joinOr(items: (string | number)[]): string {
  return items.join(t('common.or'))
}
