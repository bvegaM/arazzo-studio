/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ResolvedStep, WorkflowAnalysis } from '../../core/analyze'
import type { Action, Criterion } from '../../core/types'
import { isAsyncOperation } from '../../core/openapi'
import { t } from '../../i18n'
import { IssueBadge, Json, MethodBadge } from '../components/badges'
import { Empty } from '../components/kit'
import { plainCriterion, plainExpression } from '../../core/plain'
import { useUiMode } from '../../lib/uiMode'

interface Props {
  wa: WorkflowAnalysis
  rs: ResolvedStep
  /** URL base de cada fuente en el ambiente activo. */
  servers: Record<string, string>
  onEditYaml: () => void
  /** Probar la operación de este paso sola (solo pasos HTTP). */
  onTry?: () => void
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

function criterionPlain(c: Criterion): string {
  return plainCriterion({ condition: c.condition, context: c.context, type: typeof c.type === 'object' ? c.type.type : c.type })
}

function criterionText(c: Criterion): string {
  const type = typeof c.type === 'object' ? c.type.type : c.type
  return `${c.context ? `${c.context} ~ ` : ''}${c.condition}${type && type !== 'simple' ? ` (${type})` : ''}`
}

function ActionList({ title, actions }: { title: string; actions: Action[] }) {
  if (!actions.length) return null
  return (
    <section className="sv-block">
      <h4>{title}</h4>
      <ul className="sv-list">
        {actions.map((a, i) => (
          <li key={i}>
            <strong>{a.name ?? a.reference ?? `#${i + 1}`}</strong> <span className="badge b-skip">{a.type ?? '—'}</span>
            {a.stepId && <span className="muted"> → {a.stepId}</span>}
            {a.workflowId && <span className="muted"> → {a.workflowId}</span>}
            {a.criteria?.map((c, n) => (
              <div key={n}>
                <code>{criterionText(c)}</code>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Un paso del journey como una petición: método y URL, parámetros, body, criterios, acciones y outputs. */
export function StepView({ wa, rs, servers, onEditYaml, onTry }: Props) {
  const step = rs.step
  const op = rs.op
  const isAsync = isAsyncOperation(op)
  const url = op && !isAsync ? `${servers[op.sourceName] || `{${op.sourceName}}`}${op.path}` : op?.path
  const issues = wa.issues.filter((i) => i.stepId === step.stepId)
  const onSuccess = step.onSuccess ?? wa.workflow.successActions ?? []
  const onFailure = step.onFailure ?? wa.workflow.failureActions ?? []
  // Interfaz simple: sin metadatos técnicos y con las expresiones en palabras.
  const simple = useUiMode() === 'simple'

  return (
    <div className="ws-view step-view">
      <div className="sv-request">
        {op ? <MethodBadge method={op.method} /> : <span className="badge b-skip">{rs.kind === 'workflow' ? 'workflow' : '?'}</span>}
        <code className="grow">{url ?? rs.label}</code>
        {onTry && op && !isAsync && (
          <button className="small primary" onClick={onTry} title={t('try.stepHint')}>
            ▶ {t('try.step')}
          </button>
        )}
        <button className="small" onClick={onEditYaml}>
          {t('ws.step.editYaml')}
        </button>
      </div>
      {step.description && <p className="muted">{step.description}</p>}
      {!simple && (
      <div className="sv-meta muted small">
        {op?.operationId && <span>operationId: <code>{op.operationId}</code></span>}
        {op && <span>{t('graph.source', { source: op.sourceName })}</span>}
        {step.timeout !== undefined && <span>timeout: <code>{step.timeout} ms</code></span>}
        {step.dependsOn?.length ? <span>dependsOn: <code>{step.dependsOn.join(', ')}</code></span> : null}
        {step.correlationId !== undefined && <span>correlationId: <code>{show(step.correlationId)}</code></span>}
      </div>
      )}

      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={n}>
              <IssueBadge level={i.level} /> <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}

      <section className="sv-block">
        <h4>{t('ws.step.params')}</h4>
        {rs.parameters.length === 0 ? (
          <Empty>{t('ws.step.noParams')}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('ws.step.name')}</th>
                <th>{t('ws.step.in')}</th>
                <th>{t('ws.step.value')}</th>
              </tr>
            </thead>
            <tbody>
              {rs.parameters.map((p, i) => (
                <tr key={i}>
                  <td>
                    <code>{p.name}</code>
                  </td>
                  <td className="muted">{p.in ?? (rs.kind === 'workflow' ? 'input' : '—')}</td>
                  <td title={simple ? show(p.value) : undefined}>{simple ? plainExpression(p.value) : <code>{show(p.value)}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {step.requestBody && (
        <section className="sv-block">
          <h4>
            {isAsync ? t('ws.step.message') : 'Body'} {step.requestBody.contentType && <span className="muted small">{step.requestBody.contentType}</span>}
          </h4>
          <Json value={step.requestBody.payload as any} />
          {step.requestBody.replacements?.map((r, i) => (
            <div key={i} className="small">
              <code>{r.target}</code> ← <code>{show(r.value)}</code>
            </div>
          ))}
        </section>
      )}

      <section className="sv-block">
        <h4>{t('ws.step.criteria')}</h4>
        {step.successCriteria?.length ? (
          <ul className="sv-list">
            {step.successCriteria.map((c, i) => (
              <li key={i}>
                <span className="crit-plain">{criterionPlain(c)}</span>
                {!simple && (
                  <div className="crit-tech">
                    <code>{criterionText(c)}</code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t(isAsync ? 'ws.step.noCriteriaAsync' : 'ws.step.noCriteria')}</Empty>
        )}
      </section>

      <ActionList title={simple ? t('ws.step.onSuccessPlain') : 'onSuccess'} actions={onSuccess} />
      <ActionList title={simple ? t('ws.step.onFailurePlain') : 'onFailure'} actions={onFailure} />

      {step.outputs && Object.keys(step.outputs).length > 0 && (
        <section className="sv-block">
          <h4>{simple ? t('results.outputsPlain') : 'Outputs'}</h4>
          <table>
            <tbody>
              {Object.entries(step.outputs).map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <code>{k}</code>
                  </td>
                  <td title={simple ? show(v) : undefined}>{simple ? plainExpression(v) : <code>{show(v)}</code>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
