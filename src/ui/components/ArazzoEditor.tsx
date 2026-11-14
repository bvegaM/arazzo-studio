/* eslint-disable @typescript-eslint/no-explicit-any */
// Editor del Arazzo (CodeMirror 6). Pesa bastante: se carga solo al abrirlo.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { ProjectAnalysis } from '../../core/analyze'
import type { Project } from '../../core/loader'
import { issueRanges, suggest, yamlProblems, type TextProblem } from '../../core/authoring'
import type { SaveResult } from '../../lib/browser'
import { t } from '../../i18n'
import { useLocale } from '../../i18n/react'
import { IssueBadge } from './badges'
import { Empty, Icon } from './kit'

const WorkflowGraph = lazy(() => import('./WorkflowGraph').then((m) => ({ default: m.WorkflowGraph })))

interface Props {
  fileName: string
  text: string
  /** Texto con el que se abrió el editor, para poder descartar los cambios. */
  original: string
  project: Project
  analysis: ProjectAnalysis
  selected: string
  /** Aplica el texto; devuelve el error si no se pudo leer como Arazzo. */
  onChange: (text: string) => string | undefined
  /** Guarda el texto: sobre el archivo original (escritorio), donde elija el usuario o como descarga. */
  onSave: (text: string) => Promise<SaveResult>
  /** Sin él, el editor no muestra el botón de cerrar (vive en una pestaña). */
  onClose?: () => void
  /** Mostrar el diagrama junto a los problemas (por defecto sí). */
  showDiagram?: boolean
}

// Colores de la app (variables CSS): el resaltado sigue el tema claro u oscuro.
const theme = EditorView.theme({
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

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--info)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ok)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warn)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.typeName, tags.labelName], color: 'var(--sim)' },
])

const SEVERITY: Record<TextProblem['level'], Diagnostic['severity']> = { error: 'error', warning: 'warning', info: 'info' }

function toDiagnostics(problems: TextProblem[], length: number): Diagnostic[] {
  return problems
    .filter((p) => p.from <= length)
    .map((p) => ({ from: p.from, to: Math.min(p.to, length), severity: SEVERITY[p.level], message: p.message }))
}

