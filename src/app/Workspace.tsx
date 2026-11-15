// Espacio de trabajo: colección a la izquierda, journey abierto al centro y su resultado a la derecha.
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { WorkflowAnalysis } from '../core/analyze'
import { caseJourney, splitJourneyKey } from '../core/collection'
import { loadFaker } from '../core/dynamicVars'
import { humanizeId } from '../core/format'
import { isAsyncOperation } from '../core/openapi'
import { invalidPaths, missingInputs } from '../core/schemaForm'
import { isSimulated, runnability } from '../core/testcases'
import { t } from '../i18n'
import { MethodBadge } from '../ui/components/badges'
import { Empty, EnvDot, Icon, Segmented, Tabs } from '../ui/components/kit'
import { TemplateVarsProvider, type TemplateVars } from '../ui/components/TemplateInput'
import { CasesView } from '../ui/workspace/CasesView'
import { EnvironmentView } from '../ui/workspace/EnvironmentView'
import { InputsView } from '../ui/workspace/InputsView'
import { OverviewView } from '../ui/workspace/OverviewView'
import { ResultsPanel } from '../ui/workspace/ResultsPanel'
import { StepView } from '../ui/workspace/StepView'
import { EmptyCollection, EmptyWorkspace, WelcomeDialog } from '../ui/workspace/Welcome'
import { CommandPalette, type PaletteItem } from '../ui/workspace/CommandPalette'
import { CollectionSidebar } from './CollectionSidebar'
import { StatusBar } from './StatusBar'
import { DevPanel, type DevTab } from '../ui/workspace/DevPanel'
import type { Studio } from './useStudio'
import type { WorkspaceState } from './useWorkspace'

// El editor (CodeMirror) pesa bastante: se carga solo al abrir la pestaña YAML.
const ArazzoEditor = lazy(() => import('../ui/components/ArazzoEditor').then((m) => ({ default: m.ArazzoEditor })))

type View = 'overview' | 'inputs' | 'cases' | 'yaml' | 'step'

const RESULTS_WIDTH_KEY = 'ws.resultsWidth'
const PLAY_ICON = 'M7 5l12 7-12 7V5z'

function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem(RESULTS_WIDTH_KEY))
    return n >= 320 ? n : 520
  } catch {
    return 520
  }
}

