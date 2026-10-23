/* eslint-disable @typescript-eslint/no-explicit-any */
/** Representación corta de un valor para mensajes al usuario. */
export function fmt(v: any): string {
  if (v === undefined) return 'sin valor'
  if (typeof v === 'string') return `"${v}"`
  const s = JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 77) + '…' : s
}
