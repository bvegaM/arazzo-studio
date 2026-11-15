import { humanizeId } from '../../core/format'
import type { Prelude } from '../../app/useStudio'
import { useState } from 'react'
import { realRequest, reasonLabel, type StepResult } from '../../core/runner'
import { hasMaskedValues, toCurl, type CurlRequest } from '../../core/curl'
import { dataSummary, type CaseRun, type Verdict } from '../../core/testcases'
import { maskDeep } from '../../core/report'
import { Json, MethodBadge, StatusBadge, VerdictBadge } from '../components/badges'
import { Chevron, Empty, Icon, Pill, Tabs } from '../components/kit'
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
  /** Workflows de dependsOn ejecutados antes de los casos. */
  prelude?: Prelude
}

type Filter = 'all' | Verdict

const RERUN_ICON = 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5'
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

/** Progreso de la ejecución: caso actual, barra por resultado y tiempo restante estimado. */
function RunProgress({ runs, onCancel }: { runs: CaseRun[]; onCancel: () => void }) {
  const done = runs.filter((r) => r.state === 'done')
  const current = runs.find((r) => r.state === 'running')
  const position = done.length + (current ? 1 : 0)
  const share = (n: number) => `${(n / runs.length) * 100}%`
  const by = (v: Verdict) => done.filter((r) => r.verdict === v).length
  const avgMs = done.length ? done.reduce((n, r) => n + (r.result?.durationMs ?? 0), 0) / done.length : 0
  const leftSec = Math.round((avgMs * (runs.length - done.length)) / 1000)
  return (
    <div className="run-progress" role="status" aria-live="polite">
      <div className="run-progress-head">
        <span className="spinner" aria-hidden="true" />
        <div className="grow">
          <strong>{t('results.runningCase', { n: position, total: runs.length })}</strong>
          {current && <span className="run-progress-case">{current.tc.title}</span>}
        </div>
        {done.length > 0 && leftSec > 0 && <span className="muted small">{t('results.eta', { s: leftSec })}</span>}
        <button onClick={onCancel}>{t('common.cancel')}</button>
      </div>
      <div className="run-bar" aria-hidden="true">
        <span className="rb-passed" style={{ width: share(by('passed')) }} />
        <span className="rb-failed" style={{ width: share(by('failed')) }} />
        <span className="rb-inconclusive" style={{ width: share(by('inconclusive')) }} />
        {current && <span className="rb-running" style={{ width: share(1) }} />}
      </div>
    </div>
  )
}

