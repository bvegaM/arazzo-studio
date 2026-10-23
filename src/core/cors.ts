// Ayuda para fallas de conexión: qué headers CORS debe devolver la API para estas peticiones.

export interface FailedRequest {
  method: string
  url: string
  headers: Record<string, string>
}

// Headers que el navegador envía sin pedir permiso (no hace falta listarlos).
const SIMPLE_HEADERS = new Set(['accept', 'accept-language', 'content-language'])

/** Headers que la API debe responder para aceptar estas peticiones desde `origin`. */
export function corsHeadersFor(requests: FailedRequest[], origin: string): string {
  const methods = [...new Set(requests.map((r) => r.method.toUpperCase()))]
  const headers = [...new Set(requests.flatMap((r) => Object.keys(r.headers)).filter((h) => !SIMPLE_HEADERS.has(h.toLowerCase())))]
  return [
    `Access-Control-Allow-Origin: ${origin}`,
    `Access-Control-Allow-Methods: ${[...methods, 'OPTIONS'].join(', ')}`,
    headers.length ? `Access-Control-Allow-Headers: ${headers.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Orígenes (esquema + host) a los que se intentó llegar, sin repetir. */
export function targetOrigins(requests: FailedRequest[]): string[] {
  return [...new Set(requests.map((r) => URL.canParse(r.url) ? new URL(r.url).origin : r.url))]
}

/** true si la página es https y la API http: el navegador bloquea esas llamadas. */
export function isMixedContent(pageProtocol: string, url: string): boolean {
  return pageProtocol === 'https:' && url.startsWith('http:')
}
