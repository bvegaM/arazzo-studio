import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { getLocale, subscribeLocale, t, type Locale, type MessageKey, type Params } from '.'

/** Idioma actual; el componente se vuelve a renderizar cuando cambia. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale)
}

/**
 * Como t(), pero los {parámetros} pueden ser elementos de React, por ejemplo
 * tn('clave', { code: <code>x</code> }) para un texto con formato en medio.
 */
export function tn(key: MessageKey, nodes: Record<string, ReactNode>, params?: Params): ReactNode {
  const parts = t(key, params).split(/\{(\w+)\}/g)
  return createElement(Fragment, null, ...parts.map((part, i) => (i % 2 === 1 && part in nodes ? nodes[part] : part)))
}
