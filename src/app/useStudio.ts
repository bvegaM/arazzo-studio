/* eslint-disable @typescript-eslint/no-explicit-any */
// Estado de la app y acciones del flujo (cargar, configurar, ejecutar, exportar).
import { useRef, useState } from 'react'
import { attachSource, buildProject, fetchRemoteSource, parseFile, type LoadedFile, type ParsedFile, type Project } from '../core/loader'
import { analyzeProject, type ProjectAnalysis } from '../core/analyze'
import { getServerUrl } from '../core/openapi'
import { fetchExecutor } from '../core/http'
import { createSimulatedExecutor } from '../core/simulator'
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
import { download, readTextFiles } from '../lib/browser'
import { setLocale, type Locale } from '../i18n'
import { useLocale } from '../i18n/react'
import { EXAMPLE_FILES } from './example'

export const Screen = { Load: 0, Contracts: 1, Params: 2, Cases: 3, Results: 4 } as const
export type Screen = (typeof Screen)[keyof typeof Screen]

type Inputs = Record<string, Record<string, any>>

export function useStudio() {
  const [screen, setScreenState] = useState<Screen>(Screen.Load)
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [project, setProject] = useState<Project>()
  const [analysis, setAnalysis] = useState<ProjectAnalysis>()
  const [errors, setErrors] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [inputs, setInputs] = useState<Inputs>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [servers, setServers] = useState<Record<string, string>>({})
  const [cases, setCases] = useState<TestCase[]>([])
  // Workflows que el usuario sacó de las pruebas en el paso 2 (por defecto se prueban todos).
  const [skipped, setSkipped] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [mode, setMode] = useState<RunMode>('real')
  const [runs, setRuns] = useState<CaseRun[]>([])
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const locale = useLocale()

  // Lo que ven los pasos 3 a 5: solo los workflows marcados para probar.
  const testAnalysis = analysis && skipped.length ? { ...analysis, workflows: analysis.workflows.filter((w) => !skipped.includes(w.workflow.workflowId)) } : analysis
  const testCases = skipped.length ? cases.filter((c) => !skipped.includes(c.workflowId)) : cases

  function goTo(s: Screen) {
    setScreenState(s)
    window.scrollTo(0, 0)
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
    setServers((prev) => {
      const next = { ...prev }
      for (const s of p.sources) if (s.status === 'loaded' && next[s.name] === undefined) next[s.name] = getServerUrl(s)
      return next
    })
    setCases((prev) => {
      // Se conservan las elecciones del usuario: selección, datos propios, modo y casos creados a mano.
      const byId = new Map(prev.map((c) => [c.id, c]))
      const wfIds = new Set(a.workflows.map((w) => w.workflow.workflowId))
      const generated = a.workflows.flatMap(generateTestCases).map((c) => {
        const old = byId.get(c.id)
        return old ? { ...c, enabled: old.enabled, inputOverrides: old.inputOverrides, dataMode: old.dataMode } : c
      })
      const custom = prev.filter((c) => c.origin === 'datos' && wfIds.has(c.workflowId))
      return [...generated, ...custom]
    })
  }

  function loadFiles(loaded: LoadedFile[], replace: boolean) {
    const parsed = loaded.map(parseFile)
    const all = replace ? parsed : [...files.filter((f) => !parsed.some((p) => p.name === f.name)), ...parsed]
    setFiles(all)
    const { project: p, errors: e } = buildProject(all)
    applyProject(p)
    setErrors(e)
  }

  async function addFiles(fs: File[]) {
    loadFiles(await readTextFiles(fs), false)
  }

  function loadExample() {
    loadFiles(EXAMPLE_FILES, true)
  }

  async function attachFile(sourceName: string, f: File) {
    if (!project) return
    const [parsed] = (await readTextFiles([f])).map(parseFile)
    setFiles((prev) => [...prev.filter((x) => x.name !== parsed.name), parsed])
    applyProject(attachSource(project, sourceName, parsed))
  }

  async function fetchRemote(sourceName: string) {
    if (project) applyProject(await fetchRemoteSource(project, sourceName))
  }

  function reset() {
    setFiles([])
    applyProject(undefined)
    setErrors([])
    setInputs({})
    setServers({})
    setCases([])
    setSkipped([])
    setRuns([])
    setConfirmed(false)
    goTo(Screen.Load)
  }

  async function runAll() {
    if (!project || !analysis) return
    const selectedCases = testCases.filter((c) => c.enabled && runnability(c, mode).ok)
    setRuns(selectedCases.map((tc) => ({ tc, state: 'pending', steps: [] })))
    goTo(Screen.Results)
    setRunning(true)
    const controller = new AbortController()
    abort.current = controller

    for (let i = 0; i < selectedCases.length; i++) {
      if (controller.signal.aborted) break
      const tc = selectedCases[i]
      const update = (patch: Partial<CaseRun>) => setRuns((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)))
      update({ state: 'running' })
      const live: CaseRun['steps'] = []
      const wf = project.arazzo.workflows.find((w) => w.workflowId === tc.workflowId)
      const simulate = isSimulated(tc, mode)
      const inputsUsed = applyCaseInputs(tc, inputs[tc.workflowId] ?? {})
      update({ inputsUsed, simulated: simulate })
      const result = await runWorkflow(project, analysis, tc.workflowId, {
        inputs: inputsUsed,
        credentials,
        servers,
        dropAuth: tc.dropAuth,
        executor: simulate ? createSimulatedExecutor(project, wf?.steps ?? [], tc.scenario) : fetchExecutor,
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

  function toggleWorkflow(id: string, include: boolean) {
    setSkipped((prev) => (include ? prev.filter((x) => x !== id) : [...new Set([...prev, id])]))
  }

  function setAllWorkflows(include: boolean) {
    setSkipped(include ? [] : (analysis?.workflows.map((w) => w.workflow.workflowId) ?? []))
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
      servers,
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
    screen,
    goTo,
    locale,
    changeLocale,
    files,
    project,
    analysis,
    testAnalysis,
    skipped,
    toggleWorkflow,
    setAllWorkflows,
    errors,
    selected,
    setSelected,
    inputs,
    setInput: (wf: string, name: string, v: any) => setInputs((prev) => ({ ...prev, [wf]: { ...prev[wf], [name]: v } })),
    credentials,
    setCredential: (k: string, v: string) => setCredentials((prev) => ({ ...prev, [k]: v })),
    servers,
    setServer: (n: string, v: string) => setServers((prev) => ({ ...prev, [n]: v })),
    cases,
    testCases,
    caseActions,
    mode,
    setMode,
    confirmed,
    setConfirmed,
    runs,
    running,
    addFiles,
    attachFile,
    fetchRemote,
    loadExample,
    reset,
    runAll,
    cancelRun,
    exportReport,
    exportScenariosFile,
    importScenariosFile,
  }
}

export type Studio = ReturnType<typeof useStudio>
