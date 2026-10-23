/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import type { ProjectAnalysis } from '../../core/analyze'
import type { Project } from '../../core/loader'
import type { SecurityScheme } from '../../core/openapi'
import { t } from '../../i18n'
import { tn } from '../../i18n/react'
import { ActionBar, PageHeader, Section } from '../components/kit'

interface Props {
  project: Project
  analysis: ProjectAnalysis
  selected: string
  onSelect: (id: string) => void
  inputs: Record<string, Record<string, any>>
  setInput: (workflowId: string, name: string, value: any) => void
  credentials: Record<string, string>
  setCredential: (key: string, value: string) => void
  servers: Record<string, string>
  setServer: (name: string, value: string) => void
  onBack: () => void
  onNext: () => void
}

function credHint(type: SecurityScheme['type']): string {
  return t(`params.cred.${type}`)
}

const isEmpty = (v: any) => v === undefined || v === ''

function InputField({ name, schema, required, value, onChange }: { name: string; schema: any; required: boolean; value: any; onChange: (v: any) => void }) {
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
  const [raw, setRaw] = useState(() => (value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : ''))
  const [jsonError, setJsonError] = useState<string>()

  let control
  if (schema?.enum) {
    control = (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
        <option value="">{t('params.noValue')}</option>
        {schema.enum.map((v: any) => (
          <option key={String(v)} value={v}>
            {String(v)}
          </option>
        ))}
      </select>
    )
  } else if (type === 'boolean') {
    control = (
      <select value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
        <option value="">{t('params.noValue')}</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  } else if (type === 'number' || type === 'integer') {
    control = <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  } else if (type === 'object' || type === 'array') {
    control = (
      <textarea
        rows={4}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          if (raw.trim() === '') {
            setJsonError(undefined)
            return onChange(undefined)
          }
          try {
            onChange(JSON.parse(raw))
            setJsonError(undefined)
          } catch {
            setJsonError(t('params.invalidJson'))
          }
        }}
      />
    )
  } else {
    control = <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />
  }

  const hint = jsonError ?? [schema?.description, schema?.pattern && t('params.pattern', { pattern: schema.pattern })].filter(Boolean).join(' · ')
  return (
    <div className={`field ${required && isEmpty(value) ? 'missing' : ''}`}>
      <label>
        <span>
          {name} {required && <span className="req">*</span>}
        </span>
        <span className="type">{schema?.enum ? 'enum' : (type ?? 'any')}</span>
      </label>
      {control}
      {hint && (
        <div className="hint clamp" title={hint} style={jsonError ? { color: 'var(--err)' } : undefined}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function ParamsScreen(p: Props) {
  const wa = p.analysis.workflows.find((w) => w.workflow.workflowId === p.selected) ?? p.analysis.workflows[0]
  const props = Object.entries<any>(wa?.inputsSchema.properties ?? {})
  const values = p.inputs[wa?.workflow.workflowId] ?? {}
  const required = props.filter(([n]) => wa.requiredInputs.includes(n))
  const optional = props.filter(([n]) => !wa.requiredInputs.includes(n))
  const [showOptional, setShowOptional] = useState(false)
  const missingRequired = required.filter(([n]) => isEmpty(values[n])).map(([n]) => n)
  const loadedSources = p.project.sources.filter((s) => s.status === 'loaded')
  const credsFilled = p.analysis.credentials.filter((c) => p.credentials[c.key]).length

  const field = ([name, schema]: [string, any]) => (
    <InputField
      key={`${wa.workflow.workflowId}-${name}`}
      name={name}
      schema={schema}
      required={wa.requiredInputs.includes(name)}
      value={values[name]}
      onChange={(v) => p.setInput(wa.workflow.workflowId, name, v)}
    />
  )

  return (
    <>
      <PageHeader
        step={3}
        title={t('nav.defaults')}
        description={t('params.description')}
      />

      {p.analysis.workflows.length > 1 && (
        <div className="workflow-picker">
          {p.analysis.workflows.map((w) => {
            const vals = p.inputs[w.workflow.workflowId] ?? {}
            const miss = w.requiredInputs.filter((n) => isEmpty(vals[n])).length
            return (
              <button key={w.workflow.workflowId} className={w === wa ? 'active' : ''} onClick={() => p.onSelect(w.workflow.workflowId)}>
                <span className="wp-title">{w.workflow.workflowId}</span>
                <span className="wp-meta">{miss > 0 ? <span className="badge b-err">{t('nav.missing', { n: miss })}</span> : <span className="badge b-ok">✅ {t('params.complete')}</span>}</span>
              </button>
            )
          })}
        </div>
      )}

      <Section
        title={t('params.inputsTitle', { workflow: wa?.workflow.workflowId })}
        defaultOpen
        tone={missingRequired.length ? 'err' : undefined}
        badges={
          missingRequired.length ? (
            <span className="badge b-err">{t('params.missingRequired', { n: missingRequired.length })}</span>
          ) : (
            <span className="badge b-ok">✅ {t('params.requiredComplete')}</span>
          )
        }
      >
        {props.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t('params.noInputs')}
          </p>
        ) : (
          <>
            {required.length > 0 && (
              <>
                <div className="sub-head">{t('params.required', { n: required.length })}</div>
                <div className="field-grid">{required.map(field)}</div>
              </>
            )}
            {optional.length > 0 && (
              <>
                <button className="link toggle-more" onClick={() => setShowOptional(!showOptional)}>
                  {showOptional ? t('params.hideOptional', { n: optional.length }) : t('params.showOptional', { n: optional.length })}
                </button>
                {showOptional && <div className="field-grid">{optional.map(field)}</div>}
              </>
            )}
          </>
        )}
      </Section>

      <Section
        title={t('params.credentials')}
        defaultOpen={p.analysis.credentials.length > 0 && credsFilled < p.analysis.credentials.length}
        badges={
          p.analysis.credentials.length === 0 ? (
            <span className="badge b-skip">{t('params.credsNotDeclared')}</span>
          ) : (
            <span className={`badge ${credsFilled === p.analysis.credentials.length ? 'b-ok' : 'b-warn'}`}>
              {t('params.credsFilled', { filled: credsFilled, total: p.analysis.credentials.length })}
            </span>
          )
        }
      >
        {p.analysis.credentials.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {tn('params.noSchemes', { schemes: <code>securitySchemes</code> })}
          </p>
        ) : (
          <div className="field-grid">
            {p.analysis.credentials.map((c) => (
              <div className="field" key={c.key}>
                <label>
                  <span>{c.schemeName}</span>
                  <span className="type">
                    {c.type}
                    {c.paramName ? ` · ${c.in} "${c.paramName}"` : ''}
                  </span>
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={p.credentials[c.key] ?? ''}
                  placeholder={c.type === 'basic' ? t('params.basicPlaceholder') : t('params.pastePlaceholder')}
                  onChange={(e) => p.setCredential(c.key, e.target.value)}
                />
                <div className="hint">
                  {credHint(c.type)} · {t('graph.source', { source: c.sourceName })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('report.environment')} badges={<span className="badge b-skip">{t('params.baseUrls', { n: loadedSources.length })}</span>} subtitle={loadedSources.map((s) => p.servers[s.name]).filter(Boolean).join(' · ')}>
        <div className="field-grid">
          {loadedSources.map((s) => (
            <div className="field" key={s.name}>
              <label>
                <span>{s.name}</span>
                <span className="type">{t('report.baseUrl')}</span>
              </label>
              <input type="url" value={p.servers[s.name] ?? ''} placeholder={t('params.urlPlaceholder')} onChange={(e) => p.setServer(s.name, e.target.value)} />
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {tn('params.corsHint', { origin: <code>{window.location.origin}</code> })}
        </p>
      </Section>

      <ActionBar
        left={<button onClick={p.onBack}>{t('common.back')}</button>}
        info={missingRequired.length ? t('params.missingList', { names: missingRequired.join(', ') }) : undefined}
        right={
          <button className="primary" onClick={p.onNext}>
            {t('params.next')}
          </button>
        }
      />
    </>
  )
}
