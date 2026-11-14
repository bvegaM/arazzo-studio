/* eslint-disable @typescript-eslint/no-explicit-any */
// Ayudas para editar el Arazzo: ubicar los problemas en el texto y sugerir valores.
// Sin dependencias del editor: devuelve posiciones (offsets) y textos.
import YAML, { isMap, isPair, isScalar, isSeq, type Document, type Node } from 'yaml'
import type { Issue } from './analyze'
import type { Project } from './loader'
import { listOperations } from './openapi'
import { isAsyncApi } from './asyncapi'

export interface TextProblem {
  from: number
  to: number
  level: Issue['level']
  message: string
}

/** Errores de sintaxis YAML con su posición. */
export function yamlProblems(text: string): TextProblem[] {
  const doc = YAML.parseDocument(text)
  return doc.errors.map((e) => ({
    from: e.pos[0],
    to: Math.max(e.pos[1], e.pos[0] + 1),
    level: 'error',
    // La primera línea basta: el resto es un dibujo del lugar del error.
    message: e.message.split('\n')[0],
  }))
}

function range(node: Node | null | undefined): [number, number] | undefined {
  const r = node?.range
  return r ? [r[0], r[1]] : undefined
}

/** El elemento de una lista cuyo campo `key` vale `value`. */
function itemBy(seq: unknown, key: string, value: string): Node | undefined {
  if (!isSeq(seq)) return undefined
  return seq.items.find((it): it is Node => isMap(it) && String(it.get(key)) === value) as Node | undefined
}

/** El par `key: valor` de un mapa (desde la clave hasta el final del valor). */
function pairRange(map: Node | undefined, key: string): [number, number] | undefined {
  if (!isMap(map)) return undefined
  const pair = map.items.find((p) => isPair(p) && isScalar(p.key) && p.key.value === key)
  if (!pair || !isScalar(pair.key)) return undefined
  const k = range(pair.key)
  const v = range(pair.value as Node)
  return k ? [k[0], v ? v[1] : k[1]] : undefined
}

/** Escalares dentro de un nodo, para buscar el que menciona un mensaje. */
function scalars(node: unknown, out: { value: string; range: [number, number] }[] = []) {
  if (isScalar(node)) {
    const r = range(node)
    if (r && node.value !== null && node.value !== undefined) out.push({ value: String(node.value), range: r })
  } else if (isMap(node)) {
    for (const p of node.items) {
      scalars(p.key, out)
      scalars(p.value, out)
    }
  } else if (isSeq(node)) for (const it of node.items) scalars(it, out)
  return out
}

/** El valor del nodo que aparece citado en el mensaje (el más largo, para no quedarse con una parte). */
function mentioned(node: unknown, message: string): [number, number] | undefined {
  const found = scalars(node)
    .filter((s) => s.value.length >= 3 && message.includes(s.value))
    .sort((a, b) => b.value.length - a.value.length)
  return found[0]?.range
}

/**
 * Ubica cada problema del análisis en el texto: el valor que cita el mensaje si lo hay,
 * si no el stepId o workflowId correspondiente. Los que no se pueden ubicar se omiten.
 */
export function issueRanges(text: string, issues: Issue[]): TextProblem[] {
  const doc = YAML.parseDocument(text)
  if (doc.errors.length) return []
  const workflows = doc.get('workflows', true)
  const out: TextProblem[] = []
  for (const issue of issues) {
    let r: [number, number] | undefined
    if (issue.workflowId) {
      const wf = itemBy(workflows, 'workflowId', issue.workflowId)
      const step = issue.stepId && isMap(wf) ? itemBy(wf.get('steps', true), 'stepId', issue.stepId) : undefined
      const scope = step ?? wf
      r = mentioned(scope, issue.message) ?? pairRange(scope, step ? 'stepId' : 'workflowId')
    } else {
      r = mentioned(doc.get('sourceDescriptions', true), issue.message) ?? (issue.message.includes(String(doc.get('arazzo'))) ? pairRange(doc.contents as Node, 'arazzo') : undefined)
    }
    if (r) out.push({ from: r[0], to: r[1], level: issue.level, message: issue.message })
  }
  return out
}

export interface Suggestion {
  label: string
  detail?: string
  type: 'variable' | 'function' | 'keyword' | 'constant'
}

