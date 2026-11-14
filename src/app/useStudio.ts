/* eslint-disable @typescript-eslint/no-explicit-any */
// Estado de la app y acciones del flujo (cargar, configurar, ejecutar, exportar).
import { useEffect, useRef, useState } from 'react'
import { attachSource, buildProject, fetchRemoteSource, parseFile, replaceArazzo, type LoadedFile, type ParsedFile, type Project } from '../core/loader'
import { analyzeProject, type ProjectAnalysis } from '../core/analyze'
import { getServerUrl } from '../core/openapi'
import { fetchExecutor } from '../core/http'
import { createSimulatedExecutor, createSimulatedMessenger } from '../core/simulator'
import { runWorkflow } from '../core/runner'
import {
  applyCaseInputs,
  defaultInputs,
  evaluateCase,
  generateTestCases,
  isSimulated,
  runnability,
  type CaseRun,
  type RunMode,
  type TestCase,
} from '../core/testcases'
import { exportScenarios, importScenarios } from '../core/scenariosFile'
import { buildHtmlReport, buildJsonReport, reportFileName } from '../core/report'
import { fillServers, newEnvironment, redactSecrets, secretValues, uniqueName, variableValues, type Environment, type EnvVariable } from '../core/environments'
import { resolveTemplates } from '../core/templates'
import { loadFaker } from '../core/dynamicVars'
import { readSavedSession, toSavedSession, type SavedSession } from '../core/session'
import { download, readTextFiles, saveTextFile, type SaveResult } from '../lib/browser'
import { createDesktopExecutor, desktop } from '../lib/desktop'
import { storeDelete, storeGet, storeSet } from '../lib/storage'
import { setLocale, t, type Locale } from '../i18n'
import { useLocale } from '../i18n/react'
import { EXAMPLES, type ExampleId } from './example'

type Inputs = Record<string, Record<string, any>>

const SESSION_KEY = 'session'

// En la app de escritorio las peticiones salen del proceso principal (sin CORS).
const realExecutor = desktop ? createDesktopExecutor(desktop) : fetchExecutor

