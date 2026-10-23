/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react'
import type { ProjectAnalysis, WorkflowAnalysis } from '../core/analyze'
import { createDataCase, dataSummary, isSimulated, runnability, type RunMode, type TestCase } from '../core/testcases'
import type { ScenariosImport } from '../core/scenariosFile'
import { TEMPLATE_HELP } from '../core/templates'
import { statusesInCriteria } from '../core/simulator'
import { MethodBadge } from './common'
import { ActionBar, Chevron, PageHeader, Section, Segmented } from './kit'

export type { RunMode }

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
      title="Seleccionar todos"
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
        <strong>Parámetros de este caso</strong>
        <span className="muted small grow">
          Empiezan con los valores por defecto del paso 3. Lo que cambies aquí solo aplica a este caso.
        </span>
        {changedCount > 0 && (
          <button className="link small" onClick={() => onChange({ inputOverrides: {}, omitInputs: undefined })}>
            Restablecer todo ({changedCount})
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
          return (
            <div className={`param-row ps-${state}`} key={name}>
              <div className="param-name">
                <code>{name}</code>
                {wa.requiredInputs.includes(name) && <span className="req"> *</span>}
                <div className="muted tiny-text">{schema?.enum ? 'enum' : (type ?? 'any')}</div>
              </div>
              <div className="param-value">
                {lockedOmit || isOmitted ? (
                  <div className="omitted-value">No se envía en este caso</div>
                ) : type === 'boolean' && !lockedSet ? (
                  <select value={value === undefined ? '' : String(value)} onChange={(e) => setOverride(name, e.target.value === '' ? undefined : e.target.value === 'true')}>
                    <option value="">(sin valor)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    list={listId}
                    value={show(value)}
                    disabled={disabled}
                    placeholder="(sin valor por defecto)"
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
                    Por defecto: <code>{show(base[name])}</code>
                  </div>
                )}
              </div>
              <div className="param-state">
                {state === 'default' && <span className="badge b-skip">Por defecto</span>}
                {state === 'changed' && <span className="badge b-warn">Cambiado</span>}
                {state === 'omitted' && <span className="badge b-err">Omitido</span>}
                {state === 'locked' && <span className="badge b-info" title="Este valor es lo que prueba el caso">Lo define el caso</span>}
              </div>
              <div className="param-actions">
                {state !== 'locked' && (
                  <>
                    {(state === 'changed' || state === 'omitted') && (
                      <button className="link small" onClick={() => reset(name)}>
                        Restablecer
                      </button>
                    )}
                    {state !== 'omitted' && (
                      <button className="link small muted-link" onClick={() => toggleOmit(name)}>
                        Omitir
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="muted small template-help">
        Generadores (un valor nuevo en cada corrida):{' '}
        {TEMPLATE_HELP.map((t) => (
          <span key={t.token} title={t.description}>
            <code>{t.token}</code>{' '}
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
          {c.expectation.type === 'success' && <span className="badge b-ok">Se espera éxito</span>}
          {c.expectation.type === 'failure' && <span className="badge b-err">Se espera rechazo</span>}
          <span className={`badge ${simulated ? 'b-accent' : 'b-info'}`}>{simulated ? 'Simulado' : 'API real'}</span>
          {custom > 0 && <span className="badge b-warn">{custom} parámetro(s) cambiado(s)</span>}
          <span className="spacer" />
          {c.scenario && (
            <Segmented
              options={[
                { id: 'simulado', label: 'Simulado' },
                { id: 'real', label: 'API real' },
              ]}
              value={c.dataMode ?? 'simulado'}
              onChange={(m) => {
                ctx.updateCase(c.id, { dataMode: m })
                if (m === 'real' && !custom) setEditing(true)
              }}
            />
          )}
          <button className="small" onClick={() => setEditing(!editing)}>
            {editing ? 'Cerrar parámetros' : 'Parámetros'}
          </button>
          {c.origin === 'datos' && (
            <button className="small danger" onClick={() => ctx.removeCase(c.id)} title="Eliminar caso">
              Eliminar
            </button>
          )}
        </div>
        <div className="muted small">{c.expectation.text}</div>
        <div className="small data-line">
          <span className="muted">Parámetros:</span> <code>{dataSummary(c)}</code>
        </div>
        {!run.ok && <div className="small blocked-reason">⚠ No se ejecutará: {run.reason}</div>}
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
          {ready}/{list.length} listos
        </span>
        {blocked > 0 && <span className="badge b-warn">{blocked} sin poder ejecutarse</span>}
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
            <span>Nombre del caso</span>
          </label>
          <input value={title} placeholder="Ej.: Cuenta ya existente" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>
            <span>Paso que se verifica</span>
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
            <span>Acción esperada (opcional)</span>
          </label>
          <select value={actionName} onChange={(e) => pickAction(e.target.value)}>
            <option value="">(ninguna)</option>
            {actions.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>
            <span>Status esperado</span>
            <span className="type">documentados: {documented.join(', ') || '—'}</span>
          </label>
          <input value={statuses} placeholder="Ej.: 200 o 200, 201" onChange={(e) => setStatuses(e.target.value)} />
        </div>
        <div className="field">
          <label>
            <span>Code esperado en el body (opcional)</span>
          </label>
          <input value={code} placeholder="Ej.: ACCOUNT_ALREADY_EXISTS" onChange={(e) => setCode(e.target.value)} />
        </div>
      </div>
      <div className="sub-head" style={{ marginTop: 14 }}>
        Parámetros del caso
      </div>
      <CaseParams wa={wa} base={base} tc={params} onChange={setParams} />
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button onClick={onCancel}>Cancelar</button>
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
          Agregar caso
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
      <div className="callout info small">
        Todos los casos usan los <strong>valores por defecto</strong> del paso 3. En <strong>Parámetros</strong> de cada caso puedes cambiar u omitir
        cualquier valor solo para ese caso.
      </div>
      <CaseGroup title="Camino feliz" hint="definido en el Arazzo" list={general.filter((c) => c.origin === 'arazzo')} defaultOpen ctx={ctx} />
      <CaseGroup
        title="Casos con datos propios"
        hint="tus propias combinaciones de parámetros para escenarios concretos · contra la API real"
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
              + Nuevo caso con datos
            </button>
          )
        }
      />
      <CaseGroup title="Validación de datos" hint="inputs faltantes o inválidos, derivados del schema · necesitan la API real" list={general.filter((c) => c.origin === 'schema')} defaultOpen={false} ctx={ctx} />
      <CaseGroup title="Seguridad" hint="sin credenciales · necesita la API real" list={general.filter((c) => c.origin === 'security')} defaultOpen={false} ctx={ctx} />
      <CaseGroup
        title="Escenarios por respuesta"
        hint="uno por acción onFailure/onSuccess · simulados, o contra la API real si les das datos"
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
  const canRun = ready.length > 0 && (mutating.length === 0 || p.confirmed) && !p.running
  const simulatedCount = ready.filter((c) => isSimulated(c, p.mode)).length

  return (
    <>
      <PageHeader
        step={4}
        title="Casos de prueba"
        description="Cada caso usa los valores por defecto del paso 3 más los cambios que le hagas en Parámetros. Solo se ejecutan los casos que se pueden cumplir con sus datos."
        actions={
          <div className="row">
            <button onClick={() => fileInput.current?.click()}>Importar escenarios</button>
            <button onClick={p.onExportScenarios}>Exportar escenarios</button>
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
            <strong>Escenarios importados:</strong> {importResult.summary}
            <span className="spacer" />
            <button className="link" onClick={() => setImportResult(undefined)}>
              Cerrar
            </button>
          </div>
          {importResult.errors.map((e) => (
            <div key={e}>⚠ {e}</div>
          ))}
        </div>
      )}

      <div className="mode-card">
        <div>
          <strong>Casos generales contra</strong>
          <div className="muted small">
            {p.mode === 'real'
              ? 'Usan el ambiente configurado en parámetros.'
              : 'Responden con los ejemplos del contrato. Los casos de rechazo y los de datos propios no se ejecutan en simulación.'}
          </div>
        </div>
        <Segmented
          options={[
            { id: 'real', label: 'API real' },
            { id: 'simulado', label: 'Simulación' },
          ]}
          value={p.mode}
          onChange={p.setMode}
        />
      </div>

      {p.analysis.workflows.map((w, i) => {
        const list = p.cases.filter((c) => c.workflowId === w.workflow.workflowId)
        const wfReady = list.filter((c) => c.enabled && runnability(c, p.mode).ok).length
        return (
          <Section
            key={w.workflow.workflowId}
            title={w.workflow.workflowId}
            subtitle={w.workflow.summary}
            defaultOpen={i === 0}
            badges={<span className={`badge ${wfReady ? 'b-accent' : 'b-skip'}`}>{wfReady} listos</span>}
            actions={
              <>
                <button className="link small" onClick={() => p.setMany(list.map((c) => c.id), true)}>
                  Todos
                </button>
                <button className="link small" onClick={() => p.setMany(list.map((c) => c.id), false)}>
                  Ninguno
                </button>
              </>
            }
          >
            <WorkflowCases wa={w} list={list} p={p} />
          </Section>
        )
      })}

      {mutating.length > 0 && (
        <div className="callout warn small">
          <strong>Estos pasos modifican datos en el ambiente configurado:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {mutating.map(({ wf, s }) => (
              <li key={wf + s.step.stepId}>
                <MethodBadge method={s.op!.method} /> <code>{(p.servers[s.op!.sourceName] || '(sin servidor)') + s.op!.path}</code>{' '}
                <span className="muted">
                  · {wf} / {s.step.stepId}
                </span>
              </li>
            ))}
          </ul>
          <label>
            <input type="checkbox" className="check" checked={p.confirmed} onChange={(e) => p.setConfirmed(e.target.checked)} />
            Entiendo que se crearán o modificarán datos en ese ambiente
          </label>
        </div>
      )}

      <ActionBar
        left={<button onClick={p.onBack}>← Volver</button>}
        info={`${ready.length} listos${simulatedCount ? ` (${simulatedCount} simulados)` : ''}${blocked ? ` · ${blocked} seleccionados no se pueden ejecutar` : ''}`}
        right={
          <button className="primary" disabled={!canRun} onClick={p.onRun}>
            {p.running ? 'Ejecutando…' : `Ejecutar ${ready.length} caso(s) →`}
          </button>
        }
      />
    </>
  )
}
