/* eslint-disable @typescript-eslint/no-explicit-any */
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { deref, findResponse, jsonSchemaOfResponse, toJsonSchema, type OperationRef } from './openapi'
import { fmt } from './format'

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true, verbose: true })
addFormats(ajv)
const cache = new Map<string, ValidateFunction>()

function compile(schema: any): ValidateFunction {
  const key = JSON.stringify(schema)
  let fn = cache.get(key)
  if (!fn) {
    fn = ajv.compile(schema)
    cache.set(key, fn)
  }
  return fn
}

function where(path: string): string {
  return path ? `"${path}"` : 'la raíz de la respuesta'
}

function describeError(e: ErrorObject): string {
  const p = e.instancePath
  switch (e.keyword) {
    case 'required':
      return `Falta la propiedad obligatoria "${(e.params as any).missingProperty}" en ${where(p)}.`
    case 'type':
      return `${where(p)}: se esperaba tipo ${(e.params as any).type} y llegó ${fmt(e.data)}.`
    case 'enum':
      return `${where(p)}: el valor ${fmt(e.data)} no está entre los permitidos (${((e.params as any).allowedValues ?? []).join(', ')}).`
    case 'additionalProperties':
      return `${where(p)}: la propiedad "${(e.params as any).additionalProperty}" no está definida en el contrato.`
    case 'format':
      return `${where(p)}: ${fmt(e.data)} no tiene el formato "${(e.params as any).format}".`
    case 'pattern':
      return `${where(p)}: ${fmt(e.data)} no cumple el patrón ${(e.params as any).pattern}.`
    default:
      return `${where(p)}: ${e.message ?? 'no cumple el contrato'}.`
  }
}

/** Valida una respuesta contra el contrato. Devuelve problemas legibles (vacío = cumple). */
export function validateAgainstContract(op: OperationRef, status: number, body: any, contentType: string): string[] {
  const found = findResponse(op, status)
  if (!found) {
    return [`El código ${status} no está documentado en el contrato de ${op.method.toUpperCase()} ${op.path}.`]
  }
  const rawSchema = jsonSchemaOfResponse(found.response)
  if (!rawSchema) return []
  if (body === undefined || body === '' || body === null) {
    return [`El contrato define un body JSON para ${found.key} y la respuesta llegó vacía.`]
  }
  if (typeof body === 'string' && !/json/i.test(contentType)) {
    return [`El contrato define JSON para ${found.key} y la respuesta llegó como "${contentType || 'sin content-type'}".`]
  }
  try {
    const schema = toJsonSchema(deref(op.doc, rawSchema))
    const validate = compile(schema)
    if (validate(body)) return []
    return (validate.errors ?? []).slice(0, 8).map(describeError)
  } catch (e) {
    return [`No se pudo validar contra el schema del contrato: ${(e as Error).message}`]
  }
}
