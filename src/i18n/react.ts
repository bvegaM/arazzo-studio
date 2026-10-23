import { useSyncExternalStore } from 'react'
import { getLocale, subscribeLocale, type Locale } from '.'

/** Idioma actual; el componente se vuelve a renderizar cuando cambia. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale)
}