export interface Suggestions {
  /** Desde dónde se reemplaza lo escrito. */
  from: number
  options: Suggestion[]
}

const ROOT_EXPRESSIONS = [
  '$statusCode', '$response.body', '$response.header.', '$request.body', '$request.header.', '$message.payload', '$message.header.',
  '$inputs.', '$steps.', '$outputs.', '$workflows.', '$sourceDescriptions.', '$components.', '$url', '$method', '$self',
]

const KEY_VALUES: Record<string, Suggestion[]> = {
  action: [
    { label: 'send', detail: 'AsyncAPI', type: 'keyword' },
    { label: 'receive', detail: 'AsyncAPI', type: 'keyword' },
  ],
  in: ['path', 'query', 'querystring', 'header', 'cookie'].map((label) => ({ label, type: 'keyword' as const })),
  type: [
    ...['end', 'goto', 'retry'].map((label) => ({ label, detail: 'action', type: 'keyword' as const })),
    ...['simple', 'regex', 'jsonpath', 'xpath', 'jsonpointer'].map((label) => ({ label, detail: 'criterion / selector', type: 'keyword' as const })),
    ...['openapi', 'asyncapi', 'arazzo'].map((label) => ({ label, detail: 'sourceDescription', type: 'keyword' as const })),
  ],
}

/** El workflow (como objeto JS) en el que está el cursor. */
function workflowAt(doc: Document, pos: number): any | undefined {
  const workflows = doc.get('workflows', true)
  if (!isSeq(workflows)) return undefined
  const node = workflows.items.find((it) => {
    const r = range(it as Node)
    return r && pos >= r[0] && pos <= (it as Node).range![2]
  })
  return node && isMap(node) ? node.toJS(doc, { maxAliasCount: -1 }) : undefined
}