export function useStudio() {
  const [files, setFiles] = useState<ParsedFile[]>([])
  // Texto original de lo cargado, para poder guardar la sesión y reconstruirla.
  const [texts, setTexts] = useState<LoadedFile[]>([])
  // Texto de cada archivo tal como se cargó, para que el editor pueda descartar los cambios.
  const [originals, setOriginals] = useState<Record<string, string>>({})
  const [attachments, setAttachments] = useState<SavedSession['attachments']>([])
  const [remotes, setRemotes] = useState<string[]>([])
  // Escritorio: carpeta abierta y ruta en disco de cada archivo cargado desde ella.
  const [folder, setFolder] = useState<{ root: string; paths: Record<string, string> }>()
  // Sesión anterior encontrada al abrir, a la espera de que el usuario decida si la continúa.
  const [savedSession, setSavedSession] = useState<SavedSession>()
  const [project, setProject] = useState<Project>()
  const [analysis, setAnalysis] = useState<ProjectAnalysis>()
  const [errors, setErrors] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [inputs, setInputs] = useState<Inputs>({})
  const [envs, setEnvs] = useState(() => {
    const first = newEnvironment(t('env.defaultName'))
    return { list: [first], active: first.id }
  })
  const [cases, setCases] = useState<TestCase[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [mode, setMode] = useState<RunMode>('real')
  const [runs, setRuns] = useState<CaseRun[]>([])
  // Ambiente con el que se corrió la última ejecución (el reporte lo usa aunque después se cambie).
  const [runEnv, setRunEnv] = useState<{ name: string; servers: Record<string, string> }>()
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const locale = useLocale()

  const activeEnv = envs.list.find((e) => e.id === envs.active) ?? envs.list[0]
  const { servers, credentials } = activeEnv

  function updateActiveEnv(patch: (e: Environment) => Partial<Environment>) {
    setEnvs((prev) => ({ ...prev, list: prev.list.map((e) => (e.id === prev.active ? { ...e, ...patch(e) } : e)) }))
  }

  const envActions = {
    select: (id: string) => {
      // La confirmación de modificar datos vale para un ambiente: al cambiar se vuelve a pedir.
      if (id !== envs.active) setConfirmed(false)
      setEnvs((prev) => ({ ...prev, active: id }))
    },
    add: (name: string) => {
      setConfirmed(false)
      setEnvs((prev) => {
        const current = prev.list.find((e) => e.id === prev.active) ?? prev.list[0]
        const env = newEnvironment(uniqueName(name, prev.list.map((e) => e.name)), current.servers, current.variables)
        return { list: [...prev.list, env], active: env.id }
      })
    },
    rename: (id: string, name: string) =>
      setEnvs((prev) => ({ ...prev, list: prev.list.map((e) => (e.id === id && name.trim() ? { ...e, name: name.trim() } : e)) })),
    /** Reemplaza las variables y secretos del ambiente activo. */
    setVariables: (variables: EnvVariable[]) => updateActiveEnv(() => ({ variables })),
    remove: (id: string) => {
      if (id === envs.active) setConfirmed(false)
      setEnvs((prev) => {
        if (prev.list.length <= 1) return prev
        const list = prev.list.filter((e) => e.id !== id)
        return { list, active: prev.active === id ? list[0].id : prev.active }
      })
    },
  }


  /** Cambia el proyecto y recalcula lo que depende de él: análisis, valores por defecto, servidores y casos. */
  function applyProject(p: Project | undefined) {
    setProject(p)
    const a = p ? analyzeProject(p) : undefined
    setAnalysis(a)
    if (!p || !a) return
    setSelected((s) => (a.workflows.some((w) => w.workflow.workflowId === s) ? s : (a.workflows[0]?.workflow.workflowId ?? '')))
    setInputs((prev) => {
      const next = { ...prev }
      for (const w of a.workflows) next[w.workflow.workflowId] ??= defaultInputs(w.inputsSchema)
      return next
    })
    const defaults = Object.fromEntries(p.sources.filter((s) => s.status === 'loaded').map((s) => [s.name, getServerUrl(s)]))
    setEnvs((prev) => ({ ...prev, list: fillServers(prev.list, defaults) }))
    setCases((prev) => {
      // Se conservan las elecciones del usuario: selección, datos propios, modo y casos creados a mano.
      const byId = new Map(prev.map((c) => [c.id, c]))
      const wfIds = new Set(a.workflows.map((w) => w.workflow.workflowId))
      const generated = a.workflows.flatMap(generateTestCases).map((c) => {
        const old = byId.get(c.id)
        return old ? { ...c, enabled: old.enabled, inputOverrides: old.inputOverrides, omitInputs: old.omitInputs, dataMode: old.dataMode } : c
      })
      const custom = prev.filter((c) => c.origin === 'datos' && wfIds.has(c.workflowId))
      return [...generated, ...custom]
    })
  }

  function loadFiles(loaded: LoadedFile[], replace: boolean) {
    setSavedSession(undefined) // empezar algo nuevo descarta la sesión anterior
    const parsed = loaded.map(parseFile)
    const all = replace ? parsed : [...files.filter((f) => !parsed.some((p) => p.name === f.name)), ...parsed]
    setFiles(all)
    setTexts((prev) => (replace ? loaded : [...prev.filter((f) => !loaded.some((l) => l.name === f.name)), ...loaded]))
    const loadedTexts = Object.fromEntries(loaded.map((f) => [f.name, f.text]))
    setOriginals((prev) => (replace ? loadedTexts : { ...prev, ...loadedTexts }))
    if (replace) {
      setAttachments([])
      setRemotes([])
      setFolder(undefined)
    }
    const { project: p, errors: e } = buildProject(all)
    applyProject(p)
    setErrors(e)
  }

  async function addFiles(fs: File[]) {
    loadFiles(await readTextFiles(fs), false)
  }

  function loadExample(id: ExampleId = 'cards') {
    loadFiles(EXAMPLES[id], true)
  }

  async function attachFile(sourceName: string, f: File) {
    if (!project) return
    const [loaded] = await readTextFiles([f])
    const parsed = parseFile(loaded)
    setFiles((prev) => [...prev.filter((x) => x.name !== parsed.name), parsed])
    setAttachments((prev) => [...prev.filter((a) => a.source !== sourceName), { source: sourceName, file: loaded }])
    applyProject(attachSource(project, sourceName, parsed))
  }

  /**
   * Cambios del editor: el texto se guarda siempre (también en la sesión) y, si es un Arazzo
   * válido, reemplaza al anterior y se vuelve a analizar. Si no se puede leer, el análisis
   * queda como estaba y el editor muestra el error.
   */
  function editArazzo(text: string): string | undefined {
    if (!project) return
    const name = project.arazzoFileName
    setTexts((prev) => (prev.some((f) => f.name === name) ? prev.map((f) => (f.name === name ? { ...f, text } : f)) : [...prev, { name, text }]))
    const parsed = parseFile({ name, text })
    if (parsed.error) return parsed.error
    if (parsed.kind !== 'arazzo') return t('load.noArazzo')
    setFiles((prev) => prev.map((f) => (f.name === name ? parsed : f)))
    applyProject(replaceArazzo(project, parsed))
  }

  /** Escritorio: carga todos los YAML/JSON de una carpeta, como una colección de Bruno. */
  async function openFolder() {
    const opened = await desktop?.openFolder()
    if (!opened) return
    loadFiles(opened.files.map((f) => ({ name: f.name, text: f.text })), true)
    setFolder({ root: opened.root, paths: Object.fromEntries(opened.files.map((f) => [f.name, f.path])) })
    if (opened.truncated) setErrors((prev) => [...prev, t('load.folderTruncated')])
  }

  /** Guarda el Arazzo editado: sobre su archivo en disco si se abrió desde una carpeta. */
  async function saveArazzo(text: string): Promise<SaveResult> {
    const name = project?.arazzoFileName ?? 'workflow.arazzo.yaml'
    const baseName = name.split(/[\\/]/).pop() ?? name
    if (!desktop) return saveTextFile(text, baseName)
    const path = folder?.paths[name]
    if (path) {
      await desktop.writeFile(path, text)
      return 'saved'
    }
    const saved = await desktop.saveAs(baseName, text)
    if (!saved) return 'cancelled'
    setFolder((prev) => ({ root: prev?.root ?? '', paths: { ...prev?.paths, [name]: saved } }))
    return 'saved'
  }

  async function fetchRemote(sourceName: string) {
    if (!project) return
    const next = await fetchRemoteSource(project, sourceName)
    if (next.sources.find((s) => s.name === sourceName)?.status === 'loaded') setRemotes((prev) => [...new Set([...prev, sourceName])])
    applyProject(next)
  }

  // Al abrir, busca una sesión anterior para ofrecer continuarla.
  useEffect(() => {
    storeGet(SESSION_KEY).then((value) => {
      const saved = readSavedSession(value)
      if (saved) setSavedSession(saved)
    })
  }, [])

  // Guarda la sesión poco después de cada cambio (sin credenciales ni valores sensibles).
  useEffect(() => {
    if (!project || savedSession) return
    const timer = setTimeout(() => {
      const session = toSavedSession({
        title: project.arazzo.info?.title,
        files: texts,
        attachments,
        remotes,
        inputs,
        cases,
        // Campos del antiguo asistente: se guardan vacíos para que la sesión siga siendo compatible.
        skipped: [],
        selected,
        mode,
        screen: 0,
        environments: envs.list,
        activeEnv: envs.active,
      })
      void storeSet(SESSION_KEY, session)
    }, 500)
    return () => clearTimeout(timer)
  }, [project, savedSession, texts, attachments, remotes, inputs, cases, selected, mode, envs])

  /** Continúa la sesión guardada: vuelve a armar el proyecto y recupera las elecciones del usuario. */
  async function restoreSession() {
    const saved = savedSession
    if (!saved) return
    setSavedSession(undefined)
    setInputs(saved.inputs)
    setCases(saved.cases)
    setSelected(saved.selected)
    setMode(saved.mode)
    if (saved.environments.length) {
      const list = saved.environments.map((e) => ({ ...e, credentials: {}, variables: e.variables ?? [] }))
      setEnvs({ list, active: list.some((e) => e.id === saved.activeEnv) ? saved.activeEnv : list[0].id })
    }
    const parsed = saved.files.map(parseFile)
    const attached = saved.attachments.map((a) => ({ source: a.source, parsed: parseFile(a.file) }))
    setTexts(saved.files)
    setOriginals(Object.fromEntries(saved.files.map((f) => [f.name, f.text])))
    setAttachments(saved.attachments)
    setFiles([...parsed, ...attached.map((a) => a.parsed)])
    const built = buildProject(parsed)
    let p = built.project
    if (p) for (const a of attached) p = attachSource(p, a.source, a.parsed)
    if (p) for (const r of saved.remotes) p = await fetchRemoteSource(p, r)
    setRemotes(saved.remotes)
    applyProject(p)
    setErrors(built.errors)
  }

  function discardSession() {
    setSavedSession(undefined)
    void storeDelete(SESSION_KEY)
  }

  function reset() {
    setFolder(undefined)
    setFiles([])
    setTexts([])
    setAttachments([])
    setRemotes([])
    void storeDelete(SESSION_KEY)
    applyProject(undefined)
    setErrors([])
    setInputs({})
    setCases([])
    setRuns([])
    setRunEnv(undefined)
    setConfirmed(false)
  }

  /**
   * Ejecuta los casos elegidos de un journey (o solo `onlyIds`); con `runMode` se fuerza un modo
   * (ej. reintentar en simulación). Los resultados de los demás journeys se conservan.
   */
  async function runJourney(workflowId: string, runMode: RunMode = mode, onlyIds?: string[]) {
    if (!project || !analysis || running) return
    if (runMode !== mode) setMode(runMode)
    const selectedCases = cases.filter(
      (c) => c.workflowId === workflowId && (onlyIds ? onlyIds.includes(c.id) : c.enabled) && runnability(c, runMode).ok,
    )
    if (!selectedCases.length) return
    setRuns((prev) => [...prev.filter((r) => r.tc.workflowId !== workflowId), ...selectedCases.map((tc) => ({ tc, state: 'pending' as const, steps: [] }))])
    // {{variables}} del ambiente en URLs y credenciales; los secretos se envían pero no se muestran.
    await loadFaker()
    const variables = variableValues(activeEnv)
    const runServers: Record<string, string> = resolveTemplates(servers, variables)
    const runCredentials: Record<string, string> = resolveTemplates(credentials, variables)
    const secrets = secretValues({ variables: activeEnv.variables, credentials: runCredentials })
    setRunEnv({ name: activeEnv.name, servers: runServers })
    setRunning(true)
    const controller = new AbortController()
    abort.current = controller

    for (const tc of selectedCases) {
      if (controller.signal.aborted) break
      const update = (patch: Partial<CaseRun>) => setRuns((rs) => rs.map((r) => (r.tc.id === tc.id ? { ...r, ...patch } : r)))
      update({ state: 'running' })
      const live: CaseRun['steps'] = []
      const wf = project.arazzo.workflows.find((w) => w.workflowId === tc.workflowId)
      const simulate = isSimulated(tc, runMode)
      const inputsUsed = applyCaseInputs(tc, inputs[tc.workflowId] ?? {}, variables)
      update({ inputsUsed: redactSecrets(inputsUsed, secrets), simulated: simulate })
      const result = await runWorkflow(project, analysis, tc.workflowId, {
        inputs: inputsUsed,
        credentials: runCredentials,
        servers: runServers,
        secrets,
        dropAuth: tc.dropAuth,
        executor: simulate ? createSimulatedExecutor(project, wf?.steps ?? [], tc.scenario) : realExecutor,
        messenger: simulate ? createSimulatedMessenger(wf?.steps ?? [], tc.scenario) : undefined,
        maxRetryWaitMs: simulate ? 0 : undefined,
        signal: controller.signal,
        onStep: (s) => {
          live.push(s)
          update({ steps: [...live] })
        },
      })
      const { verdict, explanation } = evaluateCase(tc, result)
      update({ state: 'done', steps: result.steps, result, verdict, explanation })
    }
    setRunning(false)
  }

  /** Cambia el idioma y regenera el análisis y los casos para que sus textos lo sigan. */
  function changeLocale(l: Locale) {
    setLocale(l)
    document.documentElement.lang = l
    if (project) applyProject(project)
  }

  function cancelRun() {
    abort.current?.abort()
  }

  function exportReport(format: 'html' | 'json') {
    const generatedAt = new Date()
    const title = project?.arazzo.info?.title ?? 'arazzo'
    const fileName = reportFileName(title, generatedAt, format)
    const params = {
      arazzoTitle: project?.arazzo.info?.title ?? project?.arazzoFileName ?? 'Arazzo',
      arazzoFile: project?.arazzoFileName,
      generatedAt,
      environment: runEnv?.name ?? activeEnv.name,
      servers: runEnv?.servers ?? servers,
      cases: runs,
    }
    if (format === 'html') download(buildHtmlReport(params), fileName, 'text/html')
    else download(buildJsonReport({ ...params, info: project?.arazzo.info }), fileName, 'application/json')
  }

  function exportScenariosFile() {
    download(exportScenarios({ title: project?.arazzo.info?.title, bases: inputs, cases }), 'escenarios.arazzo-studio.yaml', 'application/yaml')
  }

  async function importScenariosFile(file: File) {
    const workflowIds = analysis?.workflows.map((w) => w.workflow.workflowId) ?? []
    const result = importScenarios(await file.text(), cases, workflowIds)
    setCases(result.cases)
    if (Object.keys(result.bases).length) setInputs((prev) => ({ ...prev, ...result.bases }))
    return result
  }

  const caseActions = {
    toggle: (id: string, en: boolean) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, enabled: en } : c))),
    setMany: (ids: string[], en: boolean) => setCases((cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, enabled: en } : c))),
    updateCase: (id: string, patch: Partial<TestCase>) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    addCase: (tc: TestCase) => setCases((cs) => [...cs, tc]),
    removeCase: (id: string) => setCases((cs) => cs.filter((c) => c.id !== id)),
  }

  return {
    locale,
    changeLocale,
    files,
    project,
    analysis,
    errors,
    selected,
    setSelected,
    inputs,
    setInput: (wf: string, name: string, v: any) => setInputs((prev) => ({ ...prev, [wf]: { ...prev[wf], [name]: v } })),
    environments: envs.list,
    activeEnv,
    envActions,
    credentials,
    setCredential: (k: string, v: string) => updateActiveEnv((e) => ({ credentials: { ...e.credentials, [k]: v } })),
    servers,
    setServer: (n: string, v: string) => {
      setConfirmed(false)
      updateActiveEnv((e) => ({ servers: { ...e.servers, [n]: v } }))
    },
    cases,
    caseActions,
    mode,
    setMode,
    confirmed,
    setConfirmed,
    runs,
    running,
    savedSession,
    restoreSession,
    discardSession,
    addFiles,
    attachFile,
    arazzoText: project ? texts.find((f) => f.name === project.arazzoFileName)?.text : undefined,
    arazzoOriginal: project ? originals[project.arazzoFileName] : undefined,
    editArazzo,
    saveArazzo,
    isDesktop: !!desktop,
    folder: folder?.root,
    openFolder,
    fetchRemote,
    loadExample,
    reset,
    runJourney,
    cancelRun,
    exportReport,
    exportScenariosFile,
    importScenariosFile,
  }
}

export type Studio = ReturnType<typeof useStudio>