/** Divisor arrastrable entre el centro y el panel de resultados. */
function Splitter({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    const x0 = e.clientX
    const w0 = width
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onChange(Math.min(Math.max(w0 + x0 - ev.clientX, 320), window.innerWidth * 0.7))
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  return <div className="ws-splitter" role="separator" aria-orientation="vertical" aria-label={t('ws.resize')} onPointerDown={start} />
}

export function Workspace({ studio, workspace }: { studio: Studio; workspace: WorkspaceState }) {
  const { journeys, projects } = studio
  // Journeys abiertos como pestañas (además del activo) y si la pestaña de ambiente está abierta.
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [envOpen, setEnvOpen] = useState(false)
  const [envActive, setEnvActive] = useState(false)
  const [views, setViews] = useState<Record<string, View>>({})
  const [steps, setSteps] = useState<Record<string, string>>({})
  const [askConfirm, setAskConfirm] = useState(false)
  const [errorsHidden, setErrorsHidden] = useState(false)
  const [resultsWidth, setResultsWidth] = useState(savedWidth)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [devTab, setDevTab] = useState<DevTab>()
  // La bienvenida se muestra mientras no haya colección, salvo que se haya cerrado.
  const [welcomeClosed, setWelcomeClosed] = useState(false)
  if (projects.length && welcomeClosed) setWelcomeClosed(false)

  // Las pestañas y la selección usan la clave del journey (archivo#workflowId).
  const exists = (key: string) => journeys.some((j) => j.key === key)
  const activeId = exists(studio.selected) ? studio.selected : journeys[0]?.key
  const tabs = [...new Set([...openTabs.filter(exists), ...(activeId ? [activeId] : [])])]
  const journey = journeys.find((j) => j.key === activeId)
  const wa: WorkflowAnalysis | undefined = journey?.wa
  const analysis = journey?.analysis
  // Con varios Arazzo, cada journey muestra de qué archivo viene.
  const multiFile = projects.length > 1
  const journeyName = (key: string) => humanizeId(splitJourneyKey(key).workflowId)
  const stepId = activeId ? steps[activeId] : undefined
  const rs = wa?.steps.find((s) => s.step.stepId === stepId)
  const view: View = (activeId && views[activeId]) || 'overview'
  const shownView: View = view === 'step' && !rs ? 'overview' : view

  const journeyCases = studio.cases.filter((c) => caseJourney(c) === activeId)
  const ready = journeyCases.filter((c) => c.enabled && runnability(c, studio.mode).ok)
  const realCases = ready.filter((c) => !isSimulated(c, studio.mode))
  const mutating = realCases.length ? (wa?.steps.filter((s) => s.mutating && s.op) ?? []) : []
  const messaging = realCases.length ? (wa?.steps.filter((s) => isAsyncOperation(s.op)) ?? []) : []
  const credsMissing = realCases.length > 0 && (analysis?.credentials ?? []).some((c) => !studio.credentials[c.key])
  const values = (activeId && studio.inputs[activeId]) || {}
  const inputsMissing = wa ? missingInputs(wa.inputsSchema, values).length + invalidPaths(wa.inputsSchema, values).length : 0
  const journeyRuns = studio.runs.filter((r) => caseJourney(r.tc) === activeId)

  const openJourney = (id: string, nextView?: View) => {
    studio.setSelected(id)
    // El journey que estaba activo queda abierto como pestaña (al empezar no está en la lista).
    setOpenTabs((prev) => [...new Set([...prev, ...(activeId ? [activeId] : []), id])])
    setEnvActive(false)
    setAskConfirm(false)
    if (nextView) setViews((v) => ({ ...v, [id]: nextView }))
  }
  const openStep = (id: string, step: string) => {
    setSteps((s) => ({ ...s, [id]: step }))
    openJourney(id, 'step')
  }
  const closeTab = (id: string) => {
    const rest = tabs.filter((x) => x !== id)
    setOpenTabs(rest)
    if (id === activeId && rest.length) studio.setSelected(rest[rest.length - 1])
  }
  const openEnv = () => {
    setEnvOpen(true)
    setEnvActive(true)
  }

  const run = (force = false) => {
    if (!activeId || studio.running || !ready.length) return
    if (mutating.length && !studio.confirmed && !force) {
      setAskConfirm(true)
      return
    }
    setAskConfirm(false)
    void studio.runJourney(activeId)
  }

  // faker (variables {{$…}}) se carga en segundo plano, fuera de la carga inicial.
  useEffect(() => {
    void loadFaker()
  }, [])

  // ⌘/Ctrl + Enter ejecuta el journey activo, como "Send" en un cliente de APIs.
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        runRef.current()
      }
      // ⌘/Ctrl + K abre el buscador.
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const changeWidth = (w: number) => {
    setResultsWidth(w)
    try {
      localStorage.setItem(RESULTS_WIDTH_KEY, String(Math.round(w)))
    } catch {
      /* sin almacenamiento: el ancho no se recuerda */
    }
  }

  // Variables del ambiente activo para los campos que aceptan {{nombre}}.
  const templateVars: TemplateVars = {
    variables: studio.activeEnv.variables,
    envName: studio.activeEnv.name,
    onCreate: (name, secret) => studio.envActions.setVariables([...studio.activeEnv.variables, { name, value: '', secret }]),
    onOpenEnv: openEnv,
  }

  const sidebar = (
    <CollectionSidebar
      studio={studio}
      workspace={workspace}
      selection={{ journey: activeId, step: shownView === 'step' ? stepId : undefined, env: envActive }}
      onOpenJourney={(id) => openJourney(id, views[id] === 'step' ? 'overview' : undefined)}
      onOpenStep={openStep}
      onOpenEnv={openEnv}
    />
  )

  // Lo que se puede buscar con ⌘K: journeys, pasos, ambientes y colecciones.
  const paletteItems = (): PaletteItem[] => [
    ...journeys.map((j) => ({
      id: `j:${j.key}`,
      group: t('palette.journeys'),
      label: humanizeId(j.workflowId),
      detail: multiFile ? j.file.split(/[\\/]/).pop() : j.wa.workflow.summary,
      run: () => openJourney(j.key),
    })),
    ...journeys.flatMap((j) =>
      j.wa.steps.map((s) => ({
        id: `s:${j.key}:${s.step.stepId}`,
        group: t('palette.steps'),
        label: s.step.stepId,
        detail: humanizeId(j.workflowId),
        badge: s.op ? { text: s.op.method.toUpperCase(), cls: `m-${s.op.method.toLowerCase()}` } : { text: 'FLOW', cls: 'm-flow' },
        run: () => openStep(j.key, s.step.stepId),
      })),
    ),
    ...studio.environments.map((e) => ({
      id: `e:${e.id}`,
      group: t('palette.environments'),
      label: e.name,
      detail: e.id === studio.activeEnv.id ? t('palette.active') : undefined,
      envColor: e.color ?? '',
      run: () => {
        studio.envActions.select(e.id)
        openEnv()
      },
    })),
    ...workspace.collections.map((c) => ({
      id: `c:${c.folder}`,
      group: t('palette.collections'),
      label: c.name,
      detail: c.folder,
      run: () => void workspace.openCollection(c.folder),
    })),
  ]
  const hasCollection = projects.length > 0 || !!workspace.activeCollection
  const statusBar = (
    <>
      {devTab && <DevPanel tab={devTab} onTab={setDevTab} onClose={() => setDevTab(undefined)} />}
      <StatusBar
        devOpen={!!devTab}
        onDevTools={() => setDevTab((d) => (d ? undefined : 'console'))}
        locale={studio.locale}
        onLocale={studio.changeLocale}
        privacy={t(workspace.isOpen ? 'studio.privacy' : studio.isDesktop ? 'sidebar.privacyDesktop' : 'sidebar.privacy')}
        env={hasCollection ? { name: studio.activeEnv.name, color: studio.activeEnv.color } : undefined}
        onOpenEnv={openEnv}
        onSearch={() => setPaletteOpen(true)}
      />
      {paletteOpen && <CommandPalette items={paletteItems()} onClose={() => setPaletteOpen(false)} />}
    </>
  )

  if (!projects.length) {
    const actions = {
      errors: studio.errors,
      onFiles: studio.addFiles,
      onExample: studio.loadExample,
      onOpenFolder: studio.isDesktop ? studio.openFolder : undefined,
      onCreate: () => openJourney(studio.createArazzo(), 'yaml'),
      savedSession: studio.savedSession,
      onRestore: studio.restoreSession,
      onDiscard: studio.discardSession,
    }
    return (
      <>
      <div className="ws-shell">
        {sidebar}
        <main className="ws-welcome">
          {workspace.isOpen ? (
            <EmptyCollection workspace={workspace} onFiles={studio.addFiles} onCreateArazzo={actions.onCreate} />
          ) : (
            <EmptyWorkspace {...actions} onShowWelcome={() => setWelcomeClosed(false)} />
          )}
        </main>
        {!welcomeClosed && !workspace.isOpen && <WelcomeDialog {...actions} workspace={workspace} onClose={() => setWelcomeClosed(true)} />}
      </div>
      {statusBar}
      </>
    )
  }

  const envView = (
    <div className="ws-center">
      <div className="ws-center-head">
        <h2 className="ws-env-title">
          <EnvDot color={studio.activeEnv.color} /> {t('ws.env.title', { name: studio.activeEnv.name })}
        </h2>
      </div>
      <div className="ws-center-body">
        <EnvironmentView
          sources={studio.collectionSources}
          schemes={studio.collectionSchemes}
          environments={studio.environments}
          activeEnv={studio.activeEnv}
          envActions={studio.envActions}
          credentials={studio.credentials}
          setCredential={studio.setCredential}
          servers={studio.servers}
          setServer={studio.setServer}
        />
      </div>
    </div>
  )

  return (
    <TemplateVarsProvider value={templateVars}>
      <div className="ws-shell">
        {sidebar}
        <main className="ws-main">
          <div className="ws-tabs" role="tablist">
            {tabs.map((id) => (
              <div key={id} className={`ws-tab ${id === activeId && !envActive ? 'active' : ''}`} role="tab" aria-selected={id === activeId && !envActive}>
                <button className="ws-tab-main" onClick={() => openJourney(id)} title={id}>
                  {journeyName(id)}
                  {multiFile && <span className="ws-tab-file">{splitJourneyKey(id).file.split(/[\\/]/).pop()}</span>}
                </button>
                {tabs.length > 1 && (
                  <button className="ws-tab-close" onClick={() => closeTab(id)} aria-label={t('common.close')} title={t('common.close')}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {envOpen && (
              <div className={`ws-tab ${envActive ? 'active' : ''}`} role="tab" aria-selected={envActive}>
                <button className="ws-tab-main ws-env-tab" onClick={() => setEnvActive(true)}>
                  <EnvDot color={studio.activeEnv.color} /> {studio.activeEnv.name}
                </button>
                <button
                  className="ws-tab-close"
                  onClick={() => {
                    setEnvOpen(false)
                    setEnvActive(false)
                  }}
                  aria-label={t('common.close')}
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {studio.errors.length > 0 && !errorsHidden && (
            <div className="callout err small ws-errors">
              <div className="row">
                <div className="grow">
                  {studio.errors.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
                <button className="link" onClick={() => setErrorsHidden(true)}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          )}

          {envActive ? (
            <div className="ws-body">{envView}</div>
          ) : wa ? (
            <>
              <div className="ws-runbar">
                <div className="ws-runbar-title">
                  <h2 title={wa.workflow.workflowId}>{humanizeId(wa.workflow.workflowId)}</h2>
                  <span className="muted small clamp-1">
                    {[multiFile ? journey?.file : '', wa.workflow.summary, messaging.length ? t('ws.run.messaging', { n: messaging.length }) : ''].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <span className="spacer" />
                <Segmented
                  options={[
                    { id: 'real', label: t('common.realApi'), hint: t('cases.mode.realHint') },
                    { id: 'simulado', label: t('cases.mode.simulation'), hint: t('cases.mode.simHint') },
                  ]}
                  value={studio.mode}
                  onChange={(m) => {
                    studio.setMode(m)
                    setAskConfirm(false)
                  }}
                />
                <label className="ws-env-select" title={t('ws.run.env')}>
                  <span className="muted small">{t('ws.run.env')}</span>
                  <select
                    className={studio.activeEnv.color ? `c-${studio.activeEnv.color}` : undefined}
                    value={studio.activeEnv.id}
                    onChange={(e) => {
                      if (e.target.value === '__config') openEnv()
                      else studio.envActions.select(e.target.value)
                    }}
                  >
                    {studio.environments.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                    <option value="__config">{t('ws.run.configureEnv')}</option>
                  </select>
                </label>
                {studio.running ? (
                  <button onClick={studio.cancelRun}>{t('common.cancel')}</button>
                ) : (
                  <button className="primary ws-run" disabled={!ready.length} onClick={() => run()} title={ready.length ? t('ws.run.shortcut') : t('cases.block.none')}>
                    <Icon d={PLAY_ICON} size={14} /> {t('ws.run.button', { n: ready.length })}
                  </button>
                )}
              </div>

              {askConfirm && (
                <div className="ws-strip warn" role="alert">
                  <div className="grow">
                    <strong>{t('cases.mutatingEnv', { env: studio.activeEnv.name })}</strong>
                    <div className="ws-strip-list">
                      {mutating.map((s) => (
                        <span key={s.step.stepId}>
                          <MethodBadge method={s.op!.method} /> <code>{(studio.servers[s.op!.sourceName] || t('cases.noServer')) + s.op!.path}</code>
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    className="primary"
                    onClick={() => {
                      studio.setConfirmed(true)
                      run(true)
                    }}
                  >
                    {t('ws.run.confirm')}
                  </button>
                  <button
                    onClick={() => {
                      setAskConfirm(false)
                      void studio.runJourney(activeId!, 'simulado')
                    }}
                  >
                    {t('ws.run.simulateInstead')}
                  </button>
                  <button className="link" onClick={() => setAskConfirm(false)}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
              {!askConfirm && credsMissing && (
                <div className="ws-strip info">
                  <span className="grow">{t('ws.run.credsMissing', { env: studio.activeEnv.name })}</span>
                  <button className="small" onClick={openEnv}>
                    {t('ws.run.completeCreds')}
                  </button>
                </div>
              )}

              <div className="ws-body">
                <div className="ws-center">
                  <div className="ws-center-head">
                    <Tabs<View>
                      value={shownView}
                      onChange={(v) => setViews((prev) => ({ ...prev, [activeId!]: v }))}
                      tabs={[
                        { id: 'overview', label: t('ws.view.overview'), ...(wa.issues.some((i) => i.level === 'error') ? { count: wa.issues.filter((i) => i.level === 'error').length, tone: 'err' as const } : {}) },
                        { id: 'inputs', label: 'Inputs', ...(inputsMissing ? { count: inputsMissing, tone: 'warn' as const } : {}) },
                        { id: 'cases', label: t('ws.view.cases'), count: ready.length },
                        { id: 'yaml', label: 'YAML' },
                        ...(rs ? [{ id: 'step' as const, label: <span className="ws-step-tab">{rs.op && <MethodBadge method={rs.op.method} />} {rs.step.stepId}</span> }] : []),
                      ]}
                    />
                  </div>
                  <div className={`ws-center-body ${shownView === 'yaml' ? 'fill' : ''}`}>
                    {shownView === 'overview' && analysis && <OverviewView analysis={analysis} wa={wa} />}
                    {shownView === 'inputs' && <InputsView wa={wa} values={values} setInput={(_, name, v) => studio.setInput(activeId!, name, v)} />}
                    {shownView === 'cases' && (
                      <CasesView
                        wa={wa}
                        cases={journeyCases}
                        {...studio.caseActions}
                        addCase={(tc) => studio.caseActions.addCase(tc, activeId!)}
                        onExportScenarios={studio.exportScenariosFile}
                        onImportScenarios={studio.importScenariosFile}
                        base={values}
                        mode={studio.mode}
                        running={studio.running}
                        onRunCase={(id) => void studio.runJourney(activeId!, studio.mode, [id])}
                        variables={studio.activeEnv.variables.filter((v) => v.name).map((v) => v.name)}
                      />
                    )}
                    {shownView === 'yaml' && journey && studio.arazzoText(journey.file) !== undefined && (
                      <Suspense fallback={<Empty>{t('editor.loading')}</Empty>}>
                        <ArazzoEditor
                          key={journey.file}
                          fileName={journey.file}
                          text={studio.arazzoText(journey.file)!}
                          original={studio.arazzoOriginal(journey.file) ?? studio.arazzoText(journey.file)!}
                          project={journey.project}
                          analysis={journey.analysis}
                          selected={wa.workflow.workflowId}
                          onChange={(text) => studio.editArazzo(journey.file, text)}
                          onSave={(text) =>
                            // En un workspace todo se guarda solo; "Guardar" solo adelanta el guardado.
                            workspace.isOpen ? workspace.saveNow().then(() => 'saved' as const) : studio.saveArazzo(journey.file, text)
                          }
                          showDiagram={false}
                        />
                      </Suspense>
                    )}
                    {shownView === 'step' && rs && (
                      <StepView wa={wa} rs={rs} servers={studio.servers} onEditYaml={() => setViews((prev) => ({ ...prev, [activeId!]: 'yaml' }))} />
                    )}
                  </div>
                </div>
                <Splitter width={resultsWidth} onChange={changeWidth} />
                <aside className="ws-results" style={{ width: resultsWidth }}>
                  <ResultsPanel
                    key={activeId}
                    runs={journeyRuns}
                    running={studio.running && journeyRuns.some((r) => r.state !== 'done')}
                    onCancel={studio.cancelRun}
                    onRerun={() => run()}
                    onRunSimulated={() => void studio.runJourney(activeId!, 'simulado')}
                    onEditEnvironment={openEnv}
                    onExport={studio.exportReport}
                  />
                </aside>
              </div>
            </>
          ) : (
            <div className="ws-body">
              <Empty>{t('ws.noJourneys')}</Empty>
            </div>
          )}
        </main>
      </div>
      {statusBar}
    </TemplateVarsProvider>
  )
}