export function ArazzoEditor(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Props más recientes, para los callbacks del editor (que se crean una sola vez).
  const latest = useRef(p)
  useLayoutEffect(() => {
    latest.current = p
  })
  const [problems, setProblems] = useState<TextProblem[]>([])
  const [yamlError, setYamlError] = useState(false)
  const [dirty, setDirty] = useState(p.text !== p.original)
  const [saved, setSaved] = useState<string>()
  const locale = useLocale()

  const show = (unsorted: TextProblem[]) => {
    const list = [...unsorted].sort((a, b) => a.from - b.from)
    setProblems(list)
    const v = view.current
    if (v) v.dispatch(setDiagnostics(v.state, toDiagnostics(list, v.state.doc.length)))
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const s = suggest(ctx.state.doc.toString(), ctx.pos, latest.current.project)
      if (!s) return null
      return { from: s.from, options: s.options.map((o) => ({ label: o.label, detail: o.detail, type: o.type })), validFor: /^[\w$.#/'{}~-]*$/ }
    }
    const v = new EditorView({
      parent: host.current!,
      doc: latest.current.text,
      extensions: [
        basicSetup,
        yaml(),
        syntaxHighlighting(highlight),
        lintGutter(),
        autocompletion({ override: [complete] }),
        theme,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          setSaved(undefined)
          clearTimeout(timer)
          // Se analiza cuando se deja de escribir un momento.
          timer = setTimeout(() => {
            const text = u.state.doc.toString()
            setDirty(text !== latest.current.original)
            const error = latest.current.onChange(text)
            setYamlError(!!error)
            if (error) show(yamlProblems(text).length ? yamlProblems(text) : [{ from: 0, to: 1, level: 'error', message: error }])
          }, 300)
        }),
      ],
    })
    view.current = v
    return () => {
      clearTimeout(timer)
      v.destroy()
      view.current = null
    }
  }, [])

  // Cada análisis nuevo se refleja en el texto (si el YAML se pudo leer).
  useEffect(() => {
    const v = view.current
    if (!v || yamlError) return
    show(issueRanges(v.state.doc.toString(), [...p.analysis.issues, ...p.analysis.workflows.flatMap((w) => w.issues)]))
  }, [p.analysis, yamlError, locale])

  const goTo = (pr: TextProblem) => {
    const v = view.current
    if (!v) return
    v.dispatch({ selection: { anchor: pr.from, head: Math.min(pr.to, v.state.doc.length) }, scrollIntoView: true })
    v.focus()
  }

  const discard = () => {
    const v = view.current
    if (!v) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: p.original } })
  }

  const errors = problems.filter((x) => x.level === 'error').length
  const warnings = problems.filter((x) => x.level === 'warning').length
  // Problemas del análisis que no se pudieron ubicar en el texto (p. ej. de los contratos).
  const located = new Set(problems.map((x) => x.message))
  const general = yamlError ? [] : p.analysis.issues.filter((i) => !located.has(i.message))
  const wa = p.analysis.workflows.find((w) => w.workflow.workflowId === p.selected) ?? p.analysis.workflows[0]

  return (
    <div className="editor">
      <div className="editor-bar">
        <code className="editor-file">{p.fileName}</code>
        {yamlError ? (
          <span className="badge b-err">✕ {t('editor.yamlError')}</span>
        ) : errors + warnings === 0 ? (
          <span className="badge b-ok">✓ {t('contracts.allValid')}</span>
        ) : (
          <>
            {errors > 0 && <span className="badge b-err">{t('nav.errors', { n: errors })}</span>}
            {warnings > 0 && <span className="badge b-warn">{t('contracts.warningsN', { n: warnings })}</span>}
          </>
        )}
        <span className="spacer" />
        {saved ? (
          <span className="editor-state ok">✓ {saved}</span>
        ) : (
          dirty && <span className="editor-state">● {t('editor.unsaved')}</span>
        )}
        <div className="editor-actions">
          {dirty && (
            <button onClick={discard} title={t('editor.discardHint')}>
              <Icon d="M3 7v6h6M3.5 13a9 9 0 1 0 2.1-8.6L3 7" /> {t('editor.discard')}
            </button>
          )}
          <button
            className={dirty && !saved ? 'primary' : undefined}
            onClick={async () => {
              const r = await p.onSave(view.current?.state.doc.toString() ?? p.text)
              if (r !== 'cancelled') setSaved(t(r === 'saved' ? 'editor.saved' : 'editor.downloaded'))
            }}
          >
            <Icon d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14" /> {t('editor.save')}
          </button>
          {p.onClose && (
            <button onClick={p.onClose}>
              <Icon d="M6 6l12 12M18 6L6 18" /> {t('editor.close')}
            </button>
          )}
        </div>
      </div>

      <div className={`editor-body ${p.showDiagram === false ? 'stacked' : ''}`}>
        <div className="editor-code" ref={host} />
        <aside className="editor-side">
          <h4>{t('editor.problems')}</h4>
          <div className="editor-problems-box">
            {problems.length === 0 && general.length === 0 ? (
              <Empty>{t('editor.noProblems')}</Empty>
            ) : (
              <ul className="issues editor-problems">
                {problems.map((pr, i) => (
                  <li key={`${pr.from}-${i}`}>
                    <button className="link-like" onClick={() => goTo(pr)} title={t('editor.goTo')}>
                      <IssueBadge level={pr.level} /> <span>{pr.message}</span>
                    </button>
                  </li>
                ))}
                {general.map((g, i) => (
                  <li key={`g-${i}`}>
                    <IssueBadge level={g.level} /> <span>{g.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {wa && p.showDiagram !== false && (
            <>
              <h4>
                {t('contracts.diagram')} · <code>{wa.workflow.workflowId}</code>
              </h4>
              {yamlError && <span className="muted small">{t('editor.staleDiagram')}</span>}
              <Suspense fallback={<Empty>{t('contracts.loadingDiagram')}</Empty>}>
                <WorkflowGraph key={locale} wa={wa} />
              </Suspense>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
