/* eslint-disable @typescript-eslint/no-explicit-any */
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { deref, findResponse, jsonSchemaOfResponse, toJsonSchema, type OperationRef } from './openapi'
import { fmt } from './format'
import { t } from '../i18n'

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
  return path ? `"${path}"` : t('contract.root')
}

function describeError(e: ErrorObject): string {
  const p = e.instancePath
  switch (e.keyword) {
    case 'required':
      return t('contract.required', { prop: (e.params as any).missingProperty, where: where(p) })
    case 'type':
      return t('contract.type', { where: where(p), type: (e.params as any).type, value: fmt(e.data) })
    case 'enum':
      return t('contract.enum', { where: where(p), value: fmt(e.data), allowed: ((e.params as any).allowedValues ?? []).join(', ') })
    case 'additionalProperties':
      return t('contract.additional', { where: where(p), prop: (e.params as any).additionalProperty })
    case 'format':
      return t('contract.format', { where: where(p), value: fmt(e.data), format: (e.params as any).format })
    case 'pattern':
      return t('contract.pattern', { where: where(p), value: fmt(e.data), pattern: (e.params as any).pattern })
    default:
      return `${where(p)}: ${e.message ?? t('contract.generic')}.`
  }
}

/** Valida una respuesta contra el contrato. Devuelve problemas legibles (vacío = cumple). */
export function validateAgainstContract(op: OperationRef, status: number, body: any, contentType: string): string[] {
  const found = findResponse(op, status)
  if (!found) {
    return [t('contract.undocumented', { status, op: `${op.method.toUpperCase()} ${op.path}` })]
  }
  const rawSchema = jsonSchemaOfResponse(found.response)
  if (!rawSchema) return []
  if (body === undefined || body === '' || body === null) {
    return [t('contract.empty', { status: found.key })]
  }
  if (typeof body === 'string' && !/json/i.test(contentType)) {
    return [t('contract.notJson', { status: found.key, contentType: contentType || t('contract.noContentType') })]
  }
  try {
    const schema = toJsonSchema(deref(op.doc, rawSchema))
    const validate = compile(schema)
    if (validate(body)) return []
    return (validate.errors ?? []).slice(0, 8).map(describeError)
  } catch (e) {
    return [t('contract.validationError', { error: (e as Error).message })]
  }
}
