/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react'
import { attachSource, buildProject, fetchRemoteSource, parseFile, type ParsedFile, type Project } from './core/loader'
import { analyzeProject, type ProjectAnalysis } from './core/analyze'
import { getServerUrl } from './core/openapi'
import { fetchExecutor } from './core/http'
import { createSimulatedExecutor } from './core/simulator'
import { runWorkflow } from './core/runner'
import { applyCaseInputs, defaultInputs, evaluateCase, generateTestCases, isSimulated, runnability, type CaseRun, type RunMode, type TestCase } from './core/testcases'
import { exportScenarios, importScenarios } from './core/scenariosFile'
import { buildHtmlReport, buildJsonReport, reportFileName } from './core/report'
import { LoadScreen } from './ui/screens/LoadScreen'
import { ContractsScreen } from './ui/screens/ContractsScreen'
import { ParamsScreen } from './ui/screens/ParamsScreen'
import { CasesScreen } from './ui/screens/CasesScreen'
import { ResultsScreen } from './ui/screens/ResultsScreen'
import exampleArazzo from '../examples/credit-cards/card-onboarding.arazzo.yaml?raw'
import exampleOpenapi from '../examples/credit-cards/credit-cards.yaml?raw'


function download(text: string, name: string, type: string) {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

async function readFiles(files: File[]): Promise<ParsedFile[]> {
  return Promise.all(files.map(async (f) => parseFile({ name: f.name, text: await f.text() })))
}

export default function App() {
  const [screen, setScreen] = useState(0)
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [project, setProject] = useState<Project>()
  const [errors, setErrors] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [inputs, setInputs] = useState<Record<string, Record<string, any>>>({})
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [servers, setServers] = useState<Record<string, string>>({})
  const [cases, setCases] = useState<TestCase[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [mode, setMode] = useState<RunMode>('real')
  const [runs, setRuns] = useState<CaseRun[]>([])
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screen])

  const analysis: ProjectAnalysis | undefined = useMemo(() => (project ? analyzeProject(project) : undefined), [project])

  // Al cambiar el análisis: valores por defecto, casos y servidores.
  useEffect(() => {
    if (!analysis || !project) return
    setSelected((s) => (analysis.workflows.some((w) => w.workflow.workflowId === s) ? s : (analysis.workflows[0]?.workflow.workflowId ?? '')))
    setInputs((prev) => {
      const next = { ...prev }
      for (const w of analysis.workflows) next[w.workflow.workflowId] ??= defaultInputs(w.inputsSchema)
      return next
    })
    setServers((prev) => {
      const next = { ...prev }
      for (const s of project.sources) if (s.status === 'loaded' && next[s.name] === undefined) next[s.name] = getServerUrl(s)
      return next
    })
    setCases((prev) => {
      // Se conservan las elecciones del usuario: selección, datos propios, modo y casos creados a mano.
      const byId = new Map(prev.map((c) => [c.id, c]))
      const wfIds = new Set(analysis.workflows.map((w) => w.workflow.workflowId))
      const generated = analysis.workflows.flatMap(generateTestCases).map((c) => {
        const old = byId.get(c.id)
        return old ? { ...c, enabled: old.enabled, inputOverrides: old.inputOverrides, dataMode: old.dataMode } : c
      })
      const custom = prev.filter((c) => c.origin === 'datos' && wfIds.has(c.workflowId))
      return [...generated, ...custom]
    })
  }, [analysis, project])

  function loadParsed(parsed: ParsedFile[], replace: boolean) {
    const all = replace ? parsed : [...files.filter((f) => !parsed.some((p) => p.name === f.name)), ...parsed]
    setFiles(all)
    const { project: p, errors: e } = buildProject(all)
    setProject(p)
    setErrors(e)
  }

  function reset() {
    setFiles([])
    setProject(undefined)
    setErrors([])
    setInputs({})
    setServers({})
    setCases([])
    setRuns([])
    setConfirmed(false)
    setScreen(0)
  }

  async function runAll() {
    if (!project || !analysis) return
    const selectedCases = cases.filter((c) => c.enabled && runnability(c, mode).ok)
    const initial: CaseRun[] = selectedCases.map((tc) => ({ tc, state: 'pending', steps: [] }))
    setRuns(initial)
    setScreen(4)
    setRunning(true)
    const controller = new AbortController()
    abort.current = controller

    for (let i = 0; i < selectedCases.length; i++) {
      if (controller.signal.aborted) break
      const tc = selectedCases[i]
      const update = (patch: Partial<CaseRun>) => setRuns((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)))
      update({ state: 'running' })
      const live: any[] = []
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

  function exportReport(format: 'html' | 'json') {
    const generatedAt = new Date()
    const fileName = reportFileName(project?.arazzo.info?.title ?? 'arazzo', generatedAt, format)
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

  const reachable = (i: number) => i === 0 || (!!analysis && (i < 4 || runs.length > 0))

  const allIssues = analysis ? [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)] : []
  const errorCount = allIssues.filter((i) => i.level === 'error').length
  const missingInputs = analysis
    ? analysis.workflows.reduce((n, w) => n + w.requiredInputs.filter((k) => inputs[w.workflow.workflowId]?.[k] === undefined || inputs[w.workflow.workflowId]?.[k] === '').length, 0)
    : 0
  const done = runs.filter((r) => r.state === 'done')
  const failedRuns = done.filter((r) => r.verdict === 'failed').length
  const passedRuns = done.filter((r) => r.verdict === 'passed').length
  const inconclusiveRuns = done.filter((r) => r.verdict === 'inconclusive').length
  const nav: { label: string; sub: string; tone?: 'ok' | 'err' | 'warn' }[] = [
    { label: 'Cargar', sub: project ? `${files.length} archivo(s)` : 'Sin archivos', tone: project ? (project.sources.some((x) => x.status !== 'loaded') ? 'err' : 'ok') : undefined },
    { label: 'Contratos', sub: analysis ? (errorCount ? `${errorCount} error(es)` : `${analysis.workflows.length} workflow(s)`) : '—', tone: analysis ? (errorCount ? 'err' : 'ok') : undefined },
    { label: 'Valores por defecto', sub: analysis ? (missingInputs ? `Faltan ${missingInputs}` : 'Completos') : '—', tone: analysis ? (missingInputs ? 'warn' : 'ok') : undefined },
    { label: 'Casos', sub: analysis ? `${cases.filter((c) => c.enabled && runnability(c, mode).ok).length} listos para ejecutar` : '—' },
    { label: 'Resultados', sub: runs.length ? (running ? `${done.length}/${runs.length} ejecutando…` : `${passedRuns}/${runs.length} pasaron`) : '—', tone: runs.length && !running ? (failedRuns ? 'err' : inconclusiveRuns ? 'warn' : 'ok') : undefined },
  ]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <div>Arazzo Studio</div>
            <div className="brand-sub">Pruebas de workflows</div>
          </div>
        </div>
        {project && (
          <div className="sidebar-project" title={project.arazzo.info?.title}>
            {project.arazzo.info?.title ?? project.arazzoFileName}
          </div>
        )}
        <nav className="nav">
          {nav.map((n, i) => (
            <button key={n.label} className={`nav-item ${i === screen ? 'active' : ''}`} disabled={!reachable(i)} onClick={() => setScreen(i)}>
              <span className={`nav-num ${n.tone ? `t-${n.tone}` : ''}`}>{i + 1}</span>
              <span className="nav-text">
                <span className="nav-label">{n.label}</span>
                <span className="nav-sub">{n.sub}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">Todo corre en tu navegador. Nada se envía a un servidor propio.</div>
      </aside>

      <div className="content">
        <main className="main">
        {screen === 0 && (
          <LoadScreen
            files={files}
            project={project}
            errors={errors}
            onFiles={async (fs) => loadParsed(await readFiles(fs), false)}
            onAttach={async (name, f) => {
              if (!project) return
              const [parsed] = await readFiles([f])
              setFiles((prev) => [...prev.filter((x) => x.name !== parsed.name), parsed])
              setProject(attachSource(project, name, parsed))
            }}
            onFetchRemote={async (name) => project && setProject(await fetchRemoteSource(project, name))}
            onExample={() =>
              loadParsed(
                [
                  parseFile({ name: 'card-onboarding.arazzo.yaml', text: exampleArazzo }),
                  parseFile({ name: 'credit-cards.yaml', text: exampleOpenapi }),
                ],
                true,
              )
            }
            onReset={reset}
            onNext={() => setScreen(1)}
          />
        )}
        {screen === 1 && analysis && (
          <ContractsScreen analysis={analysis} selected={selected} onSelect={setSelected} onBack={() => setScreen(0)} onNext={() => setScreen(2)} />
        )}
        {screen === 2 && analysis && project && (
          <ParamsScreen
            project={project}
            analysis={analysis}
            selected={selected}
            onSelect={setSelected}
            inputs={inputs}
            setInput={(wf, name, v) => setInputs((prev) => ({ ...prev, [wf]: { ...prev[wf], [name]: v } }))}
            credentials={credentials}
            setCredential={(k, v) => setCredentials((prev) => ({ ...prev, [k]: v }))}
            servers={servers}
            setServer={(n, v) => setServers((prev) => ({ ...prev, [n]: v }))}
            onBack={() => setScreen(1)}
            onNext={() => setScreen(3)}
          />
        )}
        {screen === 3 && analysis && (
          <CasesScreen
            analysis={analysis}
            cases={cases}
            toggle={(id, en) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, enabled: en } : c)))}
            setMany={(ids, en) => setCases((cs) => cs.map((c) => (ids.includes(c.id) ? { ...c, enabled: en } : c)))}
            mode={mode}
            setMode={setMode}
            updateCase={(id, patch) => setCases((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))}
            addCase={(tc) => setCases((cs) => [...cs, tc])}
            removeCase={(id) => setCases((cs) => cs.filter((c) => c.id !== id))}
            onExportScenarios={() =>
              download(
                exportScenarios({ title: project?.arazzo.info?.title, bases: inputs, cases }),
                'escenarios.arazzo-studio.yaml',
                'application/yaml',
              )
            }
            onImportScenarios={async (file) => {
              const result = importScenarios(await file.text(), cases, analysis.workflows.map((w) => w.workflow.workflowId))
              setCases(result.cases)
              if (Object.keys(result.bases).length) setInputs((prev) => ({ ...prev, ...result.bases }))
              return result
            }}
            inputs={inputs}
            servers={servers}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            running={running}
            onRun={runAll}
            onBack={() => setScreen(2)}
          />
        )}
        {screen === 4 && (
          <ResultsScreen
            runs={runs}
            running={running}
            onCancel={() => abort.current?.abort()}
            onRerun={runAll}
            onExport={exportReport}
            onBack={() => setScreen(3)}
          />
        )}
        </main>
      </div>
    </div>
  )
}