export function StepCard({ s, index, defaultOpen }: { s: StepResult; index: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? (s.status === 'failed' || s.status === 'warning'))
  const [tab, setTab] = useState<StepTab>('resumen')
  // Mensajería es un aviso (paso simulado) salvo que el paso haya fallado (no llegó el mensaje).
  const reasonTone = !s.reason
    ? ''
    : s.reason.category === 'mensajeria' && s.status !== 'failed'
      ? 'warn'
      : (REASON_CLS[s.reason.category] ?? (s.status === 'skipped' ? 'skip' : 'err'))
  const failedCriteria = s.criteria.filter((c) => !c.passed).length
  const outputs = Object.keys(s.outputs).length
  // Diferencias campo a campo de los criterios que fallaron (para compararlas y resaltarlas en la respuesta).
  const mismatches = s.criteria.filter((c) => !c.passed).flatMap((c) => c.mismatches ?? [])
  // Pasos AsyncAPI: no hay petición HTTP; lo que se recibe es un mensaje.
  const received = s.message?.action === 'receive' ? s.message : undefined
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
        {s.simulated && <span className="badge b-sim">{t('common.simulated')}</span>}
        {s.attempts > 1 && <span className="badge b-info">{t('results.attempt', { n: s.attempts })}</span>}
        {s.response && (
          <span className="http muted small">
            <strong className={s.response.status < 400 ? 'ok' : 'err'}>{s.response.status}</strong> · {s.response.durationMs} ms
          </span>
        )}
        {s.message && (
          <span className="http muted small">
            <strong className="ok">{t(s.message.action === 'send' ? 'results.msgSent' : 'results.msgReceived')}</strong>
          </span>
        )}
        {!s.message && s.request?.method === 'RECEIVE' && (
          <span className="http muted small">
            <strong className="err">{t('results.msgNone')}</strong>
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
                <MismatchList mismatches={mismatches} onShow={s.response || received ? showInResponse : undefined} />
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
              { id: 'respuesta', label: received || s.message ? t('results.message') : t('report.response') },
              { id: 'contrato', label: t('report.contract'), count: s.response || received ? s.contractIssues.length : undefined, tone: s.contractIssues.length ? 'warn' : 'ok' },
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
                  {!s.message && <CurlActions request={s.request} />}
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
              ) : received ? (
                <div className="io">
                  <div>
                    <h4>{t('results.messageHeaders')}</h4>
                    <pre>{`${s.message!.channel}\n${headersText(received.headers)}`}</pre>
                  </div>
                  <div>
                    <h4>Payload</h4>
                    <JsonView value={received.payload} highlight={mismatches.map((m) => m.pointer ?? '')} />
                  </div>
                </div>
              ) : (
                <Empty>{t(s.message ? 'results.sentOnly' : 'report.noResponse')}</Empty>
              ))}
            {tab === 'contrato' &&
              (!s.response && !received ? (
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

/** Panel derecho: resultado de la última ejecución del journey activo. */
/** "Preparación": los workflows de dependsOn que corrieron antes de los casos, con sus pasos. */
function PreludeView({ prelude }: { prelude: Prelude }) {
  const [open, setOpen] = useState<string>()
  const failed = !!prelude.error
  return (
    <div className={`prelude ${failed ? 'failed' : ''}`}>
      <div className="prelude-head">
        <strong>{t('prelude.title')}</strong>
        <span className="muted small">dependsOn</span>
        <span className="spacer" />
        {prelude.state === 'running' && <span className="muted small">{t('prelude.running', { workflows: (prelude.order ?? []).join(' → ') })}</span>}
      </div>
      {prelude.runs.map((r) => (
        <div key={r.workflowId} className="prelude-run">
          <button className="prelude-row" onClick={() => setOpen(open === r.workflowId ? undefined : r.workflowId)} aria-expanded={open === r.workflowId}>
            <span className={`status-dot ${r.result.status === 'success' ? 'sd-passed' : 'sd-failed'}`} />
            <strong className="grow clamp-1">{humanizeId(r.workflowId)}</strong>
            <span className="muted small">
              {t('prelude.steps', { n: r.result.steps.length })} · {Math.round(r.result.durationMs)} ms
            </span>
          </button>
          {open === r.workflowId && r.result.steps.map((s, i) => <StepCard key={`${s.stepId}-${i}`} s={s} index={i} />)}
        </div>
      ))}
      {prelude.error && <p className="err small prelude-error">{prelude.error}</p>}
    </div>
  )
}

export function ResultsPanel({ runs, running, onCancel, onRerun, onRunSimulated, onEditEnvironment, onExport, prelude }: Props) {
  // Pasos que no llegaron a la API (servidor caído, URL errónea o CORS).
  const unreachable = runs.flatMap((r) => r.steps.filter((s) => s.reason?.code === 'network' && s.request).map((s) => s.request!))
  const unreachableCases = runs.filter((r) => r.steps.some((s) => s.reason?.code === 'network')).length
  const [selectedId, setSelectedId] = useState<string>()
  // Mientras corre, el detalle sigue al caso en ejecución hasta que el usuario elige otro.
  const [userPicked, setUserPicked] = useState(false)
  const [wasRunning, setWasRunning] = useState(running)
  if (running !== wasRunning) {
    // Al empezar otra ejecución se vuelve a seguir el caso en curso.
    setWasRunning(running)
    if (running) setUserPicked(false)
  }
  const [filter, setFilter] = useState<Filter>('all')
  const select = (id: string) => {
    setSelectedId(id)
    setUserPicked(true)
  }
  const done = runs.filter((r) => r.state === 'done')
  const count = (v: Verdict) => done.filter((r) => r.verdict === v).length
  const visible = runs.filter((r) => filter === 'all' || r.verdict === filter)
  const runningCase = running && !userPicked ? runs.find((r) => r.state === 'running') : undefined
  const current = runningCase ?? runs.find((r) => r.tc.id === selectedId) ?? visible[0] ?? runs[0]

  if (!runs.length) {
    return (
      <div className="results-panel">
        <div className="rp-head">
          <h3>{t('ws.results.title')}</h3>
        </div>
        <div className="rp-empty">
          <span className="rp-empty-icon" aria-hidden="true">
            ▶
          </span>
          <strong>{t('ws.results.emptyTitle')}</strong>
          <span className="muted">{t('ws.results.emptyText')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="results-panel">
      <div className="rp-head">
        <h3>{t('ws.results.title')}</h3>
        <span className="rp-count ok" title={t('report.passed')}>
          ✓ {count('passed')}
        </span>
        {count('failed') > 0 && (
          <span className="rp-count err" title={t('report.failed')}>
            ✕ {count('failed')}
          </span>
        )}
        {count('inconclusive') > 0 && (
          <span className="rp-count warn" title={t('report.inconclusive')}>
            ? {count('inconclusive')}
          </span>
        )}
        <span className="muted small">{t(running ? 'results.progressRunning' : 'results.progress', { done: done.length, total: runs.length })}</span>
        <span className="spacer" />
        {!running && (
          <>
            <button className="small icon" onClick={onRerun} title={t('results.rerun')} aria-label={t('results.rerun')}>
              <Icon d={RERUN_ICON} size={14} />
            </button>
            <button className="small" onClick={() => onExport('json')} title={t('ws.results.exportJson')}>
              JSON
            </button>
            <button className="small" onClick={() => onExport('html')} title={t('ws.results.exportHtml')}>
              {t('ws.results.report')}
            </button>
          </>
        )}
      </div>
      {running && <RunProgress runs={runs} onCancel={onCancel} />}

      <ConnectionHelp requests={unreachable} caseCount={unreachableCases} onSimulate={onRunSimulated} onEditEnvironment={onEditEnvironment} />
      {prelude && <PreludeView prelude={prelude} />}

      <div className="rp-cases">
        {runs.length > 3 && (
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
        )}
        {visible.length === 0 && <Empty>{t('results.noMatches')}</Empty>}
        {visible.map((r) => (
          <button key={r.tc.id} title={r.tc.title} className={`case-nav-item ${r === current ? 'active' : ''}`} onClick={() => select(r.tc.id)}>
            <span className={`status-dot sd-${r.state === 'done' ? r.verdict : r.state}`} />
            <span className="grow clamp-2">{r.tc.title}</span>
            {r.steps.some((s) => s.simulated) && <span className="badge b-sim tiny">{t('results.simShort')}</span>}
          </button>
        ))}
      </div>

      {current && (
        <div className="case-detail">
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
  )
}