/** Sugerencias para la posición `pos` del texto, o undefined si no hay nada que sugerir. */
export function suggest(text: string, pos: number, project: Project | undefined): Suggestions | undefined {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  const before = text.slice(lineStart, pos)
  const doc = YAML.parseDocument(text)
  const arazzo: any = doc.toJS({ maxAliasCount: -1 }) ?? {}
  const workflows: any[] = Array.isArray(arazzo.workflows) ? arazzo.workflows : []
  const current = workflowAt(doc, pos)
  const steps: any[] = (current ?? {}).steps ?? workflows.flatMap((w) => w?.steps ?? [])
  const stepIds = steps.map((s) => s?.stepId).filter((id): id is string => typeof id === 'string')
  const sources = project?.sources.filter((s) => s.status === 'loaded') ?? []
  const make = (from: number, options: Suggestion[]) => (options.length ? { from, options } : undefined)

  // Expresión en curso: $steps.crear.outputs.id, $inputs.email…
  const expr = before.match(/\$[A-Za-z0-9_.#/-]*$/)?.[0]
  if (expr) {
    const from = pos - expr.length
    let m: RegExpMatchArray | null
    if ((m = expr.match(/^\$steps\.([A-Za-z0-9_-]+)\.outputs\.[A-Za-z0-9_.-]*$/))) {
      const step = steps.find((s) => s?.stepId === m![1]) ?? workflows.flatMap((w) => w?.steps ?? []).find((s: any) => s?.stepId === m![1])
      return make(from, Object.keys(step?.outputs ?? {}).map((o) => ({ label: `$steps.${m![1]}.outputs.${o}`, detail: m![1], type: 'variable' })))
    }
    if (/^\$steps\.[A-Za-z0-9_-]*$/.test(expr)) {
      return make(from, stepIds.map((id) => ({ label: `$steps.${id}.outputs.`, detail: 'step', type: 'variable' })))
    }
    if (/^\$inputs\.[A-Za-z0-9_.-]*$/.test(expr)) {
      const props = Object.keys(current?.inputs?.properties ?? {})
      return make(from, props.map((p) => ({ label: `$inputs.${p}`, detail: 'input', type: 'variable' })))
    }
    if (/^\$workflows\.[A-Za-z0-9_-]*$/.test(expr)) {
      return make(from, workflows.map((w) => w?.workflowId).filter(Boolean).map((id) => ({ label: `$workflows.${id}.outputs.`, detail: 'workflow', type: 'variable' })))
    }
    if ((m = expr.match(/^\$sourceDescriptions\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*$/))) {
      const source = sources.find((s) => s.name === m![1])
      const ops = source ? listOperations(source) : []
      return make(from, [
        { label: `$sourceDescriptions.${m[1]}.url`, detail: 'url', type: 'constant' },
        ...ops.filter((o) => o.operationId).map((o) => ({ label: `$sourceDescriptions.${m![1]}.${o.operationId}`, detail: `${o.method.toUpperCase()} ${o.path}`, type: 'function' as const })),
      ])
    }
    if (/^\$sourceDescriptions\.[A-Za-z0-9_-]*$/.test(expr)) {
      return make(from, (arazzo.sourceDescriptions ?? []).map((s: any) => ({ label: `$sourceDescriptions.${s?.name}.`, detail: s?.type ?? 'openapi', type: 'variable' })))
    }
    if ((m = expr.match(/^\$components\.(parameters|successActions|failureActions)\.[A-Za-z0-9_.-]*$/))) {
      return make(from, Object.keys(arazzo.components?.[m[1]] ?? {}).map((k) => ({ label: `$components.${m![1]}.${k}`, type: 'variable' })))
    }
    if (/^\$components\.[A-Za-z]*$/.test(expr)) {
      return make(from, ['parameters', 'successActions', 'failureActions'].map((k) => ({ label: `$components.${k}.`, type: 'variable' })))
    }
    if (!expr.slice(1).includes('.')) {
      return make(from, ROOT_EXPRESSIONS.filter((e) => e.startsWith(expr)).map((label) => ({ label, type: 'variable' })))
    }
    return undefined
  }

  // dependsOn en línea: "dependsOn: [a, b".
  const inline = before.match(/dependsOn\s*:\s*\[[^\]]*?([A-Za-z0-9_-]*)$/)
  if (inline) return make(pos - inline[1].length, stepIds.map((id) => ({ label: id, detail: 'step', type: 'variable' })))

  // Valor de una clave conocida: "operationId: ", "action: "…
  const kv = before.match(/^(\s*)(-\s+)?([A-Za-z]+)\s*:\s*(['"]?[^\s'"]*)$/)
  if (kv) {
    const [, , dash, key, partial] = kv
    const from = pos - partial.length
    if (key === 'operationId') {
      return make(
        from,
        sources.flatMap((s) =>
          listOperations(s)
            .filter((o) => o.operationId)
            .map((o) => ({ label: `$sourceDescriptions.${s.name}.${o.operationId}`, detail: `${o.method.toUpperCase()} ${o.path}`, type: 'function' as const })),
        ),
      )
    }
    if (key === 'channelPath') {
      return make(
        from,
        sources
          .filter((s) => isAsyncApi(s.doc))
          .flatMap((s) =>
            Object.entries<any>(s.doc.channels ?? {}).map(([name, ch]) => ({
              label: `'{$sourceDescriptions.${s.name}.url}#/channels/${name.replace(/~/g, '~0').replace(/\//g, '~1')}'`,
              detail: ch?.address ?? name,
              type: 'function' as const,
            })),
          ),
      )
    }
    if (key === 'workflowId' && !dash) {
      return make(from, workflows.map((w) => w?.workflowId).filter(Boolean).map((id) => ({ label: id, detail: 'workflow', type: 'variable' })))
    }
    // stepId sin guion: destino de un goto (con guion es la definición de un paso).
    if (key === 'stepId' && !dash) return make(from, stepIds.map((id) => ({ label: id, detail: 'step', type: 'variable' })))
    if (KEY_VALUES[key]) return make(from, KEY_VALUES[key])
    return undefined
  }

  // Elementos de dependsOn como lista debajo de "dependsOn:".
  const item = before.match(/^(\s*)-\s*([A-Za-z0-9_-]*)$/)
  if (item) {
    const indent = item[1].length
    const prev = text.slice(0, lineStart).split('\n').reverse().find((l) => l.trim() && l.search(/\S/) < indent + 1 && !/^\s*-/.test(l))
    if (prev && /^\s*dependsOn\s*:\s*$/.test(prev)) {
      return make(pos - item[2].length, stepIds.map((id) => ({ label: id, detail: 'step', type: 'variable' })))
    }
  }
  return undefined
}
