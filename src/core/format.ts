/* eslint-disable @typescript-eslint/no-explicit-any */
import { t } from '../i18n'

/** Representación corta de un valor para mensajes al usuario. */
export function fmt(v: any): string {
  if (v === undefined) return t('format.noValue')
  if (typeof v === 'string') return `"${v}"`
  const s = JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}

/**
 * Convierte un identificador en texto legible: "startCobrandedLifeCycle" → "Start cobranded life cycle".
 * Respeta siglas ("getHTTPStatus" → "Get HTTP status") y separa también guiones y guiones bajos.
 */
export function humanizeId(id: string): string {
  const words = id
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return id
  return words
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase()) return w
      const lower = w.toLowerCase()
      return i === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}
