/* eslint-disable @typescript-eslint/no-explicit-any */
// Probar una operación del contrato por sí sola, como en un cliente de APIs. No hay un motor aparte:
// se arma en memoria un Arazzo de un solo paso que llama a esa operación y se ejecuta con el runner,
// así la petición, las credenciales, la simulación y la validación contra el contrato son las mismas
// que en un journey.
import { analyzeProject, type ProjectAnalysis } from './analyze'
import type { Project, SourceState } from './loader'
import { deref, operationParameters, operationRequestBody, type OperationRef } from './openapi'
import { exampleFromSchema } from './simulator'
import type { ArazzoDoc } from './types'
import { t } from '../i18n'

export interface TryParam {
  name: string
  in: string
  required: boolean
  description?: string
  schema?: any
  /** Texto escrito por el usuario; admite {{variables}} del ambiente. */
  value: string
}

export interface TryForm {
  params: TryParam[]
  /** Body como texto (JSON normalmente); admite {{variables}}. */
  body?: string
  contentType?: string
}

export const TRY_WORKFLOW = 'try'
export const TRY_STEP = 'request'

/** El paso se llama como la operación (así se reconoce en Network y en Console). */
const stepIdFor = (op: OperationRef) => (op.operationId && /^[A-Za-z0-9_-]+$/.test(op.operationId) ? op.operationId : TRY_STEP)

/** Clave estable de una operación: fuente, método y ruta. */
export const tryKey = (op: Pick<OperationRef, 'sourceName' | 'method' | 'path'>) => `${op.sourceName}|${op.method.toUpperCase()}|${op.path}`

const asText = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function firstExample(media: any): unknown {
  if (media?.example !== undefined) return media.example
  const first = Object.values<any>(media?.examples ?? {})[0]
  return first?.value
}

/** Body de ejemplo del contrato (o generado desde su schema), listo para editar. */
export function exampleRequestBody(op: OperationRef): { body?: string; contentType?: string } {
  const rb = operationRequestBody(op)
  const content = rb?.content ?? {}
  const contentType = Object.keys(content).find((k) => /json/i.test(k)) ?? Object.keys(content)[0]
  if (!contentType) return {}
  const media = content[contentType]
  const example = firstExample(media) ?? exampleFromSchema(deref(op.doc, media?.schema))
  if (example === undefined) return { body: '', contentType }
  return { body: typeof example === 'string' ? example : JSON.stringify(example, null, 2), contentType }
}

/** Formulario inicial: los parámetros del contrato con su ejemplo y el body de ejemplo. */
export function initialForm(op: OperationRef): TryForm {
  const params = operationParameters(op)
    .filter((p) => p && p.name && p.in)
    .map((p) => ({
      name: String(p.name),
      in: String(p.in),
      required: p.in === 'path' || p.required === true,
      description: p.description,
      schema: p.schema ? deref(op.doc, p.schema) : undefined,
      value: asText(p.example ?? firstExample(p) ?? p.schema?.example ?? p.schema?.default),
    }))
  return { params, ...exampleRequestBody(op) }
}

const pointerSegment = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * Arazzo de un paso que llama a la operación con lo escrito en el formulario. `resolve` reemplaza las
 * {{variables}} (y generadores) antes de armarlo. Devuelve el error si el body no es JSON válido.
 */
export function buildTryProject(
  source: SourceState,
  op: OperationRef,
  form: TryForm,
  resolve: (text: string) => string = (s) => s,
): { project?: Project; analysis?: ProjectAnalysis; error?: string } {
  let payload: unknown
  if (form.body !== undefined && form.body.trim()) {
    const text = resolve(form.body)
    if (/json/i.test(form.contentType ?? 'application/json')) {
      try {
        payload = JSON.parse(text)
      } catch (e) {
        return { error: t('try.badJson', { error: (e as Error).message }) }
      }
    } else payload = text
  }
  const arazzo: ArazzoDoc = {
    arazzo: '1.1.0',
    info: { title: t('try.title'), version: '1.0.0' },
    sourceDescriptions: [{ name: source.name, url: source.url, type: source.type as 'openapi' }],
    workflows: [
      {
        workflowId: TRY_WORKFLOW,
        steps: [
          {
            stepId: stepIdFor(op),
            operationPath: `{$sourceDescriptions.${source.name}.url}#/paths/${pointerSegment(op.path)}/${op.method.toLowerCase()}`,
            parameters: form.params.filter((p) => p.value.trim() !== '').map((p) => ({ name: p.name, in: p.in as 'query', value: resolve(p.value) })),
            ...(payload !== undefined ? { requestBody: { contentType: form.contentType, payload } } : {}),
          },
        ],
      },
    ],
  } as ArazzoDoc
  const project: Project = { arazzoFileName: '(try)', arazzo, sources: [source], files: [] }
  return { project, analysis: analyzeProject(project) }
}

/** Parámetros obligatorios sin valor (no impiden enviar: la API dirá qué falta). */
export function missingRequired(form: TryForm): string[] {
  return form.params.filter((p) => p.required && !p.value.trim()).map((p) => p.name)
}
