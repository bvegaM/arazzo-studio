/* eslint-disable @typescript-eslint/no-explicit-any */
// Utilidades de JSON Pointer (RFC 6901), compartidas por el motor.

export function decodePointerSegment(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Lee el valor en un JSON pointer (acepta prefijo '#'). */
export function getByPointer(obj: any, pointer: string): { found: boolean; value: any } {
  if (pointer === '' || pointer === '/') return { found: obj !== undefined, value: obj }
  const segs = pointer.replace(/^#?\//, '').split('/').map(decodePointerSegment)
  let cur = obj
  for (const seg of segs) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return { found: false, value: undefined }
    if (!(seg in cur)) return { found: false, value: undefined }
    cur = cur[seg]
  }
  return { found: true, value: cur }
}

/** Escribe un valor en un JSON pointer, creando objetos intermedios. */
export function setByPointer(target: any, pointer: string, value: any): any {
  const segs = pointer.replace(/^#?\//, '').split('/').map(decodePointerSegment)
  if (segs.length === 1 && segs[0] === '') return value
  const root = target && typeof target === 'object' ? target : {}
  let cur = root
  segs.forEach((seg, i) => {
    if (i === segs.length - 1) cur[seg] = value
    else {
      if (cur[seg] === null || typeof cur[seg] !== 'object') cur[seg] = /^\d+$/.test(segs[i + 1]) ? [] : {}
      cur = cur[seg]
    }
  })
  return root
}
