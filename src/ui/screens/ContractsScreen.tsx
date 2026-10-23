import { lazy, Suspense } from 'react'
import type { Issue, ProjectAnalysis, WorkflowAnalysis } from '../../core/analyze'
import { t } from '../../i18n'
import { useLocale } from '../../i18n/react'
import { IssueBadge, MethodBadge } from '../components/badges'
import { ActionBar, Empty, Metric, MoreText, PageHeader, Section } from '../components/kit'
import { WorkflowPicker, type PickerItem } from '../components/WorkflowPicker'

// React Flow pesa bastante: se carga solo cuando se muestra el diagrama.
const WorkflowGraph = lazy(() => import('../components/WorkflowGraph').then((m) => ({ default: m.WorkflowGraph })))

interface Props {
  analysis: ProjectAnalysis
  selected: string
  onSelect: (id: string) => void
  onBack: () => void
  onNext: () => void
}

function stepsLabel(n: number) {
  return t(n === 1 ? 'contracts.oneStep' : 'contracts.nSteps', { n })
}

function count(issues: Issue[], level: Issue['level']) {
  return issues.filter((i) => i.level === level).length
}

export function ContractsScreen({ analysis, selected, onSelect, onBack, onNext }: Props) {
  const wa = analysis.workflows.find((w) => w.workflow.workflowId === selected) ?? analysis.workflows[0]
  const allIssues = [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)]
  const pickerItems: PickerItem[] = analysis.workflows.map((w) => {
    const errs = count(w.issues, 'error')
    const warns = count(w.issues, 'warning')
    if (errs) return { id: w.workflow.workflowId, summary: w.workflow.summary, tone: 'err', meta: t('nav.errors', { n: errs }) }
    if (warns) return { id: w.workflow.workflowId, summary: w.workflow.summary, tone: 'warn', meta: t('contracts.warningsN', { n: warns }) }
    return { id: w.workflow.workflowId, summary: w.workflow.summary, tone: 'ok', meta: stepsLabel(w.steps.length) }
  })

  return (
    <>
      <PageHeader step={2} title={t('contracts.title')} description={t('contracts.description')} />

      <div className="metrics">
        <Metric label="Workflows" value={analysis.workflows.length} />
        <Metric label={t('contracts.steps')} value={analysis.workflows.reduce((n, w) => n + w.steps.length, 0)} />
        <Metric label={t('contracts.errors')} value={count(allIssues, 'error')} tone={count(allIssues, 'error') ? 'err' : 'ok'} />
        <Metric label={t('contracts.warnings')} value={count(allIssues, 'warning')} tone={count(allIssues, 'warning') ? 'warn' : undefined} />
      </div>

      {analysis.issues.length > 0 && <IssuesSection title={t('contracts.generalValidation')} issues={analysis.issues} />}

      {analysis.workflows.length > 1 && (
        <WorkflowPicker
          value={wa?.workflow.workflowId ?? ''}
          onChange={onSelect}
          summary={t('contracts.pickerSummary', { ok: pickerItems.filter((i) => i.tone !== 'err').length, total: pickerItems.length })}
          items={pickerItems}
        />
      )}

      {wa && <WorkflowDetail key={wa.workflow.workflowId} wa={wa} />}

      <ActionBar
        left={<button onClick={onBack}>{t('common.back')}</button>}
        right={
          <button className="primary" onClick={onNext}>
            {t('contracts.next')}
          </button>
        }
      />
    </>
  )
}

