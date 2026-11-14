// Barra lateral del espacio de trabajo: la colección (Arazzo → journeys → pasos), sus contratos y los ambientes.
import { useRef, useState } from 'react'
import type { WorkflowAnalysis } from '../core/analyze'
import { caseJourney } from '../core/collection'
import { humanizeId } from '../core/format'
import { isRemote } from '../core/loader'
import type { CaseRun } from '../core/testcases'
import { LOCALES, t } from '../i18n'
import { MethodBadge } from '../ui/components/badges'
import { Chevron, Icon, Segmented } from '../ui/components/kit'
import type { Studio } from './useStudio'

export interface Selection {
  /** Journey activo (workflowId). */
  journey?: string
  /** Paso abierto dentro del journey activo. */
  step?: string
  /** La pestaña de ambiente está activa. */
  env?: boolean
}

interface Props {
  studio: Studio
  selection: Selection
  onOpenJourney: (workflowId: string) => void
  onOpenStep: (workflowId: string, stepId: string) => void
  onOpenEnv: () => void
}

/** Estado del journey para el punto de color: la última ejecución o, si no hay, su validación. */
function journeyTone(key: string, wa: WorkflowAnalysis, runs: CaseRun[]): { cls: string; title: string } {
  const mine = runs.filter((r) => caseJourney(r.tc) === key)
  if (mine.some((r) => r.state === 'running' || r.state === 'pending')) return { cls: 'sd-running', title: t('results.runningState') }
  const done = mine.filter((r) => r.state === 'done')
  if (done.some((r) => r.verdict === 'failed')) return { cls: 'sd-failed', title: t('results.filter.failed') }
  if (done.some((r) => r.verdict === 'inconclusive')) return { cls: 'sd-inconclusive', title: t('results.filter.inconclusive') }
  if (done.length) return { cls: 'sd-passed', title: t('results.filter.passed') }
  if (wa.issues.some((i) => i.level === 'error')) return { cls: 'sd-failed', title: t('nav.errors', { n: wa.issues.filter((i) => i.level === 'error').length }) }
  return { cls: 'sd-idle', title: t('ws.tree.notRun') }
}

const FOLDER_ICON = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'
const PLUS_ICON = 'M12 5v14M5 12h14'
const CLOSE_ICON = 'M6 6l12 12M18 6L6 18'

