/* eslint-disable @typescript-eslint/no-explicit-any */
// Estado de la app y acciones del flujo (cargar, configurar, ejecutar, exportar).
import { useEffect, useRef, useState } from 'react'
import { attachToCollection, buildCollection, fetchRemoteInCollection, parseFile, replaceArazzo, replaceFileInCollection, type LoadedFile, type ParsedFile, type Project } from '../core/loader'
import YAML from 'yaml'
import { caseJourney, collectionCases, collectionCredentials, journeyKey, listJourneys, migrateLegacySession, scopeCase, splitJourneyKey, unscopeCase } from '../core/collection'
import { analyzeProject, type ProjectAnalysis } from '../core/analyze'
import { getServerUrl } from '../core/openapi'
import { fetchExecutor } from '../core/http'
import { createSimulatedExecutor, createSimulatedMessenger } from '../core/simulator'
import { runDependencies, runWorkflow, workflowDependencies, type DependencyRun, type StepResult } from '../core/runner'
import { buildTryProject, TRY_WORKFLOW, type TryForm } from '../core/tryOperation'
import type { OperationRef } from '../core/openapi'
import {
  applyCaseInputs,
  defaultInputs,
  evaluateCase,
  isSimulated,
  runnability,
  type CaseRun,
  type RunMode,
  type TestCase,
} from '../core/testcases'
import { exportScenarios, importScenarios } from '../core/scenariosFile'
import { buildHtmlReport, buildJsonReport, reportFileName } from '../core/report'
import { fillServers, newEnvironment, redactSecrets, secretValues, uniqueName, variableValues, type EnvColor, type Environment, type EnvVariable } from '../core/environments'
import { resolveTemplates } from '../core/templates'
import { loadFaker } from '../core/dynamicVars'
import { readSavedSession, toSavedSession, type SavedSession } from '../core/session'
import { download, readTextFiles, saveTextFile, type SaveResult } from '../lib/browser'
import { createDesktopExecutor, desktop } from '../lib/desktop'
import { storeDelete, storeGet, storeSet } from '../lib/storage'
import { setLocale, t, type Locale } from '../i18n'
import { useLocale } from '../i18n/react'
import { EXAMPLES, type ExampleId } from './example'
import { log } from '../lib/devlog'
import { humanizeId } from '../core/format'
import { logCaseEnd, logCaseStart, logStep } from './runLog'
import { useRequests } from './useRequests'
import type { RequestAuth } from '../core/requests'
import type { FlowAuth } from '../core/flowAuth'

type Inputs = Record<string, Record<string, any>>

const SESSION_KEY = 'session'

// En la app de escritorio las peticiones salen del proceso principal (sin CORS).
const realExecutor = desktop ? createDesktopExecutor(desktop) : fetchExecutor

