// Espacio de trabajo: colección a la izquierda, journey abierto al centro y su resultado a la derecha.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import { RequestView } from '../ui/requests/RequestView'
import { FlowAuthView } from '../ui/workspace/FlowAuthView'
import { journeyApis } from '../core/flowAuth'
import { NewRequestDialog } from '../ui/requests/NewRequestDialog'
import { requestBadge, type RequestKind } from '../core/requests'
import { CommandPalette, type PaletteItem } from '../ui/workspace/CommandPalette'
import type { ContractUsage } from '../ui/components/ContractEditor'
import { TryOperation, type TryState } from '../ui/workspace/TryOperation'
import { redactSecrets, secretValues, variableValues } from '../core/environments'
import { resolveTemplates } from '../core/templates'
import type { HttpRequest } from '../core/http'
import { byteSize, log, logNetwork } from '../lib/devlog'

/** Body de texto como JSON si se puede (para verlo ordenado en Network). */
function parseBody(text?: string): unknown {
  if (text === undefined || text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
import { initialForm, tryKey } from '../core/tryOperation'
import { getServerUrl, listOperations, operationSecurity, type OperationRef } from '../core/openapi'
import { MethodBadge as TabMethod } from '../ui/components/badges'
import { CollectionSidebar } from './CollectionSidebar'
import { StatusBar } from './StatusBar'
import { ContextMenu, type ContextItem } from '../ui/components/ContextMenu'
import { desktop } from '../lib/desktop'
import { useUiMode } from '../lib/uiMode'

const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'
import { WorkspaceHome } from '../ui/workspace/WorkspaceHome'
import { CollectionOverview } from '../ui/workspace/CollectionOverview'
import type { Studio } from './useStudio'
import type { WorkspaceState } from './useWorkspace'

// El editor (CodeMirror) pesa bastante: se carga solo al abrir la pestaña YAML.
const ArazzoEditor = lazy(() => import('../ui/components/ArazzoEditor').then((m) => ({ default: m.ArazzoEditor })))
const ContractEditor = lazy(() => import('../ui/components/ContractEditor').then((m) => ({ default: m.ContractEditor })))

type View = 'overview' | 'inputs' | 'cases' | 'auth' | 'yaml' | 'step'

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

export function Workspace({
  studio,
  workspace,
  dev,
  homeRequest = 0,
  onOpenTerminal,
  onTour,
}: {
  studio: Studio
  workspace: WorkspaceState
  dev: { open: boolean; toggle: () => void }
  /** Sube cada vez que se pide ir al inicio (logo de la barra superior). */
  homeRequest?: number
  /** Escritorio: abre la terminal de Dev Tools en una carpeta. */
  onOpenTerminal?: (cwd?: string) => void
  /** Empieza el tour guiado. */
  onTour: () => void
}) {
  // Interfaz simple: nombres legibles en lugar de identificadores técnicos.
  const simple = useUiMode() === 'simple'
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
  // Contratos abiertos como pestañas (por nombre de archivo) y el que se está viendo.
  const [contractTabs, setContractTabs] = useState<string[]>([])
  const [activeContract, setActiveContract] = useState<string>()
  // Operaciones abiertas para probarlas solas (clave fuente|MÉTODO|ruta) y lo escrito en cada una.
  const [tryTabs, setTryTabs] = useState<string[]>([])
  const [activeTry, setActiveTry] = useState<string>()
  const [tryStates, setTryStates] = useState<Record<string, TryState>>({})
  // Requests sueltos abiertos como pestañas (por ruta) y el que se está viendo.
  const [reqTabs, setReqTabs] = useState<string[]>([])
  const [activeReq, setActiveReq] = useState<string>()
  const [newRequest, setNewRequest] = useState<{ curl?: boolean }>()
  // Inicio del workspace: se muestra al abrirlo y al pulsar el logo.
  const [homeActive, setHomeActive] = useState(true)
  const [homeFor, setHomeFor] = useState({ ws: workspace.name, request: homeRequest })
  if (homeFor.ws !== workspace.name || homeFor.request !== homeRequest) {
    setHomeFor({ ws: workspace.name, request: homeRequest })
    setHomeActive(true)
  }
  const showHome = workspace.isOpen && homeActive
  // Resumen de la colección abierta (como el Overview de una colección en Bruno).
  const [colTab, setColTab] = useState(false)
  const [colActive, setColActive] = useState(false)
  const colShown = colTab && colActive && !showHome && !!workspace.activeCollection
  const openCollectionOverview = async (folder?: string) => {
    if (folder && folder !== workspace.activeCollection?.folder) await workspace.openCollection(folder)
    setColTab(true)
    setColActive(true)
    setHomeActive(false)
    setActiveContract(undefined)
    setActiveTry(undefined)
    setActiveReq(undefined)
    setEnvActive(false)
  }
  // La bienvenida se muestra mientras no haya colección, salvo que se haya cerrado.
  const [welcomeClosed, setWelcomeClosed] = useState(false)
  if (projects.length && welcomeClosed) setWelcomeClosed(false)

  // Las pestañas y la selección usan la clave del journey (archivo#workflowId).
  const exists = (key: string) => journeys.some((j) => j.key === key)
  const activeId = exists(studio.selected) ? studio.selected : journeys[0]?.key
  // Con "Cerrar todas" el journey activo también deja de tener pestaña, hasta que se abra uno.
  const [journeyTabsClosed, setJourneyTabsClosed] = useState(false)
  const tabs = [...new Set([...openTabs.filter(exists), ...(activeId && !journeyTabsClosed ? [activeId] : [])])]
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
  // Las APIs con autorización propia (por API o por journey) no usan las credenciales del contrato.
  const credsMissing =
    realCases.length > 0 && (analysis?.credentials ?? []).some((c) => !studio.credentials[c.key] && !(activeId && studio.requests.resolveFlow(activeId, c.sourceName).auth))
  const apis = wa ? journeyApis(wa) : []
  const ownAuthCount = activeId ? apis.filter((a) => studio.requests.resolveFlow(activeId, a.source).auth).length : 0
  // OAuth 2.0 con inicio de sesión y sin token vigente: se pide antes de ejecutar contra la API real.
  const loginNeeded = activeId && realCases.length ? studio.requests.flowLoginNeeded(activeId, apis.map((a) => a.source)) : []
  const [loginError, setLoginError] = useState<string>()
  const values = (activeId && studio.inputs[activeId]) || {}
  const inputsMissing = wa ? missingInputs(wa.inputsSchema, values).length + invalidPaths(wa.inputsSchema, values).length : 0
  const journeyRuns = studio.runs.filter((r) => caseJourney(r.tc) === activeId)

  const openJourney = (id: string, nextView?: View) => {
    studio.setSelected(id)
    // El journey que estaba activo queda abierto como pestaña (al empezar no está en la lista).
    setOpenTabs((prev) => [...new Set([...prev, ...(activeId && !journeyTabsClosed ? [activeId] : []), id])])
    setJourneyTabsClosed(false)
    setEnvActive(false)
    setActiveContract(undefined)
    setActiveTry(undefined)
    setActiveReq(undefined)
    setHomeActive(false)
    setColActive(false)
    setAskConfirm(false)
    if (nextView) setViews((v) => ({ ...v, [id]: nextView }))
  }
  const openStep = (id: string, step: string) => {
    setSteps((s) => ({ ...s, [id]: step }))
    openJourney(id, 'step')
  }
  const openEnv = () => {
    setEnvOpen(true)
    setEnvActive(true)
    setActiveContract(undefined)
    setActiveTry(undefined)
    setActiveReq(undefined)
    setHomeActive(false)
    setColActive(false)
  }
  /** La operación de una clave, buscada en los contratos cargados ahora (sigue a las ediciones). */
  const findOperation = (key: string): OperationRef | undefined => {
    const [sourceName, method, ...rest] = key.split('|')
    const path = rest.join('|')
    const source = studio.collectionSources.find((s) => s.name === sourceName && s.status === 'loaded')
    return source ? listOperations(source).find((o) => o.method.toUpperCase() === method && o.path === path) : undefined
  }
  const shownTries = tryTabs.filter((k) => findOperation(k))
  const tryOpen = activeTry && shownTries.includes(activeTry) ? activeTry : undefined
  const openTry = (op: OperationRef) => {
    const key = tryKey(op)
    setTryStates((prev) => (prev[key] ? prev : { ...prev, [key]: { form: initialForm(op), simulate: false } }))
    setTryTabs((prev) => (prev.includes(key) ? prev : [...prev, key]))
    setActiveTry(key)
    setActiveReq(undefined)
    setHomeActive(false)
    setColActive(false)
    setActiveContract(undefined)
    setEnvActive(false)
  }
  const closeTry = (key: string) => {
    setTryTabs((prev) => prev.filter((k) => k !== key))
    if (key === activeTry) setActiveTry(undefined)
  }
  // Pestañas de contrato que siguen existiendo en la colección.
  const shownContracts = contractTabs.filter((f) => studio.contractText(f) !== undefined)
  const contractOpen = activeContract && shownContracts.includes(activeContract) ? activeContract : undefined
  const openContract = (file: string) => {
    setContractTabs((prev) => (prev.includes(file) ? prev : [...prev, file]))
    setActiveContract(file)
    setActiveReq(undefined)
    setHomeActive(false)
    setColActive(false)
    setActiveTry(undefined)
    setEnvActive(false)
  }
  // Requests sueltos que siguen existiendo en la colección.
  const shownReqs = reqTabs.filter((p) => studio.requests.list.some((r) => r.path === p))
  const reqOpen = activeReq && shownReqs.includes(activeReq) ? activeReq : undefined
  const openRequest = (path: string) => {
    setReqTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
    setActiveReq(path)
    setHomeActive(false)
    setColActive(false)
    setActiveContract(undefined)
    setActiveTry(undefined)
    setEnvActive(false)
  }
  const closeRequest = (path: string) => {
    setReqTabs((prev) => prev.filter((p) => p !== path))
    if (path === activeReq) setActiveReq(undefined)
  }
  /** Renombra un request (y su archivo); sus pestañas siguen a la ruta nueva. */
  const renameRequest = (path: string, name: string) => {
    const next = studio.requests.rename(path, name)
    if (next === path) return
    setReqTabs((prev) => prev.map((p) => (p === path ? next : p)))
    setActiveReq((a) => (a === path ? next : a))
  }
  // Un request nuevo vive en la colección abierta (en un workspace, hace falta una).
  const canCreateRequest = !workspace.isOpen || !!workspace.activeCollection
  const createRequest = (kind: RequestKind) => {
    setNewRequest(undefined)
    openRequest(studio.requests.create(kind).path)
  }
  const createRequestFromCurl = (command: string): string | undefined => {
    try {
      const r = studio.requests.createFromCurl(command)
      setNewRequest(undefined)
      openRequest(r.path)
    } catch {
      return t('request.curl.invalid')
    }
  }
  const closeContract = (file: string) => {
    setContractTabs((prev) => prev.filter((f) => f !== file))
    if (file === activeContract) setActiveContract(undefined)
  }

  const run = (force = false) => {
    if (!activeId || studio.running || !ready.length) return
    // Con un contrato, una operación o el ambiente a la vista, ⌘Enter no ejecuta el journey de fondo.
    if (activeContract || activeTry || envActive || reqOpen) return
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

  const createArazzoAndOpen = () => openJourney(studio.createArazzo(), 'yaml')
  const sidebar = (
    <CollectionSidebar
      studio={studio}
      workspace={workspace}
      selection={{ journey: activeId, step: shownView === 'step' ? stepId : undefined, env: envActive }}
      onOpenJourney={(id) => openJourney(id, views[id] === 'step' ? 'overview' : undefined)}
      onOpenStep={openStep}
      onOpenEnv={openEnv}
      onOpenContract={openContract}
      activeContract={contractOpen}
      onOpenTerminal={onOpenTerminal}
      onOpenCollectionOverview={(folder) => void openCollectionOverview(folder)}
      onOpenRequest={openRequest}
      onRenameRequest={renameRequest}
      onNewRequest={(opts) => setNewRequest(opts ?? {})}
      activeRequest={reqOpen}
      onNewArazzo={() => createArazzoAndOpen()}
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
    ...studio.collectionSources
      .filter((src) => src.fileName)
      .map((src) => ({
        id: `k:${src.name}`,
        group: t('palette.contracts'),
        label: src.name,
        detail: src.fileName,
        badge: { text: src.type === 'asyncapi' ? 'ASYNC' : 'API', cls: 'm-flow' },
        run: () => openContract(src.fileName!),
      })),
    ...studio.requests.list.map((r) => {
      const badge = requestBadge(r)
      return { id: `r:${r.path}`, group: t('palette.requests'), label: r.name, detail: r.url, badge: { text: badge.text, cls: badge.cls }, run: () => openRequest(r.path) }
    }),
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
      <StatusBar
        devOpen={dev.open}
        onTour={onTour}
        onDevTools={dev.toggle}
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

  // --- Pestañas: lista en el orden en que se ven, cerrar varias a la vez y menú contextual ---
  type TabRef = { kind: 'home' | 'collection' | 'journey' | 'env' | 'contract' | 'try' | 'request'; id: string }
  const tabList: TabRef[] = [
    ...(workspace.isOpen ? [{ kind: 'home' as const, id: 'home' }] : []),
    ...(colTab && workspace.activeCollection ? [{ kind: 'collection' as const, id: 'collection' }] : []),
    ...tabs.map((id) => ({ kind: 'journey' as const, id })),
    ...(envOpen ? [{ kind: 'env' as const, id: 'env' }] : []),
    ...shownContracts.map((id) => ({ kind: 'contract' as const, id })),
    ...shownTries.map((id) => ({ kind: 'try' as const, id })),
    ...shownReqs.map((id) => ({ kind: 'request' as const, id })),
  ]
  const sameTab = (a: TabRef, b: TabRef) => a.kind === b.kind && a.id === b.id
  /** La pestaña que se está viendo (la que cierra ⌘W). */
  const currentTab: TabRef | undefined = showHome
    ? undefined
    : colShown
      ? { kind: 'collection', id: 'collection' }
      : reqOpen
        ? { kind: 'request', id: reqOpen }
        : tryOpen
        ? { kind: 'try', id: tryOpen }
        : contractOpen
          ? { kind: 'contract', id: contractOpen }
          : envActive
            ? { kind: 'env', id: 'env' }
            : activeId
              ? { kind: 'journey', id: activeId }
              : undefined
  const closeTabs = (refs: TabRef[]) => {
    const ids = (kind: TabRef['kind']) => new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))
    if (refs.some((r) => r.kind === 'collection')) {
      setColTab(false)
      setColActive(false)
    }
    const journeysOut = ids('journey')
    if (journeysOut.size) {
      const rest = tabs.filter((x) => !journeysOut.has(x))
      setOpenTabs(rest)
      if (activeId && journeysOut.has(activeId) && rest.length) studio.setSelected(rest[rest.length - 1])
      if (!rest.length && workspace.isOpen) setJourneyTabsClosed(true)
    }
    if (refs.some((r) => r.kind === 'env')) {
      setEnvOpen(false)
      setEnvActive(false)
    }
    const contractsOut = ids('contract')
    if (contractsOut.size) {
      setContractTabs((prev) => prev.filter((f) => !contractsOut.has(f)))
      if (activeContract && contractsOut.has(activeContract)) setActiveContract(undefined)
    }
    const reqsOut = ids('request')
    if (reqsOut.size) {
      setReqTabs((prev) => prev.filter((k) => !reqsOut.has(k)))
      if (activeReq && reqsOut.has(activeReq)) setActiveReq(undefined)
    }
    const triesOut = ids('try')
    if (triesOut.size) {
      setTryTabs((prev) => prev.filter((k) => !triesOut.has(k)))
      if (activeTry && triesOut.has(activeTry)) setActiveTry(undefined)
    }
    // Si se cerró lo que se estaba viendo (o todo), se vuelve al inicio.
    if (workspace.isOpen && (!currentTab || refs.some((r) => sameTab(r, currentTab)))) setHomeActive(true)
  }
  const closable = (r: TabRef) => r.kind !== 'home'
  const [menu, setMenu] = useState<{ x: number; y: number; tab: TabRef }>()
  const tabMenu = (tab: TabRef) => (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, tab })
  }
  const menuItems = (tab: TabRef): ContextItem[] => {
    const i = tabList.findIndex((r) => sameTab(r, tab))
    const left = tabList.slice(0, i).filter(closable)
    const right = tabList.slice(i + 1).filter(closable)
    const others = tabList.filter((r) => !sameTab(r, tab) && closable(r))
    const all = tabList.filter(closable)
    const canCreate = projects.length > 0 || !!workspace.activeCollection
    return [
      { label: t('tabs.newArazzo'), shortcut: desktop ? `${MOD}N` : undefined, disabled: !canCreate, onSelect: createArazzoAndOpen },
      { separator: true },
      { label: t('tabs.close'), shortcut: desktop ? `${MOD}W` : undefined, disabled: !closable(tab), onSelect: () => closeTabs([tab]) },
      { label: t('tabs.closeOthers'), disabled: !others.length, onSelect: () => closeTabs(others) },
      { label: t('tabs.closeLeft'), disabled: !left.length, onSelect: () => closeTabs(left) },
      { label: t('tabs.closeRight'), disabled: !right.length, onSelect: () => closeTabs(right) },
      { label: t('tabs.closeAll'), shortcut: desktop ? `⇧${MOD}W` : undefined, disabled: !all.length, onSelect: () => closeTabs(all) },
    ]
  }
  // Atajos de la app de escritorio (el navegador se reserva ⌘W y ⌘N).
  const shortcuts = useRef({ closeCurrent: () => {}, closeAll: () => {}, create: () => {} })
  useLayoutEffect(() => {
    shortcuts.current = {
      closeCurrent: () => currentTab && closeTabs([currentTab]),
      closeAll: () => closeTabs(tabList.filter(closable)),
      create: () => (projects.length > 0 || workspace.activeCollection) && createArazzoAndOpen(),
    }
  })
  useEffect(
    () =>
      desktop?.onShortcut((name) => {
        if (name === 'closeTab') shortcuts.current.closeCurrent()
        else if (name === 'closeAll') shortcuts.current.closeAll()
        else if (name === 'newArazzo') shortcuts.current.create()
      }),
    [],
  )
  const tabContextMenu = menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.tab)} onClose={() => setMenu(undefined)} /> : null

  const homeTab = workspace.isOpen ? (
    <div className={`ws-tab ws-home-tab ${showHome ? 'active' : ''}`} role="tab" aria-selected={showHome} onContextMenu={tabMenu({ kind: 'home', id: 'home' })}>
      <button className="ws-tab-main" onClick={() => setHomeActive(true)} title={t('home.title')}>
        <Icon d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" size={14} /> {t('home.title')}
      </button>
    </div>
  ) : null
  const collectionView = (
    <CollectionOverview
      workspace={workspace}
      journeys={journeys}
      sources={studio.collectionSources}
      environments={studio.environments}
      casesCount={studio.cases.length}
      verdicts={studio.runs.filter((r) => r.state === 'done' && r.verdict).map((r) => r.verdict!)}
      onOpenEnv={openEnv}
      onOpenJourney={(key) => openJourney(key)}
      onOpenContract={openContract}
      onOpenTerminal={onOpenTerminal}
      requests={studio.requests}
      isDesktop={studio.isDesktop}
    />
  )
  const homeView = (
    <WorkspaceHome
      workspace={workspace}
      stats={{ journeys: journeys.length, arazzo: projects.length, contracts: studio.collectionSources.length, environments: workspace.activeCollection ? studio.environments.length : 0 }}
      onFiles={(files) => {
        void studio.addFiles(files)
        setHomeActive(false)
    setColActive(false)
      }}
      onOpenCollection={(folder) => void openCollectionOverview(folder)}
    />
  )

  // Dentro de un workspace, una colección sin Arazzo no es un error (puede tener solo contratos).
  const shownErrors = workspace.isOpen ? studio.errors.filter((e) => e !== t('load.noArazzo')) : studio.errors

  if (!projects.length && !workspace.isOpen) {
    const actions = {
      errors: studio.errors,
      onFiles: studio.addFiles,
      onExample: studio.loadExample,
      onTour,
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
            showHome || !workspace.collections.length ? (
              <div className="ws-main ws-home-only">
                <div className="ws-tabs" role="tablist">
                  {homeTab}
                </div>
                <div className="ws-body ws-home">{homeView}</div>
              </div>
            ) : (
              <EmptyCollection workspace={workspace} onFiles={studio.addFiles} onCreateArazzo={actions.onCreate} />
            )
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

  /** Journeys que usan un contrato (directo, o por $ref desde su contrato) y sus problemas actuales. */
  const contractUsage = (file: string): ContractUsage[] => {
    const base = file.split(/[\\/]/).pop() ?? file
    const usesFile = (j: (typeof journeys)[number]) =>
      j.project.sources.some((s) => s.fileName === file || (!!s.fileName && !!studio.contractText(s.fileName)?.text.includes(base)))
    return journeys.filter(usesFile).map((j) => ({
      key: j.key,
      name: humanizeId(j.workflowId),
      file: j.file,
      problems: j.wa.issues.map((i) => ({ level: i.level, message: i.message, stepId: i.stepId })),
    }))
  }

  /** Swagger UI de un contrato: servidor y credenciales del ambiente, y "Try it out" por la app. */
  const swaggerFor = (file: string) => {
    // Sin fuente (un contrato que ningún Arazzo usa todavía) no hay URL ni credenciales del ambiente.
    const src = studio.collectionSources.find((s) => s.fileName === file && s.status === 'loaded')
    const vars = variableValues(studio.activeEnv)
    const schemes = src?.doc?.components?.securitySchemes ?? {}
    const credentials = Object.entries<any>(schemes).map(([name, scheme]) => ({
      schemeName: name,
      type: scheme?.type === 'http' && String(scheme?.scheme).toLowerCase() === 'basic' ? 'basic' : String(scheme?.type ?? ''),
      value: src ? String(resolveTemplates(studio.credentials[`${src.name}:${name}`] ?? '', vars)) : '',
    }))
    const url = src ? String(resolveTemplates(studio.servers[src.name] ?? '', vars)) : ''
    return {
      envServer: url ? { url, envName: studio.activeEnv.name } : undefined,
      credentials,
      secrets: secretValues({ variables: studio.activeEnv.variables, credentials: Object.fromEntries(credentials.map((c) => [c.schemeName, c.value])) }),
      onRequest: async (req: HttpRequest) => {
        const env = await studio.requestEnv()
        const shown = redactSecrets(req, env.secrets)
        const entry = {
          kind: 'http' as const,
          method: req.method,
          url: shown.url,
          simulated: false,
          journey: 'Swagger UI',
          step: new URL(req.url).pathname,
          caseName: 'Try it out',
          request: { headers: shown.headers, body: parseBody(shown.body) },
        }
        try {
          const res = await studio.sendHttp(req)
          const body = redactSecrets(parseBody(res.bodyText), env.secrets)
          logNetwork({ ...entry, status: res.status, statusText: res.statusText, durationMs: res.durationMs, size: byteSize(res.bodyText), failed: res.status >= 400, response: { headers: res.headers, body } })
          return res
        } catch (e) {
          logNetwork({ ...entry, failed: true })
          log('error', `${req.method} ${shown.url}: ${(e as Error).message}`, { source: 'app' })
          throw e
        }
      },
    }
  }

  const contractView = (file: string) => {
    const current = studio.contractText(file)
    if (!current) return null
    return (
      <Suspense fallback={<Empty>{t('editor.loading')}</Empty>}>
        <ContractEditor
          key={`${file}:${current.editable}`}
          fileName={file}
          text={current.text}
          original={studio.arazzoOriginal(file) ?? current.text}
          editable={current.editable}
          onChange={(text) => studio.editContract(file, text)}
          onSave={(text) => (workspace.isOpen ? workspace.saveNow().then(() => 'saved' as const) : studio.saveArazzo(file, text))}
          onMakeLocalCopy={() => studio.makeLocalCopy(file)}
          usage={contractUsage(file)}
          related={studio.contractFiles.filter((f) => f !== file && current.text.includes(f.split(/[\\/]/).pop() ?? f))}
          onOpenFile={openContract}
          docDoc={studio.collectionSources.find((s) => s.fileName === file && s.status === 'loaded')?.doc}
          swagger={swaggerFor(file)}
          onOpenJourney={(key, step) => (step ? openStep(key, step) : openJourney(key))}
        />
      </Suspense>
    )
  }

  const tryView = (key: string, known?: OperationRef, compact = false) => {
    const op = known ?? findOperation(key)
    if (!op) return null
    // Sin estado todavía (primer "Try it out"): se parte del ejemplo del contrato.
    const state = tryStates[key] ?? { form: initialForm(op), simulate: false }
    const source = studio.collectionSources.find((s) => s.name === op.sourceName)
    return (
      <TryOperation
        key={key}
        op={op}
        server={studio.servers[op.sourceName] || getServerUrl(source)}
        env={{ name: studio.activeEnv.name, color: studio.activeEnv.color }}
        security={operationSecurity(op).map((s) => ({ ...s, set: !!studio.credentials[s.key] }))}
        state={state}
        onState={(next) => setTryStates((prev) => ({ ...prev, [key]: next }))}
        onSend={async (signal) => {
          const r = await studio.tryOperation(op, state.form, state.simulate, signal)
          setTryStates((prev) => ({ ...prev, [key]: { ...prev[key], result: r.step, error: r.error, runId: (prev[key]?.runId ?? 0) + 1 } }))
        }}
        onOpenEnv={openEnv}
        compact={compact}
      />
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
            {homeTab}
            {colTab && workspace.activeCollection && (
              <div className={`ws-tab ${colShown ? 'active' : ''}`} role="tab" aria-selected={colShown} onContextMenu={tabMenu({ kind: 'collection', id: 'collection' })}>
                <button className="ws-tab-main ws-home-tab-btn" onClick={() => void openCollectionOverview()} title={t('collection.overview')}>
                  <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" size={13} />{' '}
                  {workspace.activeCollection.name}
                </button>
                <button
                  className="ws-tab-close"
                  onClick={() => {
                    setColTab(false)
                    setColActive(false)
                  }}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                >
                  ×
                </button>
              </div>
            )}
            {tabs.map((id) => (
              <div key={id} className={`ws-tab ${id === activeId && !envActive && !contractOpen && !tryOpen && !reqOpen && !showHome && !colShown ? 'active' : ''}`} role="tab" aria-selected={id === activeId && !envActive && !contractOpen && !tryOpen && !reqOpen && !showHome && !colShown} onContextMenu={tabMenu({ kind: 'journey', id })}>
                <button className="ws-tab-main" onClick={() => openJourney(id)} title={id}>
                  {journeyName(id)}
                  {multiFile && <span className="ws-tab-file">{splitJourneyKey(id).file.split(/[\\/]/).pop()}</span>}
                </button>
                {(tabs.length > 1 || workspace.isOpen) && (
                  <button className="ws-tab-close" onClick={() => closeTabs([{ kind: 'journey', id }])} aria-label={t('common.close')} title={t('common.close')}>
                    ×
                  </button>
                )}
              </div>
            ))}
            {envOpen && (
              <div className={`ws-tab ${envActive && !contractOpen && !tryOpen && !reqOpen && !showHome && !colShown ? 'active' : ''}`} role="tab" aria-selected={envActive && !contractOpen && !tryOpen && !reqOpen && !showHome && !colShown} onContextMenu={tabMenu({ kind: 'env', id: 'env' })}>
                <button
                  className="ws-tab-main ws-env-tab"
                  onClick={() => {
                    setEnvActive(true)
                    setActiveContract(undefined)
                    setActiveTry(undefined)
                    setActiveReq(undefined)
                    setHomeActive(false)
    setColActive(false)
                  }}
                >
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
            {shownContracts.map((file) => (
              <div key={file} className={`ws-tab ${file === contractOpen && !tryOpen && !reqOpen && !showHome && !colShown ? 'active' : ''}`} role="tab" aria-selected={file === contractOpen && !tryOpen && !reqOpen && !showHome && !colShown} onContextMenu={tabMenu({ kind: 'contract', id: file })}>
                <button className="ws-tab-main ws-contract-tab" onClick={() => openContract(file)} title={file}>
                  <span className="ws-tab-icon">{'{ }'}</span> {file.split(/[\\/]/).pop()}
                </button>
                <button className="ws-tab-close" onClick={() => closeContract(file)} aria-label={t('common.close')} title={t('common.close')}>
                  ×
                </button>
              </div>
            ))}
            {shownTries.map((key) => {
              const [, method, ...rest] = key.split('|')
              return (
                <div key={key} className={`ws-tab ${key === tryOpen && !reqOpen && !showHome && !colShown ? 'active' : ''}`} role="tab" aria-selected={key === tryOpen && !reqOpen && !showHome && !colShown} onContextMenu={tabMenu({ kind: 'try', id: key })}>
                  <button
                    className="ws-tab-main ws-try-tab"
                    onClick={() => {
                      setActiveTry(key)
                      setActiveReq(undefined)
                      setHomeActive(false)
    setColActive(false)
                    }} title={key.replace(/\|/g, ' ')}>
                    <TabMethod method={method} /> {rest.join('|')}
                  </button>
                  <button className="ws-tab-close" onClick={() => closeTry(key)} aria-label={t('common.close')} title={t('common.close')}>
                    ×
                  </button>
                </div>
              )
            })}
            {shownReqs.map((path) => {
              const r = studio.requests.list.find((x) => x.path === path)!
              const badge = requestBadge(r)
              const on = path === reqOpen && !showHome && !colShown
              return (
                <div key={path} className={`ws-tab ${on ? 'active' : ''}`} role="tab" aria-selected={on} onContextMenu={tabMenu({ kind: 'request', id: path })}>
                  <button className="ws-tab-main ws-request-tab" onClick={() => openRequest(path)} title={r.url || r.name}>
                    <span className={`method ${badge.cls}`}>{badge.text}</span> {r.name}
                  </button>
                  <button className="ws-tab-close" onClick={() => closeRequest(path)} aria-label={t('common.close')} title={t('common.close')}>
                    ×
                  </button>
                </div>
              )
            })}
          </div>

          {shownErrors.length > 0 && !errorsHidden && (
            <div className="callout err small ws-errors">
              <div className="row">
                <div className="grow">
                  {shownErrors.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
                <button className="link" onClick={() => setErrorsHidden(true)}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          )}

          {showHome ? (
            <div className="ws-body ws-home">{homeView}</div>
          ) : colShown ? (
            <div className="ws-body ws-home">{collectionView}</div>
          ) : reqOpen ? (
            <div className="ws-body ws-request">
              <RequestView
                key={reqOpen}
                request={studio.requests.list.find((r) => r.path === reqOpen)!}
                api={studio.requests}
                result={studio.requests.results[reqOpen]}
                sending={!!studio.requests.sending[reqOpen]}
                isDesktop={studio.isDesktop}
                env={{ name: studio.activeEnv.name, color: studio.activeEnv.color }}
                onOpenEnv={openEnv}
                onRename={(name) => renameRequest(reqOpen, name)}
                onOpenCollectionAuth={
                  workspace.activeCollection
                    ? () => {
                        void openCollectionOverview().then(() => requestAnimationFrame(() => document.getElementById('collection-auth')?.scrollIntoView({ behavior: 'smooth', block: 'start' })))
                      }
                    : undefined
                }
              />
            </div>
          ) : tryOpen ? (
            <div className="ws-body ws-try">{tryView(tryOpen)}</div>
          ) : contractOpen ? (
            <div className="ws-body ws-contract">{contractView(contractOpen)}</div>
          ) : envActive ? (
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
              {!askConfirm && loginNeeded.length > 0 && (
                <div className="ws-strip info" role="status">
                  <span className="grow">
                    {t('flowAuth.loginNeeded', { apis: loginNeeded.map((l) => l.source).join(', ') })}
                    {loginError && <span className="err"> {loginError}</span>}
                  </span>
                  <button
                    className="small primary"
                    onClick={async () => {
                      setLoginError(undefined)
                      for (const l of loginNeeded) {
                        const error = await studio.requests.obtainFlowToken(activeId!, l.source)
                        if (error) return setLoginError(error)
                      }
                    }}
                  >
                    {t('flowAuth.login')}
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
                        { id: 'auth', label: t('flowAuth.tab'), ...(ownAuthCount ? { count: ownAuthCount } : {}) },
                        { id: 'yaml', label: 'YAML' },
                        ...(rs ? [{ id: 'step' as const, label: <span className="ws-step-tab">{rs.op && !simple && <MethodBadge method={rs.op.method} />} {simple ? humanizeId(rs.step.stepId) : rs.step.stepId}</span> }] : []),
                      ]}
                    />
                  </div>
                  <div className={`ws-center-body ${shownView === 'yaml' ? 'fill' : ''}`}>
                    {shownView === 'overview' && analysis && <OverviewView analysis={analysis} wa={wa} />}
                    {shownView === 'auth' && activeId && (
                      <FlowAuthView
                        journey={activeId}
                        wa={wa}
                        api={studio.requests}
                        isDesktop={studio.isDesktop}
                        envName={studio.activeEnv.name}
                        onOpenEnv={openEnv}
                        onOpenCollectionAuth={
                          workspace.activeCollection
                            ? () => void openCollectionOverview().then(() => requestAnimationFrame(() => document.getElementById('collection-auth')?.scrollIntoView({ behavior: 'smooth', block: 'start' })))
                            : undefined
                        }
                      />
                    )}
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
                      <StepView
                        wa={wa}
                        rs={rs}
                        servers={studio.servers}
                        onEditYaml={() => setViews((prev) => ({ ...prev, [activeId!]: 'yaml' }))}
                        onTry={rs.op ? () => openTry(rs.op!) : undefined}
                      />
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
                    prelude={activeId ? studio.preludeOf(activeId) : undefined}
                    onDisableCase={(id) => studio.caseActions.toggle(id, false)}
                  />
                </aside>
              </div>
            </>
          ) : (
            <div className="ws-body">
              {workspace.isOpen ? (
                workspace.collections.length ? (
                  <EmptyCollection workspace={workspace} onFiles={studio.addFiles} onCreateArazzo={createArazzoAndOpen} />
                ) : (
                  homeView
                )
              ) : (
                <Empty>{t('ws.noJourneys')}</Empty>
              )}
            </div>
          )}
        </main>
      </div>
      {statusBar}
      {tabContextMenu}
      {newRequest && canCreateRequest && (
        <NewRequestDialog
          startWithCurl={newRequest.curl}
          isDesktop={studio.isDesktop}
          onClose={() => setNewRequest(undefined)}
          onCreate={createRequest}
          onCurl={createRequestFromCurl}
          onCreateArazzo={() => {
            setNewRequest(undefined)
            createArazzoAndOpen()
          }}
        />
      )}
    </TemplateVarsProvider>
  )
}
