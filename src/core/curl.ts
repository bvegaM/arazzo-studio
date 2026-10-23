/* eslint-disable @typescript-eslint/no-explicit-any */
// Convierte una petición en un comando cURL para reproducirla fuera de la herramienta.

export interface CurlRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: any
}

/** Marcador que reemplaza a un valor enmascarado ("Bearer ab••••yz" → "Bearer <secret>"). */
export const SECRET_PLACEHOLDER = '<secret>'

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const unmask = (s: string) => s.replace(/[^\s&=?]*••••[^\s&=]*/g, SECRET_PLACEHOLDER)

function bodyText(body: any, contentType: string): string | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return body
  if (/x-www-form-urlencoded/i.test(contentType) && typeof body === 'object') {
    return new URLSearchParams(Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
  }
  return JSON.stringify(body, null, 2)
}

/**
 * Comando cURL de varias líneas. Si la petición viene enmascarada, los secretos
 * quedan como <secret> para que se note qué hay que completar.
 */
export function toCurl(req: CurlRequest): string {
  const method = req.method.toUpperCase()
  const lines = [`curl ${method === 'GET' ? '' : `-X ${method} `}${quote(unmask(req.url))}`]
  const contentType = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  for (const [k, v] of Object.entries(req.headers)) lines.push(`-H ${quote(`${k}: ${unmask(v)}`)}`)
  const body = bodyText(req.body, contentType)
  if (body !== undefined) lines.push(`--data-raw ${quote(body)}`)
  return lines.join(' \\\n  ')
}

/** true si la petición tiene valores enmascarados. */
export function hasMaskedValues(req: CurlRequest): boolean {
  return req.url.includes('••••') || Object.values(req.headers).some((v) => v.includes('••••'))
}
