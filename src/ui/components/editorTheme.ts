// Tema compartido de los editores (Arazzo y contratos): usa las variables CSS de la app, así el
// resaltado sigue el tema claro u oscuro.
import { EditorView } from 'codemirror'
import { HighlightStyle } from '@codemirror/language'
import type { Diagnostic } from '@codemirror/lint'
import { tags } from '@lezer/highlight'
import type { TextProblem } from '../../core/authoring'

export const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--faint)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--info) 22%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '1em' },
})

export const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--info)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ok)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warn)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.typeName, tags.labelName], color: 'var(--sim)' },
])

const SEVERITY: Record<TextProblem['level'], Diagnostic['severity']> = { error: 'error', warning: 'warning', info: 'info' }

export function toDiagnostics(problems: TextProblem[], length: number): Diagnostic[] {
  return problems
    .filter((p) => p.from <= length)
    .map((p) => ({ from: p.from, to: Math.min(p.to, length), severity: SEVERITY[p.level], message: p.message }))
}