/** Los workflows de dependsOn de un journey, ejecutados antes de sus casos. */
export interface Prelude {
  state: 'running' | 'done'
  runs: DependencyRun[]
  order?: string[]
  error?: string
}

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
  // Colección: un proyecto (y su análisis) por cada archivo Arazzo cargado.
  const [projects, setProjects] = useState<Project[]>([])
  const [analyses, setAnalyses] = useState<Record<string, ProjectAnalysis>>({})
  const [errors, setErrors] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [inputs, setInputs] = useState<Inputs>({})
  const [envs, setEnvs] = useState(() => {
    const first = newEnvironment(t('env.defaultName'))
    return { list: [first], active: first.id }
  })
  const [cases, setCases] = useState<TestCase[]>([])
  // Con un workspace abierto, lo guardado en disco manda: la sesión del navegador no se usa.
  const [sessionPaused, setSessionPaused] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [mode, setMode] = useState<RunMode>('real')
  const [runs, setRuns] = useState<CaseRun[]>([])
  // Workflows de dependsOn ejecutados antes de cada journey (por clave del journey).
  const [preludes, setPreludes] = useState<Record<string, Prelude>>({})
  // Ambiente con el que se corrió la última ejecución (el reporte lo usa aunque después se cambie).
  const [runEnv, setRunEnv] = useState<{ name: string; servers: Record<string, string> }>()
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const locale = useLocale()

  const activeEnv = envs.list.find((e) => e.id === envs.active) ?? envs.list[0]
  const journeys = listJourneys(projects, analyses)
  const activeJourney = journeys.find((j) => j.key === selected) ?? journeys[0]
  // Un solo Arazzo: su título. Varios: el nombre de la carpeta o cuántos archivos son.
  const collectionTitle =
    projects.length === 1
      ? (projects[0].arazzo.info?.title ?? projects[0].arazzoFileName)
      : (folder?.root.split(/[\\/]/).pop() ?? t('ws.tree.collectionN', { n: projects.length }))
  const { servers, credentials } = activeEnv
  // Requests sueltos de la colección: usan las variables del ambiente activo y ocultan sus secretos.
  const requests = useRequests({
    executor: realExecutor,
    env: () => {
      const variables = variableValues(activeEnv)
      return { variables, secrets: secretValues({ variables: activeEnv.variables, credentials: resolveTemplates(credentials, variables) }) }
    },
  })

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
    /** Color de la etiqueta del ambiente activo (undefined = sin color). */
    setColor: (color: EnvColor | undefined) => updateActiveEnv(() => ({ color })),
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


  /** Cambia la colección y recalcula lo que depende de ella: análisis, valores por defecto, servidores y casos. */
  function applyCollection(next: Project[]) {
    setProjects(next)
    const nextAnalyses = Object.fromEntries(next.map((p) => [p.arazzoFileName, analyzeProject(p)]))
    setAnalyses(nextAnalyses)
    if (!next.length) return
    const all = listJourneys(next, nextAnalyses)
    setSelected((s) => (all.some((j) => j.key === s) ? s : (all[0]?.key ?? '')))
    setInputs((prev) => {
      const values = { ...prev }
      for (const j of all) values[j.key] ??= defaultInputs(j.wa.inputsSchema)
      return values
    })
    const defaults = Object.fromEntries(next.flatMap((p) => p.sources.filter((s) => s.status === 'loaded').map((s) => [s.name, getServerUrl(s)])))
    setEnvs((prev) => ({ ...prev, list: fillServers(prev.list, defaults) }))
    setCases((prev) => collectionCases(all, prev))
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
    const built = buildCollection(all)
    applyCollection(built.projects)
    setErrors(built.errors)
    log('info', t('devlog.filesLoaded', { n: loaded.length }))
    for (const e of built.errors) log('warn', e)
  }

  async function addFiles(fs: File[]) {
    loadFiles(await readTextFiles(fs), false)
  }

  /**
   * Crea un Arazzo nuevo a partir de un esqueleto (una fuente y un paso) y lo agrega a la colección.
   * Devuelve la clave de su journey, para abrirlo en el editor.
   */
  function createArazzo(): string {
    const taken = new Set(texts.map((f) => f.name))
    let name = 'nuevo.arazzo.yaml'
    for (let i = 2; taken.has(name); i++) name = `nuevo-${i}.arazzo.yaml`
    // Si la colección ya tiene un contrato OpenAPI, el esqueleto lo usa (con su primera operación),
    // así el Arazzo nuevo nace sin errores.
    const contract = files.find((f) => f.kind === 'openapi' && f.doc?.paths)
    const firstOp = contract
      ? Object.values<any>(contract.doc.paths)
          .flatMap((item) => Object.values<any>(item ?? {}))
          .find((op) => op && typeof op === 'object' && typeof op.operationId === 'string')?.operationId
      : undefined
    const sourceUrl = contract ? `./${contract.name}` : './openapi.yaml'
    const text = [
      'arazzo: 1.1.0',
      'info:',
      `  title: ${t('newArazzo.title')}`,
      '  version: 1.0.0',
      'sourceDescriptions:',
      '  - name: miApi',
      `    url: ${sourceUrl}`,
      '    type: openapi',
      'workflows:',
      '  - workflowId: miJourney',
      `    summary: ${t('newArazzo.summary')}`,
      '    inputs:',
      '      type: object',
      '      properties: {}',
      '    steps:',
      '      - stepId: primerPaso',
      `        description: ${t('newArazzo.step')}`,
      `        operationId: $sourceDescriptions.miApi.${firstOp ?? 'operacion'}`,
      '        successCriteria:',
      '          - condition: $statusCode == 200',
      '',
    ].join('\n')
    loadFiles([{ name, text }], false)
    return journeyKey(name, 'miJourney')
  }

  /** Crea un contrato nuevo (OpenAPI o AsyncAPI) con un esqueleto válido; devuelve su nombre. */
  function createContract(kind: 'openapi' | 'asyncapi'): string {
    const taken = new Set([...texts.map((f) => f.name), ...files.map((f) => f.name)])
    const base = kind === 'openapi' ? 'nuevo-contrato.openapi' : 'nuevos-eventos.asyncapi'
    let name = `${base}.yaml`
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}.yaml`
    const text =
      kind === 'openapi'
        ? [
            'openapi: 3.0.3',
            'info:',
            `  title: ${t('newContract.title')}`,
            '  version: 1.0.0',
            'servers:',
            '  - url: https://api.example.com',
            'paths:',
            '  /health:',
            '    get:',
            '      operationId: getHealth',
            `      summary: ${t('newContract.health')}`,
            '      responses:',
            "        '200':",
            `          description: ${t('newContract.ok')}`,
            '          content:',
            '            application/json:',
            '              example: { status: UP }',
            '',
          ].join('\n')
        : [
            'asyncapi: 3.0.0',
            'info:',
            `  title: ${t('newContract.eventsTitle')}`,
            '  version: 1.0.0',
            'channels:',
            '  events:',
            '    address: mi.evento',
            '    messages:',
            '      evento:',
            '        payload:',
            '          type: object',
            '          properties:',
            '            id: { type: string }',
            'operations:',
            '  publishEvent:',
            '    action: send',
            "    channel: { $ref: '#/channels/events' }",
            '',
          ].join('\n')
    loadFiles([{ name, text }], false)
    return name
  }

  function loadExample(id: ExampleId = 'pokemon') {
    loadFiles(EXAMPLES[id], true)
  }

  async function attachFile(sourceName: string, f: File) {
    if (!projects.length) return
    const [loaded] = await readTextFiles([f])
    const parsed = parseFile(loaded)
    setFiles((prev) => [...prev.filter((x) => x.name !== parsed.name), parsed])
    setAttachments((prev) => [...prev.filter((a) => a.source !== sourceName), { source: sourceName, file: loaded }])
    applyCollection(attachToCollection(projects, sourceName, parsed))
  }

  /**
   * Cambios del editor: el texto se guarda siempre (también en la sesión) y, si es un Arazzo
   * válido, reemplaza al anterior y se vuelve a analizar. Si no se puede leer, el análisis
   * queda como estaba y el editor muestra el error.
   */
  function editArazzo(name: string, text: string): string | undefined {
    const project = projects.find((p) => p.arazzoFileName === name)
    if (!project) return
    setTexts((prev) => (prev.some((f) => f.name === name) ? prev.map((f) => (f.name === name ? { ...f, text } : f)) : [...prev, { name, text }]))
    const parsed = parseFile({ name, text })
    if (parsed.error) return parsed.error
    if (parsed.kind !== 'arazzo') return t('load.noArazzo')
    setFiles((prev) => prev.map((f) => (f.name === name ? parsed : f)))
    applyCollection(projects.map((p) => (p === project ? replaceArazzo(project, parsed) : p)))
  }

  /**
   * Texto de un contrato para el editor. Solo los archivos de la colección se editan; los que vinieron
   * de una URL o se adjuntaron se muestran en solo lectura (con "hacer copia local").
   */
  function contractText(file: string): { text: string; editable: boolean } | undefined {
    const own = texts.find((f) => f.name === file)
    if (own) return { text: own.text, editable: true }
    const attached = attachments.find((a) => a.file.name === file)
    if (attached) return { text: attached.file.text, editable: false }
    const parsed = projects.flatMap((p) => p.files).find((f) => f.name === file)
    return parsed?.doc ? { text: YAML.stringify(parsed.doc, { lineWidth: 0 }), editable: false } : undefined
  }

  /**
   * Cambios en un contrato (o en un archivo que referencia con $ref): se guarda el texto y, si se puede
   * leer, se vuelven a armar las fuentes que lo usan y se re-analizan los journeys. Si el YAML no se
   * puede leer, el análisis queda como estaba y se devuelve el error.
   */
  function editContract(name: string, text: string): string | undefined {
    setTexts((prev) => prev.map((f) => (f.name === name ? { ...f, text } : f)))
    const parsed = parseFile({ name, text })
    setFiles((prev) => prev.map((f) => (f.name === name ? parsed : f)))
    if (parsed.error) return parsed.error
    applyCollection(replaceFileInCollection(projects, parsed))
  }

  /** Convierte un contrato remoto o adjuntado en un archivo de la colección, para poder editarlo. */
  function makeLocalCopy(file: string) {
    const current = contractText(file)
    if (!current || current.editable) return
    const parsed = parseFile({ name: file, text: current.text })
    setTexts((prev) => [...prev, { name: file, text: current.text }])
    setOriginals((prev) => ({ ...prev, [file]: current.text }))
    setFiles((prev) => [...prev.filter((f) => f.name !== file), parsed])
    applyCollection(replaceFileInCollection(projects, parsed))
  }

  /**
   * Abre una colección de un workspace: sus archivos, ambientes (con secretos) y escenarios.
   * Reemplaza todo lo abierto; los escenarios dan los inputs base y los casos propios.
   */
  function openCollectionData(data: {
    files: LoadedFile[]
    environments: Environment[]
    scenarios: Record<string, string>
    activeEnv?: string
    /** Archivo cuyo primer journey queda seleccionado. */
    selectFile?: string
    requests?: Record<string, string>
    protos?: Record<string, string>
    requestSecrets?: Record<string, Record<string, string>>
    collectionAuth?: RequestAuth
    flowAuth?: FlowAuth
  }) {
    requests.load(data.requests, data.protos, { secrets: data.requestSecrets, collectionAuth: data.collectionAuth, flowAuth: data.flowAuth })
    setSavedSession(undefined)
    const parsed = data.files.map(parseFile)
    setFiles(parsed)
    setTexts(data.files)
    setOriginals(Object.fromEntries(data.files.map((f) => [f.name, f.text])))
    setAttachments([])
    setRemotes([])
    setFolder(undefined)
    setRuns([])
    setRunEnv(undefined)
    setConfirmed(false)
    const built = buildCollection(parsed)
    const nextAnalyses = Object.fromEntries(built.projects.map((p) => [p.arazzoFileName, analyzeProject(p)]))
    const all = listJourneys(built.projects, nextAnalyses)
    let nextCases = collectionCases(all, [])
    const nextInputs: Record<string, Record<string, any>> = {}
    for (const j of all) nextInputs[j.key] = defaultInputs(j.wa.inputsSchema)
    for (const [file, text] of Object.entries(data.scenarios)) {
      const workflowIds = all.filter((j) => j.file === file).map((j) => j.workflowId)
      if (!workflowIds.length) continue
      const own = nextCases.filter((c) => c.arazzo === file).map(unscopeCase)
      const result = importScenarios(text, own, workflowIds)
      nextCases = [...nextCases.filter((c) => c.arazzo !== file), ...result.cases.map((c) => scopeCase(file, c))]
      for (const [wf, values] of Object.entries(result.bases)) nextInputs[journeyKey(file, wf)] = { ...nextInputs[journeyKey(file, wf)], ...values }
    }
    setCases(nextCases)
    setInputs(nextInputs)
    setSelected((all.find((j) => j.file === data.selectFile) ?? all[0])?.key ?? '')
    const list = data.environments.length ? data.environments : [newEnvironment(t('env.defaultName'))]
    const active = list.find((e) => e.name === data.activeEnv) ?? list[0]
    setEnvs({ list, active: active.id })
    applyCollection(built.projects)
    // Una colección recién creada no tiene Arazzo todavía: no es un error.
    setErrors(data.files.length ? built.errors : [])
  }

  /** Archivo de escenarios de cada Arazzo (inputs base y casos propios), para guardarlos en el workspace. */
  function scenarioFiles(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const project of projects) {
      const file = project.arazzoFileName
      const bases = Object.fromEntries(
        Object.entries(inputs)
          .filter(([k]) => splitJourneyKey(k).file === file)
          .map(([k, v]) => [splitJourneyKey(k).workflowId, v]),
      )
      out[file] = exportScenarios({ title: project.arazzo.info?.title, bases, cases: cases.filter((c) => c.arazzo === file).map(unscopeCase) })
    }
    return out
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
  async function saveArazzo(name: string, text: string): Promise<SaveResult> {
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
    if (!projects.length) return
    const next = await fetchRemoteInCollection(projects, sourceName)
    if (next.some((p) => p.sources.find((s) => s.name === sourceName)?.status === 'loaded')) setRemotes((prev) => [...new Set([...prev, sourceName])])
    applyCollection(next)
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
    if (!projects.length || savedSession || sessionPaused) return
    const timer = setTimeout(() => {
      const session = toSavedSession({
        title: collectionTitle,
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
  }, [projects, collectionTitle, savedSession, sessionPaused, texts, attachments, remotes, inputs, cases, selected, mode, envs])

  /** Continúa la sesión guardada: vuelve a armar el proyecto y recupera las elecciones del usuario. */
  async function restoreSession() {
    const saved = savedSession
    if (!saved) return
    setSavedSession(undefined)
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
    const built = buildCollection(parsed)
    let next = built.projects
    for (const a of attached) next = attachToCollection(next, a.source, a.parsed)
    for (const r of saved.remotes) next = await fetchRemoteInCollection(next, r)
    // Sesiones de antes de las colecciones: lo guardado sin archivo pasa al primer Arazzo.
    const migrated = next.length ? migrateLegacySession(next[0].arazzoFileName, saved) : saved
    setInputs(migrated.inputs)
    setCases(migrated.cases)
    setSelected(migrated.selected)
    setRemotes(saved.remotes)
    applyCollection(next)
    setErrors(built.errors)
  }

  function discardSession() {
    setSavedSession(undefined)
    void storeDelete(SESSION_KEY)
  }

  function reset() {
    requests.load()
    setFolder(undefined)
    setFiles([])
    setTexts([])
    setAttachments([])
    setRemotes([])
    void storeDelete(SESSION_KEY)
    applyCollection([])
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
  async function runJourney(key: string, runMode: RunMode = mode, onlyIds?: string[]) {
    const journey = journeys.find((j) => j.key === key)
    if (!journey || running) return
    const { project, analysis } = journey
    if (runMode !== mode) setMode(runMode)
    const selectedCases = cases.filter(
      (c) => caseJourney(c) === key && (onlyIds ? onlyIds.includes(c.id) : c.enabled) && runnability(c, runMode).ok,
    )
    if (!selectedCases.length) return
    setRuns((prev) => [...prev.filter((r) => caseJourney(r.tc) !== key), ...selectedCases.map((tc) => ({ tc, state: 'pending' as const, steps: [] }))])
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
    const journeyName = humanizeId(journey.workflowId)
    log('info', t('devlog.runStart', { journey: journeyName, n: selectedCases.length, env: activeEnv.name }), { source: 'run' })

    // Autorización propia por API y por journey: la aplica este executor en cada paso real.
    const flowExec = requests.flowExecutor(realExecutor, journey.file, variables)
    const ownAuth = requests.ownFlowAuth(journey.file)

    // dependsOn: los workflows de los que depende corren una vez, antes de los casos.
    const deps = workflowDependencies(project, journey.workflowId)
    let depOutputs: Record<string, Record<string, any>> = {}
    let depError = deps.error
    if (deps.error) setPreludes((p) => ({ ...p, [key]: { state: 'done', runs: [], error: deps.error } }))
    else if (deps.order.length) {
      setPreludes((p) => ({ ...p, [key]: { state: 'running', runs: [], order: deps.order } }))
      log('info', t('devlog.prelude', { workflows: deps.order.join(' → ') }), { source: 'run' })
      const simulateDeps = runMode === 'simulado'
      const prepared = await runDependencies(project, analysis, journey.workflowId, {
        credentials: runCredentials,
        servers: runServers,
        secrets,
        signal: controller.signal,
        canSendCookies: !!desktop,
        executor: flowExec,
        ownAuth: simulateDeps ? undefined : ownAuth,
        executorFor: simulateDeps ? (id) => createSimulatedExecutor(project, project.arazzo.workflows.find((w) => w.workflowId === id)?.steps ?? []) : undefined,
        maxRetryWaitMs: simulateDeps ? 0 : undefined,
        inputsFor: (id) => resolveTemplates(inputs[journeyKey(journey.file, id)] ?? {}, variables),
      })
      for (const dep of prepared.runs)
        for (const s of dep.result.steps) logStep(s, { journey: humanizeId(dep.workflowId), caseName: t('devlog.preludeCase'), simulated: simulateDeps })
      depOutputs = prepared.outputs
      depError = prepared.error
      setPreludes((p) => ({ ...p, [key]: { state: 'done', runs: prepared.runs, error: prepared.error, order: deps.order } }))
    } else setPreludes((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)))

    for (const tc of selectedCases) {
      if (controller.signal.aborted) break
      const update = (patch: Partial<CaseRun>) => setRuns((rs) => rs.map((r) => (r.tc.id === tc.id ? { ...r, ...patch } : r)))
      // Sin sus dependencias el journey no se puede probar: el caso queda no concluyente.
      if (depError) {
        update({ state: 'done', steps: [], verdict: 'inconclusive', explanation: depError })
        continue
      }
      update({ state: 'running' })
      const live: CaseRun['steps'] = []
      const wf = project.arazzo.workflows.find((w) => w.workflowId === tc.workflowId)
      const simulate = isSimulated(tc, runMode)
      const inputsUsed = applyCaseInputs(tc, inputs[key] ?? {}, variables)
      update({ inputsUsed: redactSecrets(inputsUsed, secrets), simulated: simulate })
      const logCtx = { journey: journeyName, caseName: tc.title, simulated: simulate }
      logCaseStart(logCtx)
      const result = await runWorkflow(project, analysis, tc.workflowId, {
        inputs: inputsUsed,
        credentials: runCredentials,
        servers: runServers,
        secrets,
        dropAuth: tc.dropAuth,
        executor: simulate ? createSimulatedExecutor(project, wf?.steps ?? [], tc.scenario) : flowExec,
        ownAuth: simulate ? undefined : ownAuth,
        messenger: simulate ? createSimulatedMessenger(wf?.steps ?? [], tc.scenario) : undefined,
        maxRetryWaitMs: simulate ? 0 : undefined,
        signal: controller.signal,
        canSendCookies: !!desktop,
        workflowOutputs: depOutputs,
        onStep: (s) => {
          logStep(s, logCtx)
          live.push(s)
          update({ steps: [...live] })
        },
      })
      const { verdict, explanation } = evaluateCase(tc, result)
      update({ state: 'done', steps: result.steps, result, verdict, explanation })
      logCaseEnd(logCtx, verdict, explanation, result)
    }
    if (controller.signal.aborted) log('warn', t('devlog.cancelled'), { source: 'run' })
    setRunning(false)
  }

  /**
   * Prueba una operación del contrato por sí sola, con el ambiente activo (URLs, variables y
   * credenciales). Los secretos no se muestran; la petición queda también en Network.
   */
  async function tryOperation(op: OperationRef, form: TryForm, simulate: boolean, signal?: AbortSignal): Promise<{ step?: StepResult; error?: string }> {
    const source = projects.flatMap((p) => p.sources).find((s) => s.name === op.sourceName && s.status === 'loaded')
    if (!source) return { error: t('try.noSource', { source: op.sourceName }) }
    await loadFaker()
    const variables = variableValues(activeEnv)
    const runServers: Record<string, string> = resolveTemplates(servers, variables)
    const runCredentials: Record<string, string> = resolveTemplates(credentials, variables)
    const secrets = secretValues({ variables: activeEnv.variables, credentials: runCredentials })
    const built = buildTryProject(source, op, form, (text) => resolveTemplates(text, variables))
    if (built.error || !built.project || !built.analysis) return { error: built.error }
    const steps = built.project.arazzo.workflows[0].steps
    const result = await runWorkflow(built.project, built.analysis, TRY_WORKFLOW, {
      inputs: {},
      credentials: runCredentials,
      servers: runServers,
      secrets,
      executor: simulate ? createSimulatedExecutor(built.project, steps) : realExecutor,
      maxRetryWaitMs: simulate ? 0 : undefined,
      signal,
      canSendCookies: !!desktop,
    })
    const step = result.steps[0]
    if (step) logStep(step, { journey: t('try.title'), caseName: `${op.method.toUpperCase()} ${op.path}`, simulated: simulate })
    return step ? { step } : { error: result.reason?.message }
  }

  /**
   * El ambiente activo listo para enviar peticiones fuera de un journey (Swagger UI): URLs y
   * credenciales con las {{variables}} resueltas, y los valores secretos que no se deben mostrar.
   */
  async function requestEnv(): Promise<{ servers: Record<string, string>; credentials: Record<string, string>; secrets: string[] }> {
    await loadFaker()
    const variables = variableValues(activeEnv)
    const runCredentials: Record<string, string> = resolveTemplates(credentials, variables)
    return {
      servers: resolveTemplates(servers, variables),
      credentials: runCredentials,
      secrets: secretValues({ variables: activeEnv.variables, credentials: runCredentials }),
    }
  }

  /** Cambia el idioma y regenera el análisis y los casos para que sus textos lo sigan. */
  function changeLocale(l: Locale) {
    setLocale(l)
    document.documentElement.lang = l
    if (projects.length) applyCollection(projects)
  }

  function cancelRun() {
    abort.current?.abort()
  }

  function exportReport(format: 'html' | 'json') {
    const generatedAt = new Date()
    const fileName = reportFileName(collectionTitle, generatedAt, format)
    const params = {
      arazzoTitle: collectionTitle,
      arazzoFile: projects.map((p) => p.arazzoFileName).join(', '),
      generatedAt,
      environment: runEnv?.name ?? activeEnv.name,
      servers: runEnv?.servers ?? servers,
      cases: runs,
    }
    if (format === 'html') download(buildHtmlReport(params), fileName, 'text/html')
    else download(buildJsonReport({ ...params, info: projects.length === 1 ? projects[0].arazzo.info : undefined }), fileName, 'application/json')
  }

  /** Escenarios del Arazzo del journey activo (el archivo de escenarios es de un Arazzo). */
  function exportScenariosFile() {
    const file = activeJourney?.file
    if (!file) return
    const bases = Object.fromEntries(
      Object.entries(inputs)
        .filter(([k]) => splitJourneyKey(k).file === file)
        .map(([k, v]) => [splitJourneyKey(k).workflowId, v]),
    )
    const own = cases.filter((c) => c.arazzo === file).map(unscopeCase)
    const base = file.split(/[\\/]/).pop()?.replace(/\.(ya?ml|json)$/i, '') ?? 'escenarios'
    download(exportScenarios({ title: activeJourney.project.arazzo.info?.title, bases, cases: own }), `${base}.escenarios.yaml`, 'application/yaml')
  }

  async function importScenariosFile(fileToImport: File) {
    const file = activeJourney?.file ?? ''
    const workflowIds = journeys.filter((j) => j.file === file).map((j) => j.workflowId)
    const own = cases.filter((c) => c.arazzo === file).map(unscopeCase)
    const result = importScenarios(await fileToImport.text(), own, workflowIds)
    setCases((prev) => [...prev.filter((c) => c.arazzo !== file), ...result.cases.map((c) => scopeCase(file, c))])
    if (Object.keys(result.bases).length) {
      setInputs((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(result.bases).map(([wf, v]) => [journeyKey(file, wf), v])) }))
    }
    return result
  }

  const caseActions = {
    toggle: (id: string, en: boolean) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, enabled: en } : c))),
    setMany: (ids: string[], en: boolean) => setCases((cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, enabled: en } : c))),
    updateCase: (id: string, patch: Partial<TestCase>) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    /** Un caso nuevo de un journey: se le asigna su archivo Arazzo. */
    addCase: (tc: TestCase, key: string) => setCases((cs) => [...cs, scopeCase(splitJourneyKey(key).file, tc)]),
    removeCase: (id: string) => setCases((cs) => cs.filter((c) => c.id !== id)),
  }

  return {
    locale,
    changeLocale,
    files,
    projects,
    journeys,
    activeJourney,
    collectionTitle,
    /** Credenciales que piden todos los contratos de la colección. */
    collectionSchemes: collectionCredentials(Object.values(analyses)),
    analysisOf: (file: string): ProjectAnalysis | undefined => analyses[file],
    /** Fuentes de todos los Arazzo, una por nombre (el mismo nombre comparte URL base en cada ambiente). */
    collectionSources: [...new Map(projects.flatMap((p) => p.sources).map((src) => [src.name, src])).values()],
    errors,
    selected,
    setSelected,
    inputs,
    setInput: (key: string, name: string, v: any) => setInputs((prev) => ({ ...prev, [key]: { ...prev[key], [name]: v } })),
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
    arazzoText: (file: string) => texts.find((f) => f.name === file)?.text,
    arazzoOriginal: (file: string) => originals[file],
    editArazzo,
    contractText,
    editContract,
    tryOperation,
    preludeOf: (key: string): Prelude | undefined => preludes[key],
    requestEnv,
    /** Envía una petición con el mismo ejecutor que los journeys (en escritorio, sin CORS). */
    sendHttp: realExecutor,
    makeLocalCopy,
    /** Archivos de la colección que no son Arazzo (contratos y archivos de schemas). */
    contractFiles: files.filter((f) => f.kind !== 'arazzo').map((f) => f.name),
    saveArazzo,
    isDesktop: !!desktop,
    folder: folder?.root,
    openFolder,
    fetchRemote,
    loadExample,
    createArazzo,
    createContract,
    openCollectionData,
    scenarioFiles,
    texts,
    setSessionPaused,
    reset,
    runJourney,
    cancelRun,
    exportReport,
    exportScenariosFile,
    importScenariosFile,
    requests,
  }
}

export type Studio = ReturnType<typeof useStudio>
