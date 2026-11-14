import { useState } from 'react'
import type { ProjectAnalysis } from '../../core/analyze'
import { VARIABLE_NAME, type Environment, type EnvVariable } from '../../core/environments'
import { GENERATOR_NAMES } from '../../core/templates'
import type { Project } from '../../core/loader'
import type { SecurityScheme } from '../../core/openapi'
import { isAsyncApi } from '../../core/asyncapi'
import { desktop } from '../../lib/desktop'
import { t } from '../../i18n'
import { tn } from '../../i18n/react'
import { EnvironmentBar, type EnvActions } from '../components/EnvironmentBar'
import { Icon, Section } from '../components/kit'
import { TemplateInput } from '../components/TemplateInput'

interface Props {
  project: Project
  analysis: ProjectAnalysis
  environments: Environment[]
  activeEnv: Environment
  envActions: EnvActions & { setVariables: (variables: EnvVariable[]) => void }
  credentials: Record<string, string>
  setCredential: (key: string, value: string) => void
  servers: Record<string, string>
  setServer: (name: string, value: string) => void
}

function credHint(type: SecurityScheme['type']): string {
  return t(`params.cred.${type}`)
}

const TRASH_ICON = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'
const EYE_ICON = 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'

/** Problema del nombre de una variable, o undefined si es válido. */
function nameProblem(v: EnvVariable, all: EnvVariable[]): { level: 'err' | 'warn'; text: string } | undefined {
  if (!v.name) return undefined
  if (!VARIABLE_NAME.test(v.name)) return { level: 'err', text: t('vars.invalidName') }
  if (all.filter((x) => x.name === v.name).length > 1) return { level: 'err', text: t('vars.duplicate') }
  if (GENERATOR_NAMES.includes(v.name.toLowerCase())) return { level: 'warn', text: t('vars.shadowsGenerator', { name: v.name }) }
  return undefined
}

/** Tabla de variables o de secretos del ambiente activo (editan la misma lista). */
function VariablesTable({ variables, secret, onChange }: { variables: EnvVariable[]; secret: boolean; onChange: (v: EnvVariable[]) => void }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const rows = variables.map((v, index) => ({ v, index })).filter((r) => r.v.secret === secret)
  const update = (index: number, patch: Partial<EnvVariable>) => onChange(variables.map((v, n) => (n === index ? { ...v, ...patch } : v)))
  return (
    <div className="vars">
      {rows.length > 0 && (
        <table className="vars-table">
          <thead>
            <tr>
              <th>{t('vars.name')}</th>
              <th>{t('vars.value')}</th>
              <th aria-label={t('vars.actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, index }) => {
              const problem = nameProblem(v, variables)
              return (
                <tr key={index}>
                  <td>
                    <input
                      className={`mono ${problem?.level === 'err' ? 'invalid' : ''}`}
                      value={v.name}
                      placeholder={secret ? 'apiKey' : 'clientId'}
                      aria-label={t('vars.name')}
                      autoFocus={!v.name && !v.value}
                      onChange={(e) => update(index, { name: e.target.value.trim() })}
                    />
                    {problem && <div className={`hint ${problem.level}`}>{problem.text}</div>}
                  </td>
                  <td>
                    <div className="vars-value">
                      <input
                        className="mono"
                        type={secret && !revealed[index] ? 'password' : 'text'}
                        autoComplete="off"
                        value={v.value}
                        aria-label={t('vars.value')}
                        onChange={(e) => update(index, { value: e.target.value })}
                      />
                      {secret && (
                        <button
                          className="icon-btn"
                          onClick={() => setRevealed((r) => ({ ...r, [index]: !r[index] }))}
                          title={t(revealed[index] ? 'vars.hide' : 'vars.show')}
                          aria-label={t(revealed[index] ? 'vars.hide' : 'vars.show')}
                          aria-pressed={!!revealed[index]}
                        >
                          <Icon d={EYE_ICON} size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="vars-actions">
                    <button className="icon-btn" onClick={() => onChange(variables.filter((_, n) => n !== index))} title={t('vars.delete')} aria-label={t('vars.delete')}>
                      <Icon d={TRASH_ICON} size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <button className="add-case" onClick={() => onChange([...variables, { name: '', value: '', secret }])}>
        {t(secret ? 'vars.addSecret' : 'vars.addVariable')}
      </button>
    </div>
  )
}

/** Pestaña "Ambiente": URLs base, credenciales, variables y secretos de cada ambiente (local, intg, prod…). */
export function EnvironmentView(p: Props) {
  // Los AsyncAPI no tienen URL base que configurar: sus pasos se simulan.
  const httpSources = p.project.sources.filter((s) => s.status === 'loaded' && !isAsyncApi(s.doc))
  const variables = p.activeEnv.variables.filter((v) => !v.secret)
  const secrets = p.activeEnv.variables.filter((v) => v.secret)
  const credsFilled = p.analysis.credentials.filter((c) => p.credentials[c.key]).length
  const count = (n: number) => <span className="badge b-skip">{n}</span>
  return (
    <div className="ws-view">
      <EnvironmentBar environments={p.environments} activeId={p.activeEnv.id} actions={p.envActions} />
      <p className="muted small env-hint">{t('env.hint')}</p>

      <Section title={t('params.urlsTitle')} badges={count(httpSources.length)} defaultOpen>
        <div className="field-grid">
          {httpSources.map((s) => (
            <div className="field" key={s.name}>
              <label>
                <span>{s.name}</span>
                <span className="type plain">{t('report.baseUrl')}</span>
              </label>
              <TemplateInput value={p.servers[s.name] ?? ''} placeholder={t('params.urlPlaceholder')} onChange={(v) => p.setServer(s.name, v)} />
            </div>
          ))}
        </div>
        {!desktop && <p className="muted small">{tn('params.corsHint', { origin: <code>{window.location.origin}</code> })}</p>}
      </Section>

      <Section
        title={t('params.credentials')}
        defaultOpen
        tone={credsFilled < p.analysis.credentials.length ? 'warn' : undefined}
        badges={
          p.analysis.credentials.length > 0 && (
            <span className={`badge ${credsFilled < p.analysis.credentials.length ? 'b-warn' : 'b-ok'}`}>
              {t('params.credsFilled', { filled: credsFilled, total: p.analysis.credentials.length })}
            </span>
          )
        }
      >
        {p.analysis.credentials.length === 0 ? (
          <p className="muted">{tn('params.noSchemes', { schemes: <code>securitySchemes</code> })}</p>
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
                <TemplateInput
                  type={(p.credentials[c.key] ?? '').trim().startsWith('{{') ? 'text' : 'password'}
                  value={p.credentials[c.key] ?? ''}
                  placeholder={c.type === 'basic' ? t('params.basicPlaceholder') : t('vars.credentialPlaceholder')}
                  onChange={(v) => p.setCredential(c.key, v)}
                />
                <div className="hint">
                  {credHint(c.type)} · {t('graph.source', { source: c.sourceName })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('vars.variables')} badges={count(variables.length)} defaultOpen>
        <p className="muted small section-intro">{tn('vars.variablesHint', { example: <code>{'{{clientId}}'}</code> })}</p>
        <VariablesTable variables={p.activeEnv.variables} secret={false} onChange={p.envActions.setVariables} />
      </Section>

      <Section title={t('vars.secrets')} badges={count(secrets.length)} defaultOpen>
        <p className="muted small section-intro">{tn('vars.secretsHint', { example: <code>{'{{apiKey}}'}</code> })}</p>
        <VariablesTable variables={p.activeEnv.variables} secret onChange={p.envActions.setVariables} />
      </Section>
    </div>
  )
}
