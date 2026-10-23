import { useMemo, useRef, useState } from 'react'
import { REASON_LABEL, type StepResult } from '../../core/runner'
import { dataSummary, type CaseRun, type Verdict } from '../../core/testcases'
import { maskDeep } from '../../core/report'
import { Json, MethodBadge, StatusBadge, VerdictBadge } from '../components/badges'
import { ActionBar, Chevron, Empty, Metric, PageHeader, Pill, Tabs } from '../components/kit'

interface Props {
  runs: CaseRun[]
  running: boolean
  onCancel: () => void
  onRerun: () => void
  onExport: (format: 'html' | 'json') => void
  onBack: () => void
}

type Filter = 'all' | Verdict
type StepTab = 'resumen' | 'peticion' | 'respuesta' | 'contrato' | 'outputs'

const REASON_CLS: Record<string, string> = { contrato: 'warn', output: 'warn', dependencia: 'skip' }

function headersText(h: Record<string, string>) {
  return Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

function StepCard({ s, index }: { s: StepResult; index: number }) {
  const [open, setOpen] = useState(s.status === 'failed' || s.status === 'warning')
  const [tab, setTab] = useState<StepTab>('resumen')
  const reasonTone = s.reason ? (REASON_CLS[s.reason.category] ?? (s.status === 'skipped' ? 'skip' : 'err')) : ''
  const failedCriteria = s.criteria.filter((c) => !c.passed).length
  const outputs = Object.keys(s.outputs).length

  return (
    <div className={`step-result st-${s.status} ${open ? 'open' : ''}`}>
      <button className="step-head" onClick={() => setOpen(!open)} disabled={s.status === 'skipped'}>
        <span className="step-index">{index + 1}</span>
        <StatusBadge status={s.status} />
        <strong>{s.stepId}</strong>
        {s.request ? (
          <span className="label">
            <MethodBadge method={s.request.method} /> {s.label.split(' ').slice(1).join(' ')}
          </span>
        ) : (
          <span className="label muted">{s.label}</span>
        )}
        <span className="spacer" />
        {s.simulated && <span className="badge b-accent">Simulado</span>}
        {s.attempts > 1 && <span className="badge b-info">Intento {s.attempts}</span>}
        {s.response && (
          <span className="http muted small">
            <strong className={s.response.status < 400 ? 'ok' : 'err'}>{s.response.status}</strong> · {s.response.durationMs} ms
          </span>
        )}
        {s.status !== 'skipped' && <Chevron open={open} />}
      </button>

      {(s.reason || s.action || s.actionName) && (
        <div className="step-notes">
          {s.reason && (
            <div className={`note n-${reasonTone}`}>
              <strong>{REASON_LABEL[s.reason.category]}:</strong> {s.reason.message}
            </div>
          )}
          {(s.action || s.actionName) && <div className="note n-action">↪ {s.action ?? `Acción "${s.actionName}" (${s.actionType})`}</div>}
        </div>
      )}

      {open && s.status !== 'skipped' && (
        <div className="step-detail">
          <Tabs<StepTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'resumen', label: 'Criterios', count: s.criteria.length, tone: failedCriteria ? 'err' : 'ok' },
              { id: 'peticion', label: 'Petición' },
              { id: 'respuesta', label: 'Respuesta' },
              { id: 'contrato', label: 'Contrato', count: s.response ? s.contractIssues.length : undefined, tone: s.contractIssues.length ? 'warn' : 'ok' },
              { id: 'outputs', label: 'Outputs', count: outputs },
            ]}
          />
          <div className="tab-body">
            {tab === 'resumen' &&
              (s.criteria.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Condición</th>
                      <th>Resultado</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.criteria.map((c, i) => (
                      <tr key={i}>
                        <td>
                          <code>{c.context ? `${c.context} ~ ${c.condition}` : c.condition}</code>
                          {c.type !== 'simple' && <span className="muted small"> ({c.type})</span>}
                        </td>
                        <td>{c.passed ? <span className="badge b-ok">✅ Se cumple</span> : <span className="badge b-err">❌ No se cumple</span>}</td>
                        <td>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>Sin criterios evaluados.</Empty>
              ))}
            {tab === 'peticion' &&
              (s.request ? (
                <div className="io">
                  <div>
                    <h4>Línea y headers</h4>
                    <pre>{`${s.request.method} ${s.request.url}\n${headersText(s.request.headers)}`}</pre>
                  </div>
                  <div>
                    <h4>Body</h4>
                    <Json value={s.request.body} />
                  </div>
                </div>
              ) : (
                <Empty>No se envió petición.</Empty>
              ))}
            {tab === 'respuesta' &&
              (s.response ? (
                <div className="io">
                  <div>
                    <h4>Status y headers</h4>
                    <pre>{`HTTP ${s.response.status} ${s.response.statusText}\n${headersText(s.response.headers)}`}</pre>
                  </div>
                  <div>
                    <h4>Body</h4>
                    <Json value={s.response.body} />
                  </div>
                </div>
              ) : (
                <Empty>Sin respuesta.</Empty>
              ))}
            {tab === 'contrato' &&
              (!s.response ? (
                <Empty>Sin respuesta que validar.</Empty>
              ) : s.contractIssues.length === 0 ? (
                <span className="badge b-ok">✅ La respuesta cumple el contrato</span>
              ) : (
                <ul className="issues">
                  {s.contractIssues.map((c, i) => (
                    <li key={i}>
                      <span className="badge b-warn">Contrato</span> <span>{c}</span>
                    </li>
                  ))}
                </ul>
              ))}
            {tab === 'outputs' &&
              (outputs || s.missingOutputs.length ? (
                <table>
                  <tbody>
                    {Object.entries(s.outputs).map(([k, v]) => (
                      <tr key={k}>
                        <td>
                          <code>{k}</code>
                        </td>
                        <td>
                          <code>{JSON.stringify(v)}</code>
                        </td>
                      </tr>
                    ))}
                    {s.status !== 'failed' &&
                      s.missingOutputs.map((k) => (
                        <tr key={k}>
                          <td>
                            <code>{k}</code>
                          </td>
                          <td>
                            <span className="badge b-skip">No vino en la respuesta</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <Empty>El paso no declara outputs.</Empty>
              ))}
            {s.subRun && (
              <div style={{ marginTop: 12 }}>
                <h4>Sub-workflow {s.subRun.workflowId}</h4>
                <div className="steps">
                  {s.subRun.steps.map((x, i) => (
                    <StepCard key={i} s={x} index={i} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ResultsScreen({ runs, running, onCancel, onRerun, onExport, onBack }: Props) {
  const [selectedId, setSelectedId] = useState<string>()
  const [filter, setFilter] = useState<Filter>('all')
  // En pantallas angostas los grupos empiezan plegados para no empujar el detalle hacia abajo.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 960
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    narrow ? Object.fromEntries(runs.map((r) => [r.tc.workflowId, true])) : {},
  )
  const detailRef = useRef<HTMLDivElement>(null)
  const select = (id: string) => {
    setSelectedId(id)
    if (window.innerWidth < 960) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  const done = runs.filter((r) => r.state === 'done')
  const count = (v: Verdict) => done.filter((r) => r.verdict === v).length
  const visible = runs.filter((r) => filter === 'all' || r.verdict === filter)
  const groups = useMemo(() => {
    const map = new Map<string, CaseRun[]>()
    for (const r of visible) map.set(r.tc.workflowId, [...(map.get(r.tc.workflowId) ?? []), r])
    return [...map.entries()]
  }, [visible])
  const current = runs.find((r) => r.tc.id === selectedId) ?? visible[0] ?? runs[0]

  if (!runs.length) {
    return (
      <>
        <PageHeader step={5} title="Resultados" />
        <Empty>Todavía no se ha ejecutado ningún caso.</Empty>
        <ActionBar left={<button onClick={onBack}>← Volver a los casos</button>} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        step={5}
        title="Resultados"
        description={`${done.length} de ${runs.length} casos ejecutados${running ? '…' : '.'}`}
        actions={
          running ? (
            <button onClick={onCancel}>Cancelar</button>
          ) : (
            <div className="row">
              <button onClick={onRerun}>Volver a ejecutar</button>
              <button onClick={() => onExport('json')}>JSON</button>
              <button className="primary" onClick={() => onExport('html')}>
                Descargar reporte
              </button>
            </div>
          )
        }
      />

      <div className="metrics">
        <Metric label="Pasaron" value={count('passed')} tone="ok" />
        <Metric label="No pasaron" value={count('failed')} tone={count('failed') ? 'err' : undefined} />
        <Metric label="No concluyentes" value={count('inconclusive')} tone={count('inconclusive') ? 'warn' : undefined} />
        <Metric label="Pendientes" value={runs.length - done.length} />
      </div>
      {running && (
        <div className="progress">
          <div style={{ width: `${(done.length / runs.length) * 100}%` }} />
        </div>
      )}

      <div className="results-layout">
        <aside className="case-nav">
          <div className="filters">
            <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
              Todos <span className="count">{runs.length}</span>
            </Pill>
            <Pill active={filter === 'failed'} onClick={() => setFilter('failed')}>
              ❌ <span className="count">{count('failed')}</span>
            </Pill>
            <Pill active={filter === 'inconclusive'} onClick={() => setFilter('inconclusive')}>
              ❔ <span className="count">{count('inconclusive')}</span>
            </Pill>
            <Pill active={filter === 'passed'} onClick={() => setFilter('passed')}>
              ✅ <span className="count">{count('passed')}</span>
            </Pill>
          </div>
          {groups.length === 0 && <Empty>No hay casos con este filtro.</Empty>}
          {groups.map(([wf, list]) => (
            <div className="case-nav-group" key={wf}>
              <button className="case-nav-head" onClick={() => setCollapsed({ ...collapsed, [wf]: !collapsed[wf] })}>
                <Chevron open={!collapsed[wf]} />
                <span className="grow">{wf}</span>
                <span className="muted small">{list.length}</span>
              </button>
              {!collapsed[wf] &&
                list.map((r) => (
                  <button key={r.tc.id} title={r.tc.title} className={`case-nav-item ${r === current ? 'active' : ''}`} onClick={() => select(r.tc.id)}>
                    <span className={`status-dot sd-${r.state === 'done' ? r.verdict : r.state}`} />
                    <span className="grow clamp">{r.tc.title}</span>
                    {r.steps.some((s) => s.simulated) && <span className="badge b-accent tiny">Sim</span>}
                  </button>
                ))}
            </div>
          ))}
        </aside>

        {current && (
          <div className="case-detail" ref={detailRef}>
            <div className="case-summary">
              <div className="row">
                <h2>{current.tc.title}</h2>
                {current.verdict ? (
                  <VerdictBadge verdict={current.verdict} />
                ) : (
                  <span className="badge b-skip">{current.state === 'running' ? '⏳ Ejecutando' : 'Pendiente'}</span>
                )}
              </div>
              <div className="kv">
                <span>Esperado</span>
                <span>{current.tc.expectation.text}</span>
                {current.explanation && (
                  <>
                    <span>Resultado</span>
                    <span>{current.explanation}</span>
                  </>
                )}
                <span>Parámetros</span>
                <span>
                  <code>{dataSummary(current.tc)}</code>
                  {current.inputsUsed && (
                    <details className="inputs-used">
                      <summary>Ver valores enviados ({Object.keys(current.inputsUsed).length})</summary>
                      <table>
                        <tbody>
                          {Object.entries(maskDeep(current.inputsUsed)).map(([k, v]) => (
                            <tr key={k}>
                              <td>
                                <code>{k}</code>
                              </td>
                              <td>
                                <code>{typeof v === 'string' ? v : JSON.stringify(v)}</code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </span>
                {current.result && Object.keys(current.result.outputs).length > 0 && (
                  <>
                    <span>Outputs</span>
                    <code className="clamp" title={JSON.stringify(current.result.outputs)}>
                      {JSON.stringify(current.result.outputs)}
                    </code>
                  </>
                )}
              </div>
            </div>
            <div className="steps">
              {current.steps.length === 0 && <Empty>{current.state === 'pending' ? 'Pendiente de ejecución.' : current.state === 'running' ? 'Ejecutando…' : 'No se ejecutaron pasos.'}</Empty>}
              {current.steps.map((s, i) => (
                <StepCard key={`${current.tc.id}-${i}`} s={s} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>

      <ActionBar left={<button onClick={onBack}>← Volver a los casos</button>} />
    </>
  )
}
