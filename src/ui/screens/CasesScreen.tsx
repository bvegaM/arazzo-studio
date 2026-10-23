/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import type { ProjectAnalysis, WorkflowAnalysis } from '../../core/analyze'
import { createDataCase, dataSummary, isSimulated, runnability, type RunMode, type TestCase } from '../../core/testcases'
import type { ScenariosImport } from '../../core/scenariosFile'
import { templateHelp } from '../../core/templates'
import { statusesInCriteria } from '../../core/criteria'
import { humanizeId } from '../../core/format'
import { fieldKind, typeLabel, valueSummary } from '../../core/schemaForm'
import { MethodBadge } from '../components/badges'
import { ActionBar, Chevron, PageHeader, Section, Segmented } from '../components/kit'
import { ObjectFields, SchemaField } from '../components/SchemaField'
import { t } from '../../i18n'
import { tn } from '../../i18n/react'

interface Props {
  analysis: ProjectAnalysis
  cases: TestCase[]
  toggle: (id: string, enabled: boolean) => void
  setMany: (ids: string[], enabled: boolean) => void
  updateCase: (id: string, patch: Partial<TestCase>) => void
  addCase: (tc: TestCase) => void
  removeCase: (id: string) => void
  onExportScenarios: () => void
  onImportScenarios: (file: File) => Promise<ScenariosImport>
  inputs: Record<string, Record<string, any>>
  servers: Record<string, string>
  /** Nombre del ambiente activo, para dejar claro contra qué se corre. */
  envName: string
  mode: RunMode
  setMode: (m: RunMode) => void
  confirmed: boolean
  setConfirmed: (v: boolean) => void
  running: boolean
  onRun: () => void
  onBack: () => void
}

type Ctx = Pick<Props, 'toggle' | 'setMany' | 'updateCase' | 'removeCase' | 'mode'> & {
  wa: WorkflowAnalysis
  base: Record<string, any>
}

function TriCheckbox({ list, setMany }: { list: TestCase[]; setMany: Props['setMany'] }) {
  const ref = useRef<HTMLInputElement>(null)
  const on = list.filter((c) => c.enabled).length
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = on > 0 && on < list.length
  }, [on, list.length])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="check"
      checked={on === list.length && list.length > 0}
      onChange={(e) => setMany(list.map((c) => c.id), e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      title={t('cases.selectAll')}
    />
  )
}