function WorkflowDetail({ wa }: { wa: WorkflowAnalysis }) {
  const locale = useLocale()
  const rows = wa.coverage.flatMap((c) => c.rows)
  const handled = rows.filter((r) => r.kind !== 'sin-manejo').length
  const errs = count(wa.issues, 'error')
  const warns = count(wa.issues, 'warning')

  return (
    <>
      <Section
        title={t('contracts.diagram')}
        subtitle={wa.workflow.summary}
        badges={<span className="badge b-skip">{stepsLabel(wa.steps.length)}</span>}
        defaultOpen
      >
        {wa.workflow.description && <MoreText text={wa.workflow.description} />}
        <Suspense fallback={<Empty>{t('contracts.loadingDiagram')}</Empty>}>
          {/* Se vuelve a montar al cambiar de idioma para regenerar los textos del grafo. */}
          <WorkflowGraph key={locale} wa={wa} />
        </Suspense>
      </Section>

      <IssuesSection title={t('contracts.workflowValidation')} issues={wa.issues} defaultOpen={errs > 0 || warns > 0} />

      {rows.length > 0 && (
        <Section
          title={t('contracts.coverage')}
          badges={<span className={`badge ${handled === rows.length ? 'b-ok' : 'b-warn'}`}>{t('contracts.handled', { handled, total: rows.length })}</span>}
          subtitle={t('contracts.coverageSubtitle')}
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            {t('contracts.coverageHint')}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t('contracts.col.step')}</th>
                <th>Status</th>
                <th>{t('contracts.col.contractDescription')}</th>
                <th>{t('contracts.col.handling')}</th>
              </tr>
            </thead>
            <tbody>
              {wa.coverage.flatMap((c) =>
                c.rows.map((r, i) => (
                  <tr key={c.stepId + r.status} className={i === 0 ? 'group-start' : ''}>
                    <td>{i === 0 ? <strong>{c.stepId}</strong> : ''}</td>
                    <td>
                      <code>{r.status}</code>
                    </td>
                    <td className="muted">{r.description}</td>
                    <td>
                      {r.kind === 'sin-manejo' ? (
                        <span className="badge b-err">❌ {t('contracts.unhandled')}</span>
                      ) : (
                        <span className="badge b-ok wrap">
                          ✅ {r.kind === 'exito' ? t('contracts.success') : t('contracts.action')}: {r.handledBy.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={t('contracts.stepsAndOps')} badges={<span className="badge b-skip">{wa.steps.length}</span>} subtitle={wa.steps.map((s) => s.step.stepId).join(' → ')}>
        <table className="steps-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('contracts.col.step')}</th>
              <th>{t('contracts.col.operation')}</th>
              <th>{t('contracts.col.source')}</th>
            </tr>
          </thead>
          <tbody>
            {wa.steps.map((rs, i) => (
              <tr key={rs.step.stepId}>
                <td className="muted">{i + 1}</td>
                <td>
                  <strong>{rs.step.stepId}</strong>
                  {rs.step.description && (
                    <div className="muted small clamp-2" title={rs.step.description}>
                      {rs.step.description}
                    </div>
                  )}
                </td>
                <td className="nowrap">
                  {rs.op ? (
                    <>
                      <MethodBadge method={rs.op.method} /> <code>{rs.op.path}</code>
                    </>
                  ) : (
                    <span style={{ color: rs.kind === 'unresolved' ? 'var(--err)' : undefined }}>{rs.label}</span>
                  )}
                </td>
                <td className="muted small nowrap">{rs.op?.sourceName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  )
}

function IssuesSection({ title, issues, defaultOpen }: { title: string; issues: Issue[]; defaultOpen?: boolean }) {
  const errs = count(issues, 'error')
  const warns = count(issues, 'warning')
  const infos = count(issues, 'info')
  return (
    <Section
      title={title}
      tone={errs ? 'err' : warns ? 'warn' : undefined}
      defaultOpen={defaultOpen ?? (errs > 0 || warns > 0)}
      badges={
        issues.length === 0 ? (
          <span className="badge b-ok">✅ {t('contracts.noIssues')}</span>
        ) : (
          <>
            {errs > 0 && <span className="badge b-err">{t('nav.errors', { n: errs })}</span>}
            {warns > 0 && <span className="badge b-warn">{t('contracts.warningsN', { n: warns })}</span>}
            {infos > 0 && <span className="badge b-info">{t('contracts.infosN', { n: infos })}</span>}
          </>
        )
      }
    >
      {issues.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('contracts.noIssuesText')}
        </p>
      ) : (
        <ul className="issues">
          {[...issues]
            .sort((a, b) => ['error', 'warning', 'info'].indexOf(a.level) - ['error', 'warning', 'info'].indexOf(b.level))
            .map((i, n) => (
              <li key={n}>
                <IssueBadge level={i.level} />
                <span>
                  {i.stepId && <code className="step-ref">{i.stepId}</code>} {i.message}
                </span>
              </li>
            ))}
        </ul>
      )}
    </Section>
  )
}
