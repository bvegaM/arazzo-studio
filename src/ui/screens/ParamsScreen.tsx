/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import type { ProjectAnalysis } from '../../core/analyze'
import type { Project } from '../../core/loader'
import type { SecurityScheme } from '../../core/openapi'
import { humanizeId } from '../../core/format'
import { t } from '../../i18n'
import { tn } from '../../i18n/react'
import { invalidPaths, leavesFirst, missingInputs } from '../../core/schemaForm'
import { ActionBar, PageHeader, Section } from '../components/kit'
import { SchemaField } from '../components/SchemaField'
import { WorkflowPicker, type PickerItem } from '../components/WorkflowPicker'

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

export function ParamsScreen(p: Props) {
  const wa = p.analysis.workflows.find((w) => w.workflow.workflowId === p.selected) ?? p.analysis.workflows[0]
  const props = leavesFirst(Object.entries<any>(wa?.inputsSchema.properties ?? {}))
  const values = p.inputs[wa?.workflow.workflowId] ?? {}
  const required = props.filter(([n]) => wa.requiredInputs.includes(n))
  const optional = props.filter(([n]) => !wa.requiredInputs.includes(n))
  const [showOptional, setShowOptional] = useState(false)
  const missingRequired = missingInputs(wa?.inputsSchema, values)
  const invalid = invalidPaths(wa?.inputsSchema, values)
  const loadedSources = p.project.sources.filter((s) => s.status === 'loaded')
  const credsFilled = p.analysis.credentials.filter((c) => p.credentials[c.key]).length

  const pickerItems: PickerItem[] = p.analysis.workflows.map((w) => {
    const vals = p.inputs[w.workflow.workflowId]
    const miss = missingInputs(w.inputsSchema, vals).length
    const bad = invalidPaths(w.inputsSchema, vals).length
    const base = { id: w.workflow.workflowId, summary: w.workflow.summary }
    if (miss) return { ...base, tone: 'err', meta: t('nav.missing', { n: miss }) }
    if (bad) return { ...base, tone: 'warn', meta: t('params.invalidN', { n: bad }) }
    return { ...base, tone: 'ok' }
  })

  const field = ([name, schema]: [string, any]) => (
    <SchemaField
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
        <WorkflowPicker
          value={wa.workflow.workflowId}
          onChange={p.onSelect}
          summary={t('params.pickerSummary', { done: pickerItems.filter((i) => i.tone === 'ok').length, total: pickerItems.length })}
          items={pickerItems}
        />
      )}

      <Section
        title={t('params.inputsTitle', { workflow: humanizeId(wa?.workflow.workflowId ?? '') })}
        defaultOpen
        tone={missingRequired.length ? 'err' : invalid.length ? 'warn' : undefined}
        badges={
          <>
            {missingRequired.length ? (
              <span className="badge b-err">{t('params.missingRequired', { n: missingRequired.length })}</span>
            ) : (
              <span className="badge b-ok">✅ {t('params.requiredComplete')}</span>
            )}
            {invalid.length > 0 && <span className="badge b-warn">{t('params.invalidN', { n: invalid.length })}</span>}
          </>
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
        info={
          missingRequired.length
            ? t('params.missingList', { names: missingRequired.join(', ') })
            : invalid.length
              ? t('params.invalidList', { names: invalid.join(', ') })
              : undefined
        }
        right={
          <button className="primary" onClick={p.onNext}>
            {t('params.next')}
          </button>
        }
      />
    </>
  )
}
