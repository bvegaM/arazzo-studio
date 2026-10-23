/* eslint-disable @typescript-eslint/no-explicit-any */
// Comparación esperado / recibido de un criterio y JSON con los campos en conflicto resaltados.
import { useEffect, useRef } from 'react'
import type { Mismatch } from '../../core/criteria'
import { t, type MessageKey } from '../../i18n'

const OP_KEY: Record<string, MessageKey> = {
  '!=': 'crit.op.ne',
  '<': 'crit.op.lt',
  '<=': 'crit.op.le',
  '>': 'crit.op.gt',
  '>=': 'crit.op.ge',
}

const show = (v: any) => {
  const text = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v, null, 2)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

/** Nombre corto del campo: "/limits/daily" → "limits.daily"; el status HTTP con su nombre. */
function fieldName(m: Mismatch): string {
  if (m.subject === '$statusCode') return t('diff.statusCode')
  if (m.pointer) return m.pointer.slice(1).replace(/\//g, '.').replace(/~1/g, '/').replace(/~0/g, '~')
  return m.subject
}

export function MismatchList({ mismatches, onShow }: { mismatches: Mismatch[]; onShow?: () => void }) {
  return (
    <div className="diff-list">
      {mismatches.map((m, i) => (
        <div className="diff" key={i}>
          <div className="diff-head">
            <code className="diff-field" title={m.subject}>
              {fieldName(m)}
            </code>
            {onShow && m.pointer && (
              <button className="link small" onClick={onShow}>
                {t('diff.show')} →
              </button>
            )}
          </div>
          <div className="diff-row diff-exp">
            <span className="diff-tag">{m.op === 'regex' ? t('diff.mustMatch') : OP_KEY[m.op] ? `${t('diff.expected')} (${t(OP_KEY[m.op])})` : t('diff.expected')}</span>
            <code>{m.op === 'regex' ? `/${m.expected}/` : show(m.expected)}</code>
          </div>
          <div className="diff-row diff-act">
            <span className="diff-tag">{t('diff.actual')}</span>
            {m.actual === undefined ? <em className="diff-missing">{t('diff.missing')}</em> : <code>{show(m.actual)}</code>}
          </div>
        </div>
      ))}
    </div>
  )
}

interface Line {
  pointer: string
  depth: number
  text: string
}

const escKey = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1')

function toLines(value: any, pointer = '', depth = 0, key?: string, last = true): Line[] {
  const prefix = key === undefined ? '' : `${JSON.stringify(key)}: `
  const comma = last ? '' : ','
  if (value && typeof value === 'object') {
    const isArray = Array.isArray(value)
    const entries: [string, any][] = isArray ? value.map((v: any, i: number) => [String(i), v]) : Object.entries(value)
    const [open, close] = isArray ? ['[', ']'] : ['{', '}']
    if (!entries.length) return [{ pointer, depth, text: `${prefix}${open}${close}${comma}` }]
    return [
      { pointer, depth, text: `${prefix}${open}` },
      ...entries.flatMap(([k, v], i) => toLines(v, `${pointer}/${escKey(k)}`, depth + 1, isArray ? undefined : k, i === entries.length - 1)),
      { pointer, depth, text: `${close}${comma}` },
    ]
  }
  return [{ pointer, depth, text: `${prefix}${JSON.stringify(value)}${comma}` }]
}

/** JSON con formato y las rutas indicadas resaltadas; se desplaza solo hasta la primera. */
export function JsonView({ value, highlight = [] }: { value: any; highlight?: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  const marks = highlight.filter(Boolean)
  const isMarked = (p: string) => marks.some((h) => p === h || p.startsWith(`${h}/`))
  const marksKey = marks.join('|')

  useEffect(() => {
    const pre = ref.current
    const first = pre?.querySelector<HTMLElement>('.json-hl')
    if (pre && first) pre.scrollTop = Math.max(0, first.offsetTop - pre.clientHeight / 3)
  }, [value, marksKey])

  if (value === undefined) return <pre className="muted">{t('common.empty')}</pre>
  if (typeof value !== 'object' || value === null) return <pre>{typeof value === 'string' ? value : JSON.stringify(value)}</pre>
  return (
    <pre className="json-view" ref={ref}>
      {toLines(value).map((l, i) => (
        <span key={i} className={`json-line ${isMarked(l.pointer) ? 'json-hl' : ''}`}>
          {'  '.repeat(l.depth)}
          {l.text}
        </span>
      ))}
    </pre>
  )
}