function parseValue(raw: string, schema: any): any {
  if (raw === '') return undefined
  if (raw.includes('{{')) return raw
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
  if ((type === 'number' || type === 'integer') && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw)
  if (type === 'boolean' && (raw === 'true' || raw === 'false')) return raw === 'true'
  if ((type === 'object' || type === 'array') && /^[[{]/.test(raw.trim())) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

const show = (v: any) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)

type ParamsPatch = Pick<TestCase, 'inputOverrides' | 'omitInputs'>

/**
 * Parámetros del caso: cada input empieza con su valor por defecto (paso 3)
 * y aquí se puede cambiar u omitir solo para este caso.
 */
function CaseParams({ wa, base, tc, onChange }: { wa: WorkflowAnalysis; base: Record<string, any>; tc: Pick<TestCase, 'inputOverrides' | 'omitInputs' | 'omitInput' | 'setInput'>; onChange: (p: ParamsPatch) => void }) {
  const props = Object.entries<any>(wa.inputsSchema.properties ?? {})
  const overrides = tc.inputOverrides ?? {}
  const omitted = tc.omitInputs ?? []
  const [expanded, setExpanded] = useState<string>()
  const changedCount = Object.values(overrides).filter((v) => v !== undefined && v !== '').length + omitted.length
  const setOverride = (name: string, value: any) => {
    const next = { ...overrides }
    if (value === undefined || same(value, base[name])) delete next[name]
    else next[name] = value
    onChange({ inputOverrides: next, omitInputs: omitted })
  }
  const toggleOmit = (name: string) => {
    const next = omitted.includes(name) ? omitted.filter((n) => n !== name) : [...omitted, name]
    onChange({ inputOverrides: overrides, omitInputs: next.length ? next : undefined })
  }
  const reset = (name: string) => {
    const next = { ...overrides }
    delete next[name]
    const nextOmit = omitted.filter((n) => n !== name)
    onChange({ inputOverrides: next, omitInputs: nextOmit.length ? nextOmit : undefined })
  }

  return (
    <div className="case-params">
      <div className="case-params-head">
        <strong>{t('cases.params.title')}</strong>
        <span className="muted small grow">
          {t('cases.params.hint')}
        </span>
        {changedCount > 0 && (
          <button className="link small" onClick={() => onChange({ inputOverrides: {}, omitInputs: undefined })}>
            {t('cases.params.resetAll', { n: changedCount })}
          </button>
        )}
      </div>
      <div className="param-rows">
        {props.map(([name, schema]) => {
          const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
          const lockedOmit = tc.omitInput === name
          const lockedSet = tc.setInput?.name === name
          const isOmitted = omitted.includes(name)
          const hasOverride = overrides[name] !== undefined && overrides[name] !== ''
          const value = lockedSet ? tc.setInput!.value : hasOverride ? overrides[name] : base[name]
          const state = lockedOmit || lockedSet ? 'locked' : isOmitted ? 'omitted' : hasOverride ? 'changed' : 'default'
          const listId = schema?.enum ? `enum-${wa.workflow.workflowId}-${name}` : undefined
          const disabled = state === 'locked' || state === 'omitted'
          const structured = ['object', 'array'].includes(fieldKind(schema))
          const open = structured && expanded === name && !disabled
          return (
            <div className={`param-item ps-${state} ${open ? 'open' : ''}`} key={name}>
              <div className="param-row">
                <div className="param-name">
                  <code>{name}</code>
                  {wa.requiredInputs.includes(name) && <span className="req"> *</span>}
                  <div className="muted tiny-text" title={type}>{typeLabel(schema)}</div>
                </div>
                <div className="param-value">
                  {lockedOmit || isOmitted ? (
                    <div className="omitted-value">{t('cases.params.notSent')}</div>
                  ) : structured ? (
                    <div className="param-struct">
                      <span className="param-struct-summary" title={show(value)}>
                        {valueSummary(value) || <span className="muted">{t('cases.params.noDefault')}</span>}
                      </span>
                      {!disabled && (
                        <button className="small" aria-expanded={open} onClick={() => setExpanded(open ? undefined : name)}>
                          {open ? t('cases.params.closeFields') : t('cases.params.editFields')}
                        </button>
                      )}
                    </div>
                  ) : type === 'boolean' && !lockedSet ? (
                    <select value={value === undefined ? '' : String(value)} onChange={(e) => setOverride(name, e.target.value === '' ? undefined : e.target.value === 'true')}>
                      <option value="">{t('params.noValue')}</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      list={listId}
                      value={show(value)}
                      disabled={disabled}
                      placeholder={t('cases.params.noDefault')}
                      onChange={(e) => setOverride(name, parseValue(e.target.value, schema))}
                    />
                  )}
                  {listId && (
                    <datalist id={listId}>
                      {schema.enum.map((v: any) => (
                        <option key={String(v)} value={String(v)} />
                      ))}
                    </datalist>
                  )}
                  {state === 'changed' && base[name] !== undefined && (
                    <div className="muted tiny-text">
                      {tn('cases.params.defaultIs', { value: <code>{structured ? valueSummary(base[name]) : show(base[name])}</code> })}
                    </div>
                  )}
                </div>
                <div className="param-state">
                  {state === 'default' && <span className="badge b-skip">{t('cases.params.state.default')}</span>}
                  {state === 'changed' && <span className="badge b-warn">{t('cases.params.state.changed')}</span>}
                  {state === 'omitted' && <span className="badge b-err">{t('cases.params.state.omitted')}</span>}
                  {state === 'locked' && <span className="badge b-info" title={t('cases.params.state.lockedTitle')}>{t('cases.params.state.locked')}</span>}
                </div>
                <div className="param-actions">
                  {state !== 'locked' && (
                    <>
                      {(state === 'changed' || state === 'omitted') && (
                        <button className="link small" onClick={() => reset(name)}>
                          {t('cases.params.reset')}
                        </button>
                      )}
                      {state !== 'omitted' && (
                        <button className="link small muted-link" onClick={() => toggleOmit(name)}>
                          {t('cases.params.omit')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {open && (
                <div className="param-tree">
                  {fieldKind(schema) === 'object' ? (
                    <ObjectFields schema={schema} value={value} onChange={(v) => setOverride(name, v)} />
                  ) : (
                    <SchemaField name={name} schema={schema} required={wa.requiredInputs.includes(name)} value={value} onChange={(v) => setOverride(name, v)} depth={1} />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="muted small template-help">
        {t('cases.params.generators')}{' '}
        {templateHelp().map((g) => (
          <span key={g.token} title={g.description}>
            <code>{g.token}</code>{' '}
          </span>
        ))}
      </div>
    </div>
  )
}

function CaseRow({ c, ctx }: { c: TestCase; ctx: Ctx }) {
  const [editing, setEditing] = useState(false)
  const run = runnability(c, ctx.mode)
  const simulated = isSimulated(c, ctx.mode)
  const custom = Object.values(c.inputOverrides ?? {}).filter((v) => v !== undefined && v !== '').length + (c.omitInputs?.length ?? 0)
  return (
    <div className={`case-row ${run.ok ? '' : 'blocked'}`}>
      <input type="checkbox" className="check" checked={c.enabled} onChange={(e) => ctx.toggle(c.id, e.target.checked)} />
      <div className="body">
        <div className="row">
          <strong>{c.title}</strong>
          {c.expectation.type === 'success' && <span className="badge b-ok">{t('cases.expectSuccess')}</span>}
          {c.expectation.type === 'failure' && <span className="badge b-err">{t('cases.expectFailure')}</span>}
          <span className={`badge ${simulated ? 'b-sim' : 'b-info'}`}>{simulated ? t('common.simulated') : t('common.realApi')}</span>
          {custom > 0 && <span className="badge b-warn">{t('cases.changedParams', { n: custom })}</span>}
          <span className="spacer" />
          {c.scenario && (
            <Segmented
              options={[
                { id: 'simulado', label: t('common.simulated') },
                { id: 'real', label: t('common.realApi') },
              ]}
              value={c.dataMode ?? 'simulado'}
              onChange={(m) => {
                ctx.updateCase(c.id, { dataMode: m })
                if (m === 'real' && !custom) setEditing(true)
              }}
            />
          )}
          <button className="small" onClick={() => setEditing(!editing)}>
            {editing ? t('cases.closeParams') : t('report.params')}
          </button>
          {c.origin === 'datos' && (
            <button className="small danger" onClick={() => ctx.removeCase(c.id)} title={t('cases.deleteTitle')}>
              {t('cases.delete')}
            </button>
          )}
        </div>
        <div className="muted small">{c.expectation.text}</div>
        <div className="small data-line">
          <span className="muted">{t('report.params')}:</span> <code>{dataSummary(c)}</code>
        </div>
        {!run.ok && <div className="small blocked-reason">⚠ {t('cases.wontRun', { reason: run.reason })}</div>}
        {editing && <CaseParams wa={ctx.wa} base={ctx.base} tc={c} onChange={(patch) => ctx.updateCase(c.id, patch)} />}
      </div>
    </div>
  )
}

function CaseGroup({ title, hint, list, defaultOpen, ctx, extra }: { title: string; hint: string; list: TestCase[]; defaultOpen: boolean; ctx: Ctx; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const ready = list.filter((c) => c.enabled && runnability(c, ctx.mode).ok).length
  const blocked = list.filter((c) => c.enabled && !runnability(c, ctx.mode).ok).length
  if (!list.length && !extra) return null
  return (
    <div className={`case-group ${open ? 'open' : ''}`}>
      <div className="case-group-head" onClick={() => setOpen(!open)}>
        {list.length > 0 && <TriCheckbox list={list} setMany={ctx.setMany} />}
        <Chevron open={open} />
        <strong>{title}</strong>
        <span className="badge b-skip">
          {t('cases.readyOf', { ready, total: list.length })}
        </span>
        {blocked > 0 && <span className="badge b-warn">{t('cases.blocked', { n: blocked })}</span>}
        <span className="muted small grow">{hint}</span>
      </div>
      {open && (
        <div className="case-rows">
          {list.map((c) => (
            <CaseRow key={c.id} c={c} ctx={ctx} />
          ))}
          {extra}
        </div>
      )}
    </div>
  )
}

function NewCaseForm({ wa, base, onAdd, onCancel }: { wa: WorkflowAnalysis; base: Record<string, any>; onAdd: (tc: TestCase) => void; onCancel: () => void }) {
  const opSteps = wa.steps.filter((s) => s.op)
  const [title, setTitle] = useState('')
  const [stepId, setStepId] = useState(opSteps[opSteps.length - 1]?.step.stepId ?? '')
  const [statuses, setStatuses] = useState('')
  const [code, setCode] = useState('')
  const [actionName, setActionName] = useState('')
  const [params, setParams] = useState<ParamsPatch>({ inputOverrides: {} })
  const rs = wa.steps.find((s) => s.step.stepId === stepId)
  const actions = [...(rs?.step.onSuccess ?? []), ...(rs?.step.onFailure ?? [])].filter((a) => a.name)
  const documented = Object.keys(rs?.op?.operation?.responses ?? {})

  const pickAction = (name: string) => {
    setActionName(name)
    const a = actions.find((x) => x.name === name)
    if (a && !statuses) setStatuses(statusesInCriteria(a.criteria).join(', '))
    const codeCond = a?.criteria?.map((c) => c.condition.match(/\$response\.body#\/code\s*==\s*'([^']+)'/)?.[1]).find(Boolean)
    if (codeCond && !code) setCode(codeCond)
    if (a && !title) setTitle(`${stepId} → ${name}`)
  }

  const parsedStatuses = statuses
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => n >= 100 && n < 600)
  const valid = title.trim() && stepId && (parsedStatuses.length || code || actionName)

  return (
    <div className="new-case">
      <div className="field-grid">
        <div className="field">
          <label>
            <span>{t('cases.new.name')}</span>
          </label>
          <input value={title} placeholder={t('cases.new.namePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>
            <span>{t('cases.new.step')}</span>
          </label>
          <select value={stepId} onChange={(e) => setStepId(e.target.value)}>
            {opSteps.map((s) => (
              <option key={s.step.stepId} value={s.step.stepId}>
                {s.step.stepId} · {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>
            <span>{t('cases.new.action')}</span>
          </label>
          <select value={actionName} onChange={(e) => pickAction(e.target.value)}>
            <option value="">{t('cases.new.none')}</option>
            {actions.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>
            <span>{t('cases.new.status')}</span>
            <span className="type">{t('cases.new.documented', { statuses: documented.join(', ') || '—' })}</span>
          </label>
          <input value={statuses} placeholder={t('cases.new.statusPlaceholder')} onChange={(e) => setStatuses(e.target.value)} />
        </div>
        <div className="field">
          <label>
            <span>{t('cases.new.code')}</span>
          </label>
          <input value={code} placeholder={t('cases.new.codePlaceholder')} onChange={(e) => setCode(e.target.value)} />
        </div>
      </div>
      <div className="sub-head" style={{ marginTop: 14 }}>
        {t('cases.new.params')}
      </div>
      <CaseParams wa={wa} base={base} tc={params} onChange={setParams} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={onCancel}>{t('common.cancel')}</button>
        <button
          className="primary"
          disabled={!valid}
          onClick={() =>
            onAdd({
              ...createDataCase({
                workflowId: wa.workflow.workflowId,
                title: title.trim(),
                inputOverrides: params.inputOverrides ?? {},
                stepId,
                statuses: parsedStatuses,
                code: code.trim() || undefined,
                actionName: actionName || undefined,
              }),
              omitInputs: params.omitInputs,
            })
          }
        >
          {t('cases.new.add')}
        </button>
      </div>
    </div>
  )
}

function WorkflowCases({ wa, list, p }: { wa: WorkflowAnalysis; list: TestCase[]; p: Props }) {
  const [adding, setAdding] = useState(false)
  const base = p.inputs[wa.workflow.workflowId] ?? {}
  const ctx: Ctx = { ...p, wa, base }
  const general = list.filter((c) => !c.scenario && c.origin !== 'datos')
  const scenarios = list.filter((c) => c.scenario)
  const own = list.filter((c) => c.origin === 'datos')
  return (
    <div className="case-groups">
      <CaseGroup title={t('tc.happy.title')} hint={t('cases.group.happyHint')} list={general.filter((c) => c.origin === 'arazzo')} defaultOpen ctx={ctx} />
      <CaseGroup
        title={t('cases.group.own')}
        hint={t('cases.group.ownHint')}
        list={own}
        defaultOpen
        ctx={ctx}
        extra={
          adding ? (
            <NewCaseForm
              wa={wa}
              base={base}
              onCancel={() => setAdding(false)}
              onAdd={(tc) => {
                p.addCase(tc)
                setAdding(false)
              }}
            />
          ) : (
            <button className="add-case" onClick={() => setAdding(true)}>
              {t('cases.new.button')}
            </button>
          )
        }
      />
      <CaseGroup title={t('cases.group.data')} hint={t('cases.group.dataHint')} list={general.filter((c) => c.origin === 'schema')} defaultOpen={false} ctx={ctx} />
      <CaseGroup title={t('cases.group.security')} hint={t('cases.group.securityHint')} list={general.filter((c) => c.origin === 'security')} defaultOpen={false} ctx={ctx} />
      <CaseGroup
        title={t('cases.group.scenarios')}
        hint={t('cases.group.scenariosHint')}
        list={scenarios}
        defaultOpen={false}
        ctx={ctx}
      />
    </div>
  )
}

export function CasesScreen(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<ScenariosImport>()
  const enabled = p.cases.filter((c) => c.enabled)
  const ready = enabled.filter((c) => runnability(c, p.mode).ok)
  const blocked = enabled.length - ready.length
  const realWfs = new Set(ready.filter((c) => !isSimulated(c, p.mode)).map((c) => c.workflowId))
  const mutating = p.analysis.workflows
    .filter((w) => realWfs.has(w.workflow.workflowId))
    .flatMap((w) => w.steps.filter((s) => s.mutating && s.op).map((s) => ({ wf: w.workflow.workflowId, s })))
  const needsConfirm = mutating.length > 0 && !p.confirmed
  const canRun = ready.length > 0 && !needsConfirm && !p.running
  const confirmRef = useRef<HTMLDivElement>(null)
  // Lleva a la confirmación y la resalta un momento, para que se vea qué falta.
  const goToConfirm = () => {
    const box = confirmRef.current
    if (!box) return
    box.scrollIntoView({ behavior: 'smooth', block: 'center' })
    box.querySelector('input')?.focus({ preventScroll: true })
    box.classList.remove('pulse')
    void box.offsetWidth
    box.classList.add('pulse')
  }
  const simulatedCount = ready.filter((c) => isSimulated(c, p.mode)).length

  return (
    <>
      <PageHeader
        step={4}
        title={t('cases.title')}
        description={t('cases.description')}
        actions={
          <div className="row">
            <button onClick={() => fileInput.current?.click()}>{t('cases.import')}</button>
            <button onClick={p.onExportScenarios}>{t('cases.export')}</button>
            <input
              ref={fileInput}
              type="file"
              accept=".yaml,.yml,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) setImportResult(await p.onImportScenarios(f))
              }}
            />
          </div>
        }
      />

      {importResult && (
        <div className={`callout ${importResult.errors.length ? 'warn' : 'info'} small`}>
          <div className="row">
            <strong>{t('cases.imported')}</strong> {importResult.summary}
            <span className="spacer" />
            <button className="link" onClick={() => setImportResult(undefined)}>
              {t('common.close')}
            </button>
          </div>
          {importResult.errors.map((e) => (
            <div key={e}>⚠ {e}</div>
          ))}
        </div>
      )}

      <div className="mode-card">
        <div className="mode-row">
          <div>
            <strong>{t('cases.mode.title')}</strong>
            <div className="muted small">{p.mode === 'real' ? t('cases.mode.realHint') : t('cases.mode.simHint')}</div>
          </div>
          <Segmented
            options={[
              { id: 'real', label: t('common.realApi') },
              { id: 'simulado', label: t('cases.mode.simulation') },
            ]}
            value={p.mode}
            onChange={p.setMode}
          />
        </div>
        <div className="cases-overview" aria-label={t('cases.overview')}>
          <span className="co-total">{t('cases.overviewSelected', { n: enabled.length, total: p.cases.length })}</span>
          {ready.length - simulatedCount > 0 && (
            <span className="co-chip co-real">
              <span className="status-dot" aria-hidden="true" />
              {t('cases.overviewReal', { n: ready.length - simulatedCount })}
            </span>
          )}
          {simulatedCount > 0 && (
            <span className="co-chip co-sim">
              <span className="status-dot" aria-hidden="true" />
              {t('cases.overviewSim', { n: simulatedCount })}
            </span>
          )}
          {blocked > 0 && (
            <span className="co-chip co-blocked" title={t('cases.overviewBlockedHint')}>
              <span className="status-dot" aria-hidden="true" />
              {t('cases.overviewBlocked', { n: blocked })}
            </span>
          )}
        </div>
      </div>

      {p.analysis.workflows.map((w, i) => {
        const list = p.cases.filter((c) => c.workflowId === w.workflow.workflowId)
        const wfReady = list.filter((c) => c.enabled && runnability(c, p.mode).ok).length
        return (
          <Section
            key={w.workflow.workflowId}
            title={<span title={w.workflow.workflowId}>{humanizeId(w.workflow.workflowId)}</span>}
            subtitle={w.workflow.summary}
            defaultOpen={i === 0}
            badges={<span className={`badge ${wfReady ? 'b-accent' : 'b-skip'}`}>{t('cases.readyN', { n: wfReady })}</span>}
            actions={
              <>
                <button className="link small" onClick={() => p.setMany(list.map((c) => c.id), true)}>
                  {t('cases.all')}
                </button>
                <button className="link small" onClick={() => p.setMany(list.map((c) => c.id), false)}>
                  {t('cases.none')}
                </button>
              </>
            }
          >
            <WorkflowCases wa={w} list={list} p={p} />
          </Section>
        )
      })}

      {mutating.length > 0 && (
        <div className="callout warn small" ref={confirmRef}>
          <strong>{t('cases.mutatingEnv', { env: p.envName })}</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {mutating.map(({ wf, s }) => (
              <li key={wf + s.step.stepId}>
                <MethodBadge method={s.op!.method} /> <code>{(p.servers[s.op!.sourceName] || t('cases.noServer')) + s.op!.path}</code>{' '}
                <span className="muted">
                  · {wf} / {s.step.stepId}
                </span>
              </li>
            ))}
          </ul>
          <label>
            <input type="checkbox" className="check" checked={p.confirmed} onChange={(e) => p.setConfirmed(e.target.checked)} />
            {t('cases.confirm')}
          </label>
        </div>
      )}

      <ActionBar
        left={<button onClick={p.onBack}>{t('common.back')}</button>}
        info={[
          t('cases.envShort', { env: p.envName }),
          t('cases.readyN', { n: ready.length }) + (simulatedCount ? ` ${t('cases.simulatedN', { n: simulatedCount })}` : ''),
          blocked ? t('cases.selectedBlocked', { n: blocked }) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        right={
          <>
            {!p.running && ready.length === 0 && <span className="block-reason">{t('cases.block.none')}</span>}
            {!p.running && ready.length > 0 && needsConfirm && (
              <span className="block-reason">
                {t('cases.block.confirm')}{' '}
                <button className="link small" onClick={goToConfirm}>
                  {t('cases.block.goConfirm')}
                </button>
              </span>
            )}
            <button className="primary" disabled={!canRun} onClick={p.onRun}>
              {p.running ? t('cases.running') : t('cases.run', { n: ready.length })}
            </button>
          </>
        }
      />
    </>
  )
}
