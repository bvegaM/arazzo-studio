/* eslint-disable @typescript-eslint/no-explicit-any */
// Editor de contratos (OpenAPI / AsyncAPI): YAML con revisión en vivo, la lista de operaciones para
// saltar a cada una y el impacto de los cambios en los journeys que usan el contrato.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { yaml } from '@codemirror/lang-yaml'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { syntaxHighlighting } from '@codemirror/language'
import YAML from 'yaml'
import { yamlProblems, type TextProblem } from '../../core/authoring'
import { contractOutline, contractProblems, lintContract, pathRange, type OutlineItem } from '../../core/contractLint'
import type { SaveResult } from '../../lib/browser'
import { t } from '../../i18n'
import { useLocale } from '../../i18n/react'
import { IssueBadge } from './badges'
import { Empty, Icon } from './kit'
import { editorTheme, highlight, toDiagnostics } from './editorTheme'

/** Un journey que usa el contrato y sus problemas actuales. */
export interface ContractUsage {
  key: string
  name: string
  file: string
  problems: { level: 'error' | 'warning' | 'info'; message: string; stepId?: string }[]
}

interface Props {
  fileName: string
  text: string
  original: string
  /** false: contrato remoto o adjuntado (solo lectura). */
  editable: boolean
  onChange: (text: string) => string | undefined
  onSave: (text: string) => Promise<SaveResult>
  onMakeLocalCopy: () => void
  usage: ContractUsage[]
  onOpenJourney: (key: string, stepId?: string) => void
  /** Otros archivos de la colección que este referencia con $ref (p. ej. schemas). */
  related: string[]
  onOpenFile: (file: string) => void
}

interface Parsed {
  doc?: any
  problems: TextProblem[]
  yamlError: boolean
}

function analyze(text: string): Parsed {
  const syntax = yamlProblems(text)
  if (syntax.length) return { problems: syntax, yamlError: true }
  try {
    const doc = YAML.parse(text, { maxAliasCount: -1 })
    return { doc, problems: contractProblems(text, lintContract(doc)).sort((a, b) => a.from - b.from), yamlError: false }
  } catch (e) {
    return { problems: [{ from: 0, to: 1, level: 'error', message: (e as Error).message }], yamlError: true }
  }
}

function kindLabel(doc: any): string | undefined {
  if (doc?.openapi) return `OpenAPI ${doc.openapi}`
  if (doc?.swagger) return `Swagger ${doc.swagger}`
  if (doc?.asyncapi) return `AsyncAPI ${doc.asyncapi}`
  return undefined
}

