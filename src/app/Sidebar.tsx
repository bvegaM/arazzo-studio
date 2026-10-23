import { runnability } from '../core/testcases'
import type { Screen, Studio } from './useStudio'

type Tone = 'ok' | 'err' | 'warn'

interface NavItem {
  label: string
  sub: string
  tone?: Tone
}

/** Resumen de cada paso del flujo para la barra lateral. */
function navItems(s: Studio): NavItem[] {
  const { project, analysis, files, inputs, cases, mode, runs, running } = s
  const allIssues = analysis ? [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)] : []
  const errorCount = allIssues.filter((i) => i.level === 'error').length
  const missingInputs = analysis
    ? analysis.workflows.reduce((n, w) => n + w.requiredInputs.filter((k) => inputs[w.workflow.workflowId]?.[k] === undefined || inputs[w.workflow.workflowId]?.[k] === '').length, 0)
    : 0
  const done = runs.filter((r) => r.state === 'done')
  const failedRuns = done.filter((r) => r.verdict === 'failed').length
  const passedRuns = done.filter((r) => r.verdict === 'passed').length
  const inconclusiveRuns = done.filter((r) => r.verdict === 'inconclusive').length
  return [
    { label: 'Cargar', sub: project ? `${files.length} archivo(s)` : 'Sin archivos', tone: project ? (project.sources.some((x) => x.status !== 'loaded') ? 'err' : 'ok') : undefined },
    { label: 'Contratos', sub: analysis ? (errorCount ? `${errorCount} error(es)` : `${analysis.workflows.length} workflow(s)`) : '—', tone: analysis ? (errorCount ? 'err' : 'ok') : undefined },
    { label: 'Valores por defecto', sub: analysis ? (missingInputs ? `Faltan ${missingInputs}` : 'Completos') : '—', tone: analysis ? (missingInputs ? 'warn' : 'ok') : undefined },
    { label: 'Casos', sub: analysis ? `${cases.filter((c) => c.enabled && runnability(c, mode).ok).length} listos para ejecutar` : '—' },
    { label: 'Resultados', sub: runs.length ? (running ? `${done.length}/${runs.length} ejecutando…` : `${passedRuns}/${runs.length} pasaron`) : '—', tone: runs.length && !running ? (failedRuns ? 'err' : inconclusiveRuns ? 'warn' : 'ok') : undefined },
  ]
}

export function Sidebar({ studio }: { studio: Studio }) {
  const { project, analysis, runs, screen, goTo } = studio
  const reachable = (i: number) => i === 0 || (!!analysis && (i < 4 || runs.length > 0))

  return (
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
        {navItems(studio).map((n, i) => (
          <button key={n.label} className={`nav-item ${i === screen ? 'active' : ''}`} disabled={!reachable(i)} onClick={() => goTo(i as Screen)}>
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
  )
}