export function CollectionSidebar({ studio, selection, onOpenJourney, onOpenStep, onOpenEnv }: Props) {
  const { projects, journeys, runs, locale, changeLocale, environments, activeEnv, envActions } = studio
  const sources = studio.collectionSources
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [closing, setClosing] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const attach = useRef<HTMLInputElement>(null)
  const [attachTo, setAttachTo] = useState<string>()
  const toggle = (key: string, def = false) => setCollapsed((c) => ({ ...c, [key]: !(c[key] ?? def) }))
  const isCollapsed = (key: string, def = false) => collapsed[key] ?? def

  return (
    <aside className="ws-sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <div>Arazzo Studio</div>
          <div className="brand-sub">{t('brand.sub')}</div>
        </div>
      </div>

      {projects.length > 0 && (
        <>
          <div className="tree-head">
            <span className="tree-label">{t('ws.tree.collection')}</span>
            <span className="spacer" />
            {studio.isDesktop && (
              <button className="icon-btn" onClick={studio.openFolder} title={t('load.openFolder')} aria-label={t('load.openFolder')}>
                <Icon d={FOLDER_ICON} size={14} />
              </button>
            )}
            <button className="icon-btn" onClick={() => files.current?.click()} title={t('ws.tree.addFiles')} aria-label={t('ws.tree.addFiles')}>
              <Icon d={PLUS_ICON} size={14} />
            </button>
            <button className="icon-btn" onClick={() => setClosing(true)} title={t('ws.tree.close')} aria-label={t('ws.tree.close')}>
              <Icon d={CLOSE_ICON} size={14} />
            </button>
            <input
              ref={files}
              type="file"
              multiple
              accept=".yaml,.yml,.json"
              hidden
              onChange={(e) => {
                void studio.addFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          {closing && (
            <div className="tree-confirm">
              <span>{t('ws.tree.closeConfirm')}</span>
              <button className="small danger" onClick={studio.reset}>
                {t('ws.tree.closeYes')}
              </button>
              <button className="small" onClick={() => setClosing(false)}>
                {t('common.cancel')}
              </button>
            </div>
          )}

          <nav className="tree" aria-label={t('ws.tree.collection')}>
            <div className="tree-root" title={studio.folder ?? studio.collectionTitle}>
              <strong className="clamp-1">{studio.collectionTitle}</strong>
              {studio.folder && <span className="muted small clamp-1">{studio.folder}</span>}
            </div>
            {projects.map((project) => {
              const file = project.arazzoFileName
              const fileKey = `file:${file}`
              const fileJourneys = journeys.filter((j) => j.file === file)
              const fileErrors = (studio.analysisOf(file)?.issues ?? []).filter((i) => i.level === 'error').length
              return (
                <div key={file} className="tree-group">
                  <button className="tree-row tree-file" onClick={() => toggle(fileKey)} aria-expanded={!isCollapsed(fileKey)} title={file}>
                    <Chevron open={!isCollapsed(fileKey)} />
                    <span className="tree-icon">⧉</span>
                    <span className="grow clamp-1">
                      {projects.length > 1 ? (project.arazzo.info?.title ?? file) : file}
                      {projects.length > 1 && <span className="tree-file-name">{file.split(/[\\/]/).pop()}</span>}
                    </span>
                    {fileErrors > 0 && <span className="err small">!</span>}
                  </button>
                  {!isCollapsed(fileKey) &&
                    fileJourneys.map(({ key, wa }) => {
                      const tone = journeyTone(key, wa, runs)
                      const open = !isCollapsed(key, key !== selection.journey)
                      const active = selection.journey === key && !selection.step && !selection.env
                      return (
                        <div key={key} className="tree-group">
                          <div className={`tree-row tree-journey ${active ? 'active' : ''}`}>
                            <button className="tree-twisty" onClick={() => toggle(key, key !== selection.journey)} aria-label={t('ws.tree.toggleSteps')} aria-expanded={open}>
                              <Chevron open={open} />
                            </button>
                            <button className="tree-main" onClick={() => onOpenJourney(key)} title={wa.workflow.summary ?? wa.workflow.workflowId}>
                              <span className={`status-dot ${tone.cls}`} title={tone.title} />
                              <span className="grow clamp-1">{humanizeId(wa.workflow.workflowId)}</span>
                            </button>
                          </div>
                          {open &&
                            wa.steps.map((rs) => {
                              const stepActive = selection.journey === key && selection.step === rs.step.stepId && !selection.env
                              const hasError = wa.issues.some((i) => i.stepId === rs.step.stepId && i.level === 'error')
                              return (
                                <button
                                  key={rs.step.stepId}
                                  className={`tree-row tree-step ${stepActive ? 'active' : ''}`}
                                  onClick={() => onOpenStep(key, rs.step.stepId)}
                                  title={rs.step.description ?? rs.label}
                                >
                                  {rs.op ? <MethodBadge method={rs.op.method} /> : <span className="method m-flow">{rs.kind === 'workflow' ? 'FLOW' : '?'}</span>}
                                  <span className={`grow clamp-1 ${hasError ? 'err' : ''}`}>{rs.step.stepId}</span>
                                </button>
                              )
                            })}
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </nav>

          <div className="tree-section">
            <button className="tree-head tree-toggle" onClick={() => toggle('contracts')} aria-expanded={!isCollapsed('contracts')}>
              <Chevron open={!isCollapsed('contracts')} />
              <span className="tree-label">{t('ws.tree.contracts')}</span>
              <span className="muted small">
                {sources.filter((s) => s.status === 'loaded').length}/{sources.length}
              </span>
            </button>
            {!isCollapsed('contracts') && (
              <ul className="tree-list">
                {sources.map((s) => {
                  const ok = s.status === 'loaded' && !s.missingRefs?.length
                  return (
                    <li key={s.name} title={s.error ?? (s.missingRefs?.length ? t('load.missingRefs', { files: s.missingRefs.join(', ') }) : (s.fileName ?? s.url))}>
                      <span className={ok ? 'ok' : 'err'}>{ok ? '✓' : '✕'}</span>
                      <span className="grow clamp-1">
                        {s.name} <span className="muted small">{s.type}</span>
                      </span>
                      {s.status !== 'loaded' && (
                        <>
                          <button
                            className="link small"
                            onClick={() => {
                              setAttachTo(s.name)
                              attach.current?.click()
                            }}
                          >
                            {t('ws.tree.attach')}
                          </button>
                          {isRemote(s.url) && (
                            <button className="link small" onClick={() => studio.fetchRemote(s.name)}>
                              {t('ws.tree.fetch')}
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <input
              ref={attach}
              type="file"
              accept=".yaml,.yml,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f && attachTo) void studio.attachFile(attachTo, f)
                e.target.value = ''
              }}
            />
          </div>

          <div className="tree-section">
            <div className="tree-head">
              <button className="tree-toggle" onClick={() => toggle('envs')} aria-expanded={!isCollapsed('envs')}>
                <Chevron open={!isCollapsed('envs')} />
                <span className="tree-label">{t('ws.tree.environments')}</span>
              </button>
              <span className="spacer" />
              <button className="icon-btn" onClick={() => envActions.add(t('env.newName'))} title={t('ws.tree.addEnv')} aria-label={t('ws.tree.addEnv')}>
                <Icon d={PLUS_ICON} size={14} />
              </button>
            </div>
            {!isCollapsed('envs') && (
              <ul className="tree-list">
                {environments.map((e) => (
                  <li key={e.id} className={e.id === activeEnv.id ? 'active' : ''}>
                    <button className="tree-env" onClick={() => envActions.select(e.id)} title={t('ws.tree.useEnv')}>
                      <span className={`radio ${e.id === activeEnv.id ? 'on' : ''} ${e.color ? `c-${e.color}` : ''}`} aria-hidden="true" />
                      <span className="grow clamp-1">{e.name}</span>
                      {e.variables.length > 0 && (
                        <span className="muted small" title={t('vars.count', { vars: e.variables.filter((v) => !v.secret).length, secrets: e.variables.filter((v) => v.secret).length })}>
                          {t('vars.countShort', { n: e.variables.length })}
                        </span>
                      )}
                    </button>
                    {e.id === activeEnv.id && (
                      <button className={`link small ${selection.env ? 'active' : ''}`} onClick={onOpenEnv}>
                        {t('ws.tree.configure')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="sidebar-foot">{t(studio.isDesktop ? 'sidebar.privacyDesktop' : 'sidebar.privacy')}</div>
      <div className="sidebar-lang" aria-label={t('sidebar.language')}>
        <Segmented options={LOCALES.map((l) => ({ id: l.id, label: l.label }))} value={locale} onChange={changeLocale} />
      </div>
    </aside>
  )
}