export function ContractEditor(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(p)
  useLayoutEffect(() => {
    latest.current = p
  })
  const locale = useLocale()
  const [parsed, setParsed] = useState<Parsed>(() => analyze(p.text))
  const [dirty, setDirty] = useState(p.text !== p.original)
  const [saved, setSaved] = useState<string>()
  const [filter, setFilter] = useState('')
  // Problemas de cada journey al abrir el contrato: el impacto muestra solo lo que apareció después.
  const [baseline] = useState(() => new Map(p.usage.map((u) => [u.key, new Set(u.problems.map((x) => x.message))])))

  const showDiagnostics = (problems: TextProblem[]) => {
    const v = view.current
    if (v) v.dispatch(setDiagnostics(v.state, toDiagnostics(problems, v.state.doc.length)))
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const v = new EditorView({
      parent: host.current!,
      doc: latest.current.text,
      extensions: [
        basicSetup,
        yaml(),
        syntaxHighlighting(highlight),
        lintGutter(),
        editorTheme,
        EditorState.readOnly.of(!latest.current.editable),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          setSaved(undefined)
          clearTimeout(timer)
          timer = setTimeout(() => {
            const text = u.state.doc.toString()
            setDirty(text !== latest.current.original)
            latest.current.onChange(text)
            setParsed(analyze(text))
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

  // Los mensajes siguen el idioma; se recalculan al cambiarlo.
  useEffect(() => {
    const v = view.current
    if (v) setParsed(analyze(v.state.doc.toString()))
  }, [locale])

  useEffect(() => showDiagnostics(parsed.problems), [parsed])

  const goTo = (from: number, to: number) => {
    const v = view.current
    if (!v) return
    v.dispatch({ selection: { anchor: from, head: Math.min(to, v.state.doc.length) }, scrollIntoView: true })
    v.focus()
  }
  const goToPath = (item: OutlineItem) => {
    const v = view.current
    if (!v) return
    const [from] = pathRange(v.state.doc.toString(), item.path)
    const lineEnd = v.state.doc.lineAt(from).to
    goTo(from, lineEnd)
  }

  const discard = () => {
    const v = view.current
    if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: p.original } })
  }

  const outline = useMemo(() => contractOutline(parsed.doc), [parsed.doc])
  const q = filter.trim().toLowerCase()
  const shownOps = q ? outline.filter((o) => `${o.method} ${o.target} ${o.operationId ?? ''} ${o.summary ?? ''}`.toLowerCase().includes(q)) : outline
  const errors = parsed.problems.filter((x) => x.level === 'error').length
  const warnings = parsed.problems.filter((x) => x.level === 'warning').length
  const kind = kindLabel(parsed.doc)

  // Impacto: problemas de cada journey que no estaban al abrir el contrato.
  const impact = p.usage.map((u) => ({ ...u, added: u.problems.filter((x) => x.level !== 'info' && !baseline.get(u.key)?.has(x.message)) }))
  const broken = impact.filter((u) => u.added.length)

  return (
    <div className="editor contract-editor">
      <div className="editor-bar">
        <code className="editor-file">{p.fileName}</code>
        {kind && <span className="badge">{kind}</span>}
        {!p.editable && <span className="badge b-warn">{t('contract.readOnly')}</span>}
        {parsed.yamlError ? (
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
        {saved ? <span className="editor-state ok">✓ {saved}</span> : dirty && <span className="editor-state">● {t('editor.unsaved')}</span>}
        <div className="editor-actions">
          {!p.editable ? (
            <button className="primary" onClick={p.onMakeLocalCopy} title={t('contract.localCopyHint')}>
              <Icon d="M8 8h12v12H8zM4 16V4h12" /> {t('contract.localCopy')}
            </button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {broken.length > 0 && (
        <div className="callout warn small contract-impact-alert">
          <strong>{t('contract.breaks', { n: broken.length })}</strong> {t('contract.breaksHint')}
        </div>
      )}

      <div className="editor-body">
        <div className="editor-code" ref={host} />
        <aside className="editor-side contract-side">
          <h4>
            {t('contract.operations')} <span className="muted">{outline.length}</span>
          </h4>
          {outline.length > 6 && <input className="contract-filter" value={filter} placeholder={t('contract.filterOps')} onChange={(e) => setFilter(e.target.value)} aria-label={t('contract.filterOps')} />}
          {outline.length ? (
            <ul className="contract-ops">
              {shownOps.map((o) => (
                <li key={o.path.join('/')}>
                  <button className="link-like" onClick={() => goToPath(o)} title={o.summary ?? o.operationId}>
                    <span className={`method m-${o.method.toLowerCase()}`}>{o.method}</span>
                    <span className="grow clamp-1 contract-op-target">{o.target}</span>
                    {o.operationId && <span className="muted small clamp-1">{o.operationId}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{parsed.yamlError ? t('editor.staleDiagram') : t('contract.noOps')}</Empty>
          )}

          {p.related.length > 0 && (
            <>
              <h4>{t('contract.related')}</h4>
              <ul className="contract-ops">
                {p.related.map((f) => (
                  <li key={f}>
                    <button className="link-like" onClick={() => p.onOpenFile(f)} title={t('contract.open', { file: f })}>
                      <span className="ws-tab-icon">{'{ }'}</span>
                      <span className="grow clamp-1 contract-op-target">{f}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4>{t('editor.problems')}</h4>
          <div className="editor-problems-box">
            {parsed.problems.length === 0 ? (
              <Empty>{t('editor.noProblems')}</Empty>
            ) : (
              <ul className="issues editor-problems">
                {parsed.problems.map((pr, i) => (
                  <li key={`${pr.from}-${i}`}>
                    <button className="link-like" onClick={() => goTo(pr.from, pr.to)} title={t('editor.goTo')}>
                      <IssueBadge level={pr.level} /> <span>{pr.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <h4>{t('contract.impact')}</h4>
          {p.usage.length === 0 ? (
            <Empty>{t('contract.unused')}</Empty>
          ) : (
            <ul className="contract-usage">
              {impact.map((u) => (
                <li key={u.key} className={u.added.length ? 'broken' : ''}>
                  <button className="link-like" onClick={() => p.onOpenJourney(u.key)}>
                    <span className={`status-dot ${u.added.length ? 'sd-failed' : 'sd-passed'}`} />
                    <strong className="grow clamp-1">{u.name}</strong>
                    <span className="muted small">{u.added.length ? t('contract.newProblems', { n: u.added.length }) : t('contract.noChange')}</span>
                  </button>
                  {u.added.length > 0 && (
                    <ul>
                      {u.added.slice(0, 6).map((x, i) => (
                        <li key={i}>
                          <button className="link-like" onClick={() => p.onOpenJourney(u.key, x.stepId)}>
                            <IssueBadge level={x.level} /> <span>{x.stepId ? <code>{x.stepId}</code> : null} {x.message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
