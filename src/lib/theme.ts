// Tema de la app: el del sistema, claro u oscuro. Se recuerda en este equipo.
import { useEffect, useState } from 'react'
import { desktop } from './desktop'

export type Theme = 'system' | 'light' | 'dark'
export const THEMES: Theme[] = ['system', 'light', 'dark']
const KEY = 'theme'

export function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Aplica el tema a la página (y a la ventana en escritorio). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  void desktop?.appSetTheme(theme)
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState(savedTheme)
  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* sin almacenamiento: dura esta sesión */
    }
  }, [theme])
  return [theme, setTheme]
}
