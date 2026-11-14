/* eslint-disable @typescript-eslint/no-explicit-any */
// Operaciones de un AsyncAPI (2.x y 3.x) en el mismo formato que las de OpenAPI, para que el análisis,
// el diagrama y el runner las traten igual. method = 'send' | 'receive' y path = dirección del canal.
import { decodePointerSegment } from './jsonPointer'
import { deref, type OperationRef } from './openapi'
import type { SourceState } from './loader'

export interface AsyncMessage {
  name?: string
  payload?: any
  headers?: any
  examples: { headers?: any; payload?: any }[]
  /** Dónde viaja el identificador de correlación: '$message.header#/correlationId'. */
  correlationLocation?: string
}

export function isAsyncApi(doc: any): boolean {
  return !!doc && typeof doc === 'object' && doc.asyncapi !== undefined
}

/** El schema del payload (en 3.x puede venir envuelto en { schemaFormat, schema }). */
function payloadSchema(payload: any): any {
  return payload && typeof payload === 'object' && payload.schemaFormat && payload.schema ? payload.schema : payload
}

function toMessage(raw: any): AsyncMessage {
  return {
    name: raw?.name ?? raw?.title,
    payload: payloadSchema(raw?.payload),
    headers: payloadSchema(raw?.headers),
    examples: Array.isArray(raw?.examples) ? raw.examples : [],
    correlationLocation: raw?.correlationId?.location,
  }
}

/** Los mensajes de una operación, desplegando oneOf (2.x). */
function messagesOf(doc: any, raw: any): AsyncMessage[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.flatMap((m) => {
    const msg = deref(doc, m)
    return Array.isArray(msg?.oneOf) ? msg.oneOf.map((x: any) => toMessage(deref(doc, x))) : [toMessage(msg)]
  })
}

/** Nombre del canal a partir de un $ref '#/channels/<nombre>'. */
function channelNameFromRef(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined
  const m = ref.match(/^#\/channels\/([^/]+)$/)
  return m ? decodePointerSegment(m[1]) : undefined
}

export function listAsyncOperations(source: SourceState): OperationRef[] {
  const doc = source.doc
  if (!isAsyncApi(doc)) return []
  const ops: OperationRef[] = []
  const base = { sourceName: source.name, doc, protocol: 'async' as const }

  if (String(doc.asyncapi).startsWith('2')) {
    // 2.x: publish = el cliente envía al canal; subscribe = el cliente recibe de él.
    for (const [address, rawChannel] of Object.entries<any>(doc.channels ?? {})) {
      const channel = deref(doc, rawChannel)
      for (const [key, method] of [['publish', 'send'], ['subscribe', 'receive']] as const) {
        const op = channel?.[key]
        if (!op) continue
        ops.push({
          ...base,
          method,
          path: address,
          channel: address,
          pointer: `/channels/${address.replace(/~/g, '~0').replace(/\//g, '~1')}/${key}`,
          operationId: op.operationId,
          operation: op,
          pathItem: channel,
          messages: messagesOf(doc, op.message),
        })
      }
    }
    return ops
  }

  // 3.x: operations con action send/receive y una referencia al canal.
  for (const [key, rawOp] of Object.entries<any>(doc.operations ?? {})) {
    const op = deref(doc, rawOp)
    const channelName = channelNameFromRef(rawOp?.channel?.$ref) ?? ''
    const channel = deref(doc, rawOp?.channel ?? {})
    const messages = messagesOf(doc, rawOp?.messages?.length ? rawOp.messages : Object.values(channel?.messages ?? {}))
    ops.push({
      ...base,
      method: op?.action === 'receive' ? 'receive' : 'send',
      path: channel?.address ?? channelName,
      channel: channelName,
      pointer: `/operations/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      operationId: key,
      operation: op,
      pathItem: channel,
      messages,
    })
  }
  return ops
}
