/* eslint-disable @typescript-eslint/no-explicit-any */
import { t } from '../i18n'

/** Representación corta de un valor para mensajes al usuario. */
export function fmt(v: any): string {
  if (v === undefined) return t('format.noValue')
  if (typeof v === 'string') return `"${v}"`
  const s = JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}
