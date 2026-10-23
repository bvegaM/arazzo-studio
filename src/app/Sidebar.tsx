import { missingInputs } from '../core/schemaForm'
import { runnability } from '../core/testcases'
import { LOCALES, t } from '../i18n'
import { Segmented } from '../ui/components/kit'
import { Screen, type Studio } from './useStudio'

type Tone = 'ok' | 'err' | 'warn'

interface NavItem {
  label: string
  sub: string
  tone?: Tone
}

function workflowsLabel(testing: number, total: number) {
  return testing === total ? t('nav.workflows', { n: total }) : t('nav.workflowsOf', { n: testing, total })
}

/** Resumen de cada paso del flujo para la barra lateral. */
function navItems(s: Studio): NavItem[] {
  const { project, analysis, testAnalysis, files, inputs, testCases: cases, mode, runs, running } = s
  const allIssues = analysis ? [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)] : []
  const errorCount = allIssues.filter((i) => i.level === 'error').length
  const missing = testAnalysis ? testAnalysis.workflows.reduce((n, w) => n + missingInputs(w.inputsSchema, inputs[w.workflow.workflowId]).length, 0) : 0
  const done = runs.filter((r) => r.state === 'done')
  const failedRuns = done.filter((r) => r.verdict === 'failed').length
  const passedRuns = done.filter((r) => r.verdict === 'passed').length
  const inconclusiveRuns = done.filter((r) => r.verdict === 'inconclusive').length
  return [
    { label: t('nav.load'), sub: project ? t('nav.files', { n: files.length }) : t('nav.noFiles'), tone: project ? (project.sources.some((x) => x.status !== 'loaded') ? 'err' : 'ok') : undefined },
    { label: t('nav.contracts'), sub: analysis ? (errorCount ? t('nav.errors', { n: errorCount }) : workflowsLabel(testAnalysis?.workflows.length ?? 0, analysis.workflows.length)) : '—', tone: analysis ? (errorCount ? 'err' : 'ok') : undefined },
    { label: t('nav.defaults'), sub: analysis ? (missing ? t('nav.missing', { n: missing }) : t('nav.complete')) : '—', tone: analysis ? (missing ? 'warn' : 'ok') : undefined },
    { label: t('nav.cases'), sub: analysis ? t('nav.ready', { n: cases.filter((c) => c.enabled && runnability(c, mode).ok).length }) : '—' },
    { label: t('nav.results'), sub: runs.length ? (running ? t('nav.running', { done: done.length, total: runs.length }) : t('nav.passed', { passed: passedRuns, total: runs.length })) : '—', tone: runs.length && !running ? (failedRuns ? 'err' : inconclusiveRuns ? 'warn' : 'ok') : undefined },
  ]
}

export function Sidebar({ studio }: { studio: Studio }) {
  const { project, analysis, testAnalysis, runs, screen, goTo, locale, changeLocale } = studio
  const hasWorkflows = !!testAnalysis?.workflows.length
  const reachable = (i: number) => {
    if (i === Screen.Load) return true
    if (i === Screen.Contracts) return !!analysis
    if (i === Screen.Results) return runs.length > 0
    return hasWorkflows
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">A</div>
        <div>
          <div>Arazzo Studio</div>
          <div className="brand-sub">{t('brand.sub')}</div>
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
      <div className="sidebar-foot">{t('sidebar.privacy')}</div>
      <div className="sidebar-lang" aria-label={t('sidebar.language')}>
        <Segmented options={LOCALES.map((l) => ({ id: l.id, label: l.label }))} value={locale} onChange={changeLocale} />
      </div>
    </aside>
  )
}
