import { useMemo, useRef, useState } from 'react'
import { realRequest, reasonLabel, type StepResult } from '../../core/runner'
import { hasMaskedValues, toCurl, type CurlRequest } from '../../core/curl'
import { dataSummary, type CaseRun, type Verdict } from '../../core/testcases'
import { maskDeep } from '../../core/report'
import { humanizeId } from '../../core/format'
import { Json, MethodBadge, StatusBadge, VerdictBadge } from '../components/badges'
import { ActionBar, Chevron, Empty, Metric, PageHeader, Pill, Tabs } from '../components/kit'
import { t } from '../../i18n'
import { copyText } from '../../lib/browser'
import { JsonView, MismatchList } from '../components/Diff'
import { ConnectionHelp } from '../components/ConnectionHelp'

interface Props {
  runs: CaseRun[]
  running: boolean
  onCancel: () => void
  onRerun: () => void
  /** Reintenta todo en simulación (salida rápida cuando la API no responde). */
  onRunSimulated: () => void
  onEditEnvironment: () => void
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

/** Botón que copia un texto y confirma por un momento que se copió. */
function CopyButton({ text, label, title, primary }: { text: () => string; label: string; title?: string; primary?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle')
  return (
    <button
      className={`small ${primary ? '' : 'ghost'}`}
      title={title}
      onClick={async () => {
        setState((await copyText(text())) ? 'ok' : 'err')
        setTimeout(() => setState('idle'), 1600)
      }}
    >
      {state === 'ok' ? `✓ ${t('results.copied')}` : state === 'err' ? t('results.copyFailed') : label}
    </button>
  )
}

/** Copiar como cURL: con los secretos como <secret> y, si están disponibles, con los valores reales. */
function CurlActions({ request }: { request: CurlRequest }) {
  const real = realRequest(request)
  const canReveal = real !== request && hasMaskedValues(request)
  return (
    <div className="curl-actions">
      <CopyButton primary text={() => toCurl(request)} label={t('results.copyCurl')} title={canReveal ? t('results.copyCurlSafeHint') : undefined} />
      {canReveal && <CopyButton text={() => toCurl(real)} label={t('results.copyCurlReal')} title={t('results.copyCurlRealHint')} />}
    </div>
  )
}

function StepCard({ s, index }: { s: StepResult; index: number }) {
  const [open, setOpen] = useState(s.status === 'failed' || s.status === 'warning')
  const [tab, setTab] = useState<StepTab>('resumen')
  const reasonTone = s.reason ? (REASON_CLS[s.reason.category] ?? (s.status === 'skipped' ? 'skip' : 'err')) : ''
  const failedCriteria = s.criteria.filter((c) => !c.passed).length
  const outputs = Object.keys(s.outputs).length
  // Diferencias campo a campo de los criterios que fallaron (para compararlas y resaltarlas en la respuesta).
  const mismatches = s.criteria.filter((c) => !c.passed).flatMap((c) => c.mismatches ?? [])
  const showInResponse = () => {
    setOpen(true)
    setTab('respuesta')
  }

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
        {s.simulated && <span className="badge b-accent">{t('common.simulated')}</span>}
        {s.attempts > 1 && <span className="badge b-info">{t('results.attempt', { n: s.attempts })}</span>}
        {s.response && (
          <span className="http muted small">
            <strong className={s.response.status < 400 ? 'ok' : 'err'}>{s.response.status}</strong> · {s.response.durationMs} ms
          </span>
        )}
        {s.status !== 'skipped' && <Chevron open={open} />}
      </button>

      {(s.reason || s.action || s.actionName) && (
        <div className="step-notes">
          {s.reason &&
            (s.reason.category === 'criterio' && mismatches.length ? (
              <div className={`note n-${reasonTone} note-diff`}>
                <strong>{reasonLabel(s.reason.category)}</strong>
                <MismatchList mismatches={mismatches} onShow={s.response ? showInResponse : undefined} />
              </div>
            ) : (
              <div className={`note n-${reasonTone}`}>
                <strong>{reasonLabel(s.reason.category)}:</strong> {s.reason.message}
              </div>
            ))}
          {(s.action || s.actionName) && <div className="note n-action">↪ {s.action ?? t('report.action', { action: s.actionName, type: s.actionType })}</div>}
        </div>
      )}

      {open && s.status !== 'skipped' && (
        <div className="step-detail">
          <Tabs<StepTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'resumen', label: t('report.criteria'), count: s.criteria.length, tone: failedCriteria ? 'err' : 'ok' },
              { id: 'peticion', label: t('report.request') },
              { id: 'respuesta', label: t('report.response') },
              { id: 'contrato', label: t('report.contract'), count: s.response ? s.contractIssues.length : undefined, tone: s.contractIssues.length ? 'warn' : 'ok' },
              { id: 'outputs', label: 'Outputs', count: outputs },
            ]}
          />
          <div className="tab-body">
            {tab === 'resumen' &&
              (s.criteria.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>{t('report.condition')}</th>
                      <th>{t('report.result')}</th>
                      <th>{t('report.detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.criteria.map((c, i) => (
                      <tr key={i}>
                        <td>
                          <code>{c.context ? `${c.context} ~ ${c.condition}` : c.condition}</code>
                          {c.type !== 'simple' && <span className="muted small"> ({c.type})</span>}
                        </td>
                        <td>{c.passed ? <span className="badge b-ok">✓ {t('crit.badge.passed')}</span> : <span className="badge b-err">✕ {t('crit.badge.failed')}</span>}</td>
                        <td>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>{t('results.noCriteria')}</Empty>
              ))}
            {tab === 'peticion' &&
              (s.request ? (
                <>
                  <CurlActions request={s.request} />
                  <div className="io">
                    <div>
                      <h4>{t('results.lineHeaders')}</h4>
                      <pre>{`${s.request.method} ${s.request.url}\n${headersText(s.request.headers)}`}</pre>
                    </div>
                    <div>
                      <h4>Body</h4>
                      <Json value={s.request.body} />
                    </div>
                  </div>
                </>
              ) : (
                <Empty>{t('results.noRequest')}</Empty>
              ))}
            {tab === 'respuesta' &&
              (s.response ? (
                <div className="io">
                  <div>
                    <h4>{t('results.statusHeaders')}</h4>
                    <pre>{`HTTP ${s.response.status} ${s.response.statusText}\n${headersText(s.response.headers)}`}</pre>
                  </div>
                  <div>
                    <h4>Body</h4>
                    <JsonView value={s.response.body} highlight={mismatches.map((m) => m.pointer ?? '')} />
                  </div>
                </div>
              ) : (
                <Empty>{t('report.noResponse')}</Empty>
              ))}
            {tab === 'contrato' &&
              (!s.response ? (
                <Empty>{t('results.nothingToValidate')}</Empty>
              ) : s.contractIssues.length === 0 ? (
                <span className="badge b-ok">✓ {t('report.contractOk')}</span>
              ) : (
                <ul className="issues">
                  {s.contractIssues.map((c, i) => (
                    <li key={i}>
                      <span className="badge b-warn">{t('report.contract')}</span> <span>{c}</span>
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
                            <span className="badge b-skip">{t('results.notInResponse')}</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <Empty>{t('results.noOutputs')}</Empty>
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

export function ResultsScreen({ runs, running, onCancel, onRerun, onRunSimulated, onEditEnvironment, onExport, onBack }: Props) {
  // Pasos que no llegaron a la API (servidor caído, URL errónea o CORS).
  const unreachable = runs.flatMap((r) => r.steps.filter((s) => s.reason?.code === 'network' && s.request).map((s) => s.request!))
  const unreachableCases = runs.filter((r) => r.steps.some((s) => s.reason?.code === 'network')).length
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
        <PageHeader step={5} title={t('nav.results')} />
        <Empty>{t('results.none')}</Empty>
        <ActionBar left={<button onClick={onBack}>{t('results.back')}</button>} />
      </>
    )
  }

  return (
    <>
      <PageHeader
        step={5}
        title={t('nav.results')}
        description={t(running ? 'results.progressRunning' : 'results.progress', { done: done.length, total: runs.length })}
        actions={
          running ? (
            <button onClick={onCancel}>{t('common.cancel')}</button>
          ) : (
            <div className="row">
              <button onClick={onRerun}>{t('results.rerun')}</button>
              <button onClick={() => onExport('json')}>JSON</button>
              <button className="primary" onClick={() => onExport('html')}>
                {t('results.download')}
              </button>
            </div>
          )
        }
      />

      <div className="metrics">
        <Metric label={t('report.passed')} value={count('passed')} tone="ok" />
        <Metric label={t('report.failed')} value={count('failed')} tone={count('failed') ? 'err' : undefined} />
        <Metric label={t('report.inconclusive')} value={count('inconclusive')} tone={count('inconclusive') ? 'warn' : undefined} />
        <Metric label={t('results.pending')} value={runs.length - done.length} />
      </div>
      {running && (
        <div className="progress">
          <div style={{ width: `${(done.length / runs.length) * 100}%` }} />
        </div>
      )}

      <ConnectionHelp requests={unreachable} caseCount={unreachableCases} onSimulate={onRunSimulated} onEditEnvironment={onEditEnvironment} />

      <div className="results-layout">
        <aside className="case-nav">
          <div className="filters">
            <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
              <span className="grow">{t('cases.all')}</span> <span className="count">{runs.length}</span>
            </Pill>
            {(['failed', 'inconclusive', 'passed'] as const).map((v) => (
              <Pill key={v} active={filter === v} onClick={() => setFilter(v)}>
                <span className={`status-dot sd-${v}`} aria-hidden="true" />
                <span className="grow">{t(`results.filter.${v}`)}</span> <span className="count">{count(v)}</span>
              </Pill>
            ))}
          </div>
          {groups.length === 0 && <Empty>{t('results.noMatches')}</Empty>}
          {groups.map(([wf, list]) => (
            <div className="case-nav-group" key={wf}>
              <button className="case-nav-head" onClick={() => setCollapsed({ ...collapsed, [wf]: !collapsed[wf] })}>
                <Chevron open={!collapsed[wf]} />
                <span className="grow" title={wf}>
                  {humanizeId(wf)}
                </span>
                <span className="muted small">{list.length}</span>
              </button>
              {!collapsed[wf] &&
                list.map((r) => (
                  <button key={r.tc.id} title={r.tc.title} className={`case-nav-item ${r === current ? 'active' : ''}`} onClick={() => select(r.tc.id)}>
                    <span className={`status-dot sd-${r.state === 'done' ? r.verdict : r.state}`} />
                    <span className="grow clamp-2">{r.tc.title}</span>
                    {r.steps.some((s) => s.simulated) && <span className="badge b-accent tiny">{t('results.simShort')}</span>}
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
                  <span className="badge b-skip">{current.state === 'running' ? `⋯ ${t('results.runningState')}` : t('results.pendingState')}</span>
                )}
              </div>
              <div className="kv">
                <span>{t('report.expected')}</span>
                <span>{current.tc.expectation.text}</span>
                {current.explanation && (
                  <>
                    <span>{t('report.result')}</span>
                    <span>{current.explanation}</span>
                  </>
                )}
                <span>{t('report.params')}</span>
                <span>
                  <code>{dataSummary(current.tc)}</code>
                  {current.inputsUsed && (
                    <details className="inputs-used">
                      <summary>{t('results.sentValues', { n: Object.keys(current.inputsUsed).length })}</summary>
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
              {current.steps.length === 0 && <Empty>{current.state === 'pending' ? t('results.pendingRun') : current.state === 'running' ? t('cases.running') : t('report.noSteps')}</Empty>}
              {current.steps.map((s, i) => (
                <StepCard key={`${current.tc.id}-${i}`} s={s} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>

      <ActionBar left={<button onClick={onBack}>{t('results.back')}</button>} />
    </>
  )
}
