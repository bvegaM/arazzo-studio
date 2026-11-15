/* eslint-disable @typescript-eslint/no-explicit-any */
// Editor de contratos (OpenAPI / AsyncAPI): YAML con revisión en vivo, la lista de operaciones para
// saltar a cada una y el impacto de los cambios en los journeys que usan el contrato.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { yaml } from '@codemirror/lang-yaml'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { syntaxHighlighting } from '@codemirror/language'
import YAML from 'yaml'
import { yamlProblems, type TextProblem } from '../../core/authoring'
import { contractProblems, lintContract, pathRange } from '../../core/contractLint'
import type { SaveResult } from '../../lib/browser'
import { t } from '../../i18n'
import { useLocale } from '../../i18n/react'
import { IssueBadge } from './badges'
import { Empty, Icon } from './kit'
import { editorTheme, highlight, toDiagnostics } from './editorTheme'
import { ContractDocs } from './ContractDocs'
import { SwaggerPreview, type PreviewCredential } from './SwaggerPreview'
import type { DocPath } from '../../core/contractLint'
import type { HttpRequest, HttpResponse } from '../../core/http'

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
  /** Contrato ya armado (con los $ref a otros archivos resueltos) para la vista previa. */
  docDoc?: any
  /** Vista previa con Swagger UI (contratos OpenAPI): servidor y credenciales del ambiente. */
  swagger?: {
    envServer?: { url: string; envName: string }
    credentials: PreviewCredential[]
    onRequest: (req: HttpRequest) => Promise<HttpResponse>
    secrets: string[]
  }
}

interface Parsed {
  doc?: any
  /** Última versión legible: la documentación la sigue mostrando mientras el YAML tiene errores. */
  lastDoc?: any
  problems: TextProblem[]
  yamlError: boolean
  /** Texto analizado (para saber la línea de cada problema). */
  text: string
}

function analyze(text: string): Parsed {
  const syntax = yamlProblems(text)
  if (syntax.length) {
    // El parser a veces repite el mismo error en la misma línea: se muestra una vez.
    const seen = new Set<string>()
    const unique = syntax.filter((x) => {
      const key = `${text.slice(0, x.from).split('\n').length}|${x.message.replace(/ at line \d+, column \d+:?$/, '')}`
      return seen.has(key) ? false : (seen.add(key), true)
    })
    return { problems: unique, yamlError: true, text }
  }
  try {
    const doc = YAML.parse(text, { maxAliasCount: -1 })
    return { doc, problems: contractProblems(text, lintContract(doc)).sort((a, b) => a.from - b.from), yamlError: false, text }
  } catch (e) {
    return { problems: [{ from: 0, to: 1, level: 'error', message: (e as Error).message }], yamlError: true, text }
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
  const [parsed, setParsed] = useState<Parsed>(() => {
    const first = analyze(p.text)
    return { ...first, lastDoc: first.doc }
  })
  const reanalyze = (text: string) =>
    setParsed((prev) => {
      const next = analyze(text)
      return { ...next, lastDoc: next.doc ?? prev.lastDoc }
    })
  const [dirty, setDirty] = useState(p.text !== p.original)
  const [saved, setSaved] = useState<string>()
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
            reanalyze(text)
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
    if (v) reanalyze(v.state.doc.toString())
  }, [locale])

  useEffect(() => showDiagnostics(parsed.problems), [parsed])

  const goTo = (from: number, to: number) => {
    const v = view.current
    if (!v) return
    v.dispatch({ selection: { anchor: from, head: Math.min(to, v.state.doc.length) }, scrollIntoView: true })
    v.focus()
  }
  const discard = () => {
    const v = view.current
    if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: p.original } })
  }

  const errors = parsed.problems.filter((x) => x.level === 'error').length
  const warnings = parsed.problems.filter((x) => x.level === 'warning').length
  const kind = kindLabel(parsed.doc)
  const [errorsOpen, setErrorsOpen] = useState(true)
  const [impactOpen, setImpactOpen] = useState(false)
  const lineOf = (offset: number) => parsed.text.slice(0, offset).split('\n').length
  const goToDocPath = (path: DocPath) => {
    const v = view.current
    if (!v) return
    const [from] = pathRange(v.state.doc.toString(), path)
    goTo(from, v.state.doc.lineAt(from).to)
  }

  // Impacto: problemas de cada journey que no estaban al abrir el contrato.
  const impact = p.usage.map((u) => ({ ...u, added: u.problems.filter((x) => x.level !== 'info' && !baseline.get(u.key)?.has(x.message)) }))
  const broken = impact.filter((u) => u.added.length)
  // Lo que se muestra a la derecha: el contrato armado (con $ref resueltos) o el último legible.
  const shown = p.docDoc ?? parsed.lastDoc
  const isOpenApi = !!(shown?.openapi || shown?.swagger)

  return (
    <div className="editor contract-editor">
      <div className="editor-bar">
        <code className="editor-file">{p.fileName}</code>
        {kind && <span className="badge">{kind}</span>}
        {!p.editable && <span className="badge b-warn">{t('contract.readOnly')}</span>}
        {p.related.map((f) => (
          <button key={f} className="link small contract-ref" onClick={() => p.onOpenFile(f)} title={t('contract.open', { file: f })}>
            $ref: {f}
          </button>
        ))}
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

      <div className="se-split">
        <div className="se-editor" ref={host} />
        <div className="se-preview">
          {/* Como en Swagger Editor: los errores arriba de la vista previa, con su línea. */}
          {parsed.problems.length > 0 && (
            <div className={`se-errors ${errors ? '' : 'only-warnings'}`}>
              <div className="se-errors-head">
                <strong>{errors ? t('swagger.errors', { n: errors + warnings }) : t('swagger.warnings', { n: warnings || parsed.problems.length })}</strong>
                <span className="spacer" />
                <button className="link small" onClick={() => setErrorsOpen(!errorsOpen)}>
                  {errorsOpen ? t('swagger.hide') : t('swagger.show')}
                </button>
              </div>
              {errorsOpen && (
                <ul>
                  {parsed.problems.map((pr, i) => (
                    <li key={`${pr.from}-${i}`}>
                      <button className="link-like" onClick={() => goTo(pr.from, pr.to)}>
                        <span className="se-level">{t(`swagger.level.${pr.level}` as 'swagger.level.error')}</span>
                        <span className="se-line">{t('swagger.line', { n: lineOf(pr.from) })}</span>
                        <span>{pr.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {p.usage.length > 0 && (
            <div className={`se-impact ${broken.length ? 'broken' : ''}`}>
              <button className="se-impact-head" onClick={() => setImpactOpen(!impactOpen)} aria-expanded={impactOpen}>
                <strong>{broken.length ? t('contract.breaks', { n: broken.length }) : t('swagger.impactOk', { n: p.usage.length })}</strong>
                <span className="spacer" />
                <span className="small">{impactOpen ? t('swagger.hide') : t('swagger.show')}</span>
              </button>
              {impactOpen && (
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
            </div>
          )}
          {isOpenApi && p.swagger ? (
            <SwaggerPreview spec={shown} envServer={p.swagger.envServer} credentials={p.swagger.credentials} onRequest={p.swagger.onRequest} secrets={p.swagger.secrets} />
          ) : shown ? (
            <div className="se-docs">
              <ContractDocs doc={shown} onGoTo={goToDocPath} onOpenEnv={() => {}} />
            </div>
          ) : (
            <Empty>{t('docs.unreadable')}</Empty>
          )}
        </div>
      </div>
    </div>
  )
}
