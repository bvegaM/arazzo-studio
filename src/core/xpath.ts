/* eslint-disable @typescript-eslint/no-explicit-any */
// XPath 1.0 sobre respuestas y payloads XML (APIs SOAP o application/xml): criterios, selectores y
// reemplazos. Sin DOM del navegador, para que el motor funcione igual en Node y en la app.
// Las librerías se cargan solo cuando un Arazzo usa XPath (loadXPath), fuera de la carga inicial.

let lib: { DOMParser: any; XMLSerializer: any; xpath: any } | undefined

/** Carga las librerías de XPath (una sola vez). El runner lo hace si el Arazzo usa XPath. */
export async function loadXPath(): Promise<void> {
  if (lib) return
  const [x, dom] = await Promise.all([import('xpath'), import('@xmldom/xmldom')])
  lib = { xpath: (x as any).default ?? x, DOMParser: dom.DOMParser, XMLSerializer: dom.XMLSerializer }
}

export const xpathReady = () => !!lib

/** true si el documento Arazzo menciona XPath (criterios, selectores o reemplazos). */
export const usesXPath = (doc: unknown) => /"xpath(-\d+)?"/i.test(JSON.stringify(doc ?? {}))

export interface XPathResult {
  found: boolean
  value: any
  /** Nodos encontrados (0 si la expresión devuelve un texto, número o booleano). */
  count: number
}

/** Lee un XML; undefined si no es XML válido. */
export function parseXml(text: unknown): Document | undefined {
  if (!lib || typeof text !== 'string' || !text.trim().startsWith('<')) return undefined
  let failed = false
  const doc = new lib.DOMParser({
    onError: (level: string) => {
      if (level !== 'warning') failed = true
    },
  }).parseFromString(text, 'text/xml')
  return failed || !doc.documentElement ? undefined : (doc as unknown as Document)
}

const nodeValue = (node: any): string => (node?.nodeType === 2 ? node.value : (node?.textContent ?? ''))

/** Evalúa una expresión XPath 1.0. El valor es el texto del primer nodo (o el resultado escalar). */
export function selectXPath(source: unknown, expr: string): XPathResult {
  const doc = typeof source === 'string' ? parseXml(source) : source
  if (!doc || !lib) return { found: false, value: undefined, count: 0 }
  const out = lib.xpath.select(expr, doc as any) as any
  if (Array.isArray(out)) return out.length ? { found: true, value: nodeValue(out[0]), count: out.length } : { found: false, value: undefined, count: 0 }
  if (typeof out === 'boolean') return { found: out, value: out, count: 0 }
  return { found: out !== '' && !(typeof out === 'number' && Number.isNaN(out)), value: out, count: 0 }
}

/** Reemplaza el texto de los nodos que selecciona la expresión; devuelve el XML y cuántos cambió. */
export function replaceXPath(xml: string, expr: string, value: unknown): { xml: string; count: number } {
  const doc = parseXml(xml)
  if (!doc || !lib) return { xml, count: 0 }
  const nodes = lib.xpath.select(expr, doc as any) as any
  if (!Array.isArray(nodes) || !nodes.length) return { xml, count: 0 }
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
  for (const node of nodes) {
    if (node.nodeType === 2) node.value = text
    else node.textContent = text
  }
  return { xml: new lib.XMLSerializer().serializeToString(doc as any), count: nodes.length }
}
