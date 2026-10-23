import type { Issue, ProjectAnalysis, WorkflowAnalysis } from '../core/analyze'
import { IssueBadge, MethodBadge } from './common'
import { ActionBar, Metric, MoreText, PageHeader, Section } from './kit'
import { WorkflowGraph } from './WorkflowGraph'

interface Props {
  analysis: ProjectAnalysis
  selected: string
  onSelect: (id: string) => void
  onBack: () => void
  onNext: () => void
}

function count(issues: Issue[], level: Issue['level']) {
  return issues.filter((i) => i.level === level).length
}

export function ContractsScreen({ analysis, selected, onSelect, onBack, onNext }: Props) {
  const wa = analysis.workflows.find((w) => w.workflow.workflowId === selected) ?? analysis.workflows[0]
  const allIssues = [...analysis.issues, ...analysis.workflows.flatMap((w) => w.issues)]

  return (
    <>
      <PageHeader step={2} title="Contratos y workflows" description="Cómo se resolvió cada paso contra los contratos, qué está mal y qué respuestas maneja el Arazzo." />

      <div className="metrics">
        <Metric label="Workflows" value={analysis.workflows.length} />
        <Metric label="Pasos" value={analysis.workflows.reduce((n, w) => n + w.steps.length, 0)} />
        <Metric label="Errores" value={count(allIssues, 'error')} tone={count(allIssues, 'error') ? 'err' : 'ok'} />
        <Metric label="Advertencias" value={count(allIssues, 'warning')} tone={count(allIssues, 'warning') ? 'warn' : undefined} />
      </div>

      {analysis.issues.length > 0 && <IssuesSection title="Validación general" issues={analysis.issues} />}

      {analysis.workflows.length > 1 && (
        <div className="workflow-picker">
          {analysis.workflows.map((w) => {
            const errs = count(w.issues, 'error')
            const warns = count(w.issues, 'warning')
            return (
              <button key={w.workflow.workflowId} className={w === wa ? 'active' : ''} onClick={() => onSelect(w.workflow.workflowId)}>
                <span className="wp-title">{w.workflow.workflowId}</span>
                <span className="wp-meta">
                  {w.steps.length} {w.steps.length === 1 ? 'paso' : 'pasos'}
                  {errs > 0 && <span className="badge b-err">{errs} error(es)</span>}
                  {warns > 0 && <span className="badge b-warn">{warns} advertencia(s)</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {wa && <WorkflowDetail key={wa.workflow.workflowId} wa={wa} />}

      <ActionBar
        left={<button onClick={onBack}>← Volver</button>}
        right={
          <button className="primary" onClick={onNext}>
            Configurar parámetros →
          </button>
        }
      />
    </>
  )
}

function WorkflowDetail({ wa }: { wa: WorkflowAnalysis }) {
  const rows = wa.coverage.flatMap((c) => c.rows)
  const handled = rows.filter((r) => r.kind !== 'sin-manejo').length
  const errs = count(wa.issues, 'error')
  const warns = count(wa.issues, 'warning')

  return (
    <>
      <Section
        title="Diagrama del flujo"
        subtitle={wa.workflow.summary}
        badges={<span className="badge b-skip">{wa.steps.length} {wa.steps.length === 1 ? 'paso' : 'pasos'}</span>}
        defaultOpen
      >
        {wa.workflow.description && <MoreText text={wa.workflow.description} />}
        <WorkflowGraph wa={wa} />
      </Section>

      <IssuesSection title="Validación del workflow" issues={wa.issues} defaultOpen={errs > 0 || warns > 0} />

      {rows.length > 0 && (
        <Section
          title="Cobertura de respuestas"
          badges={<span className={`badge ${handled === rows.length ? 'b-ok' : 'b-warn'}`}>{handled}/{rows.length} manejadas</span>}
          subtitle="Respuestas documentadas en el contrato frente a cómo las maneja el Arazzo"
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Las respuestas sin manejo hacen fallar el workflow con un error genérico.
          </p>
          <table>
            <thead>
              <tr>
                <th>Paso</th>
                <th>Status</th>
                <th>Descripción en el contrato</th>
                <th>Manejo en el Arazzo</th>
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
                        <span className="badge b-err">❌ Sin manejo</span>
                      ) : (
                        <span className="badge b-ok wrap">
                          ✅ {r.kind === 'exito' ? 'Éxito' : 'Acción'}: {r.handledBy.join(', ')}
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

      <Section title="Pasos y operaciones" badges={<span className="badge b-skip">{wa.steps.length}</span>} subtitle={wa.steps.map((s) => s.step.stepId).join(' → ')}>
        <table className="steps-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Paso</th>
              <th>Operación</th>
              <th>Fuente</th>
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
          <span className="badge b-ok">✅ Sin observaciones</span>
        ) : (
          <>
            {errs > 0 && <span className="badge b-err">{errs} error(es)</span>}
            {warns > 0 && <span className="badge b-warn">{warns} advertencia(s)</span>}
            {infos > 0 && <span className="badge b-info">{infos} info</span>}
          </>
        )
      }
    >
      {issues.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No hay observaciones.
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
