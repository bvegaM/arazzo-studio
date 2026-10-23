/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import type { ProjectAnalysis } from '../../core/analyze'
import type { Project } from '../../core/loader'
import type { SecurityScheme } from '../../core/openapi'
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

const CRED_HINT: Record<SecurityScheme['type'], string> = {
  bearer: 'Token Bearer (se envía como Authorization: Bearer …)',
  basic: 'usuario:contraseña (se codifica en Base64)',
  apiKey: 'API key',
  oauth2: 'Access token de OAuth2 (se envía como Bearer)',
  openIdConnect: 'Access token de OpenID Connect (se envía como Bearer)',
  other: 'Tipo de seguridad no soportado; se ignorará',
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
        <option value="">(sin valor)</option>
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
        <option value="">(sin valor)</option>
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
            setJsonError('JSON inválido')
          }
        }}
      />
    )
  } else {
    control = <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />
  }

  const hint = jsonError ?? [schema?.description, schema?.pattern && `Patrón: ${schema.pattern}`].filter(Boolean).join(' · ')
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
        title="Valores por defecto"
        description="Estos valores se usan en todos los casos de prueba. En el paso 4 puedes cambiarlos u omitirlos en cada caso. Se quedan en esta pestaña del navegador."
      />

      {p.analysis.workflows.length > 1 && (
        <div className="workflow-picker">
          {p.analysis.workflows.map((w) => {
            const vals = p.inputs[w.workflow.workflowId] ?? {}
            const miss = w.requiredInputs.filter((n) => isEmpty(vals[n])).length
            return (
              <button key={w.workflow.workflowId} className={w === wa ? 'active' : ''} onClick={() => p.onSelect(w.workflow.workflowId)}>
                <span className="wp-title">{w.workflow.workflowId}</span>
                <span className="wp-meta">{miss > 0 ? <span className="badge b-err">Faltan {miss}</span> : <span className="badge b-ok">✅ Completo</span>}</span>
              </button>
            )
          })}
        </div>
      )}

      <Section
        title={`Inputs por defecto de "${wa?.workflow.workflowId}"`}
        defaultOpen
        tone={missingRequired.length ? 'err' : undefined}
        badges={
          missingRequired.length ? (
            <span className="badge b-err">Faltan {missingRequired.length} obligatorio(s)</span>
          ) : (
            <span className="badge b-ok">✅ Obligatorios completos</span>
          )
        }
      >
        {props.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Este workflow no declara inputs.
          </p>
        ) : (
          <>
            {required.length > 0 && (
              <>
                <div className="sub-head">Obligatorios ({required.length})</div>
                <div className="field-grid">{required.map(field)}</div>
              </>
            )}
            {optional.length > 0 && (
              <>
                <button className="link toggle-more" onClick={() => setShowOptional(!showOptional)}>
                  {showOptional ? '▾ Ocultar' : '▸ Mostrar'} opcionales ({optional.length})
                </button>
                {showOptional && <div className="field-grid">{optional.map(field)}</div>}
              </>
            )}
          </>
        )}
      </Section>

      <Section
        title="Credenciales"
        defaultOpen={p.analysis.credentials.length > 0 && credsFilled < p.analysis.credentials.length}
        badges={
          p.analysis.credentials.length === 0 ? (
            <span className="badge b-skip">No declaradas en los contratos</span>
          ) : (
            <span className={`badge ${credsFilled === p.analysis.credentials.length ? 'b-ok' : 'b-warn'}`}>
              {credsFilled}/{p.analysis.credentials.length} completas
            </span>
          )
        }
      >
        {p.analysis.credentials.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Los contratos no declaran <code>securitySchemes</code>. Si la autenticación va en headers o en un paso del workflow, se toma de los inputs.
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
                  placeholder={c.type === 'basic' ? 'usuario:contraseña' : 'Pega aquí el valor'}
                  onChange={(e) => p.setCredential(c.key, e.target.value)}
                />
                <div className="hint">
                  {CRED_HINT[c.type]} · fuente {c.sourceName}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Ambiente" badges={<span className="badge b-skip">{loadedSources.length} URL(s) base</span>} subtitle={loadedSources.map((s) => p.servers[s.name]).filter(Boolean).join(' · ')}>
        <div className="field-grid">
          {loadedSources.map((s) => (
            <div className="field" key={s.name}>
              <label>
                <span>{s.name}</span>
                <span className="type">URL base</span>
              </label>
              <input type="url" value={p.servers[s.name] ?? ''} placeholder="https://api.midominio.com" onChange={(e) => p.setServer(s.name, e.target.value)} />
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Para ejecutar contra la API real, esta debe permitir CORS desde <code>{window.location.origin}</code>.
        </p>
      </Section>

      <ActionBar
        left={<button onClick={p.onBack}>← Volver</button>}
        info={missingRequired.length ? `Faltan: ${missingRequired.join(', ')}` : undefined}
        right={
          <button className="primary" onClick={p.onNext}>
            Elegir casos de prueba →
          </button>
        }
      />
    </>
  )
}
