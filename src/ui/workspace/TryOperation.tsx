// Probar una operación del contrato sola (como en un cliente de APIs): parámetros y body con
// {{variables}}, el ambiente activo y la respuesta validada contra el contrato.
import { useRef, useState } from 'react'
import type { StepResult } from '../../core/runner'
import { exampleRequestBody, missingRequired, type TryForm } from '../../core/tryOperation'
import type { OperationRef, SecurityScheme } from '../../core/openapi'
import { t } from '../../i18n'
import { MethodBadge } from '../components/badges'
import { EnvDot, Icon, Segmented } from '../components/kit'
import { TemplateInput } from '../components/TemplateInput'
import { StepCard } from './ResultsPanel'

export interface TryState {
  form: TryForm
  result?: StepResult
  error?: string
  simulate: boolean
  /** Sube con cada envío: la tarjeta de la respuesta se vuelve a abrir con la nueva. */
  runId?: number
}

interface Props {
  op: OperationRef
  server: string
  env: { name: string; color?: string }
  /** Credenciales que pide la operación y si el ambiente las tiene. */
  security: (SecurityScheme & { set: boolean })[]
  state: TryState
  onState: (s: TryState) => void
  onSend: (signal: AbortSignal) => Promise<void>
  onOpenEnv: () => void
  /** Dentro de la documentación ("Try it out"): sin título y en una sola columna. */
  compact?: boolean
}

const PLAY_ICON = 'M7 5l12 7-12 7V5z'
const RESET_ICON = 'M3 7v6h6M3.5 13a9 9 0 1 0 2.1-8.6L3 7'

export function TryOperation({ op, server, env, security, state, onState, onSend, onOpenEnv, compact }: Props) {
  const [sending, setSending] = useState(false)
  const controller = useRef<AbortController>(null)
  const { form } = state
  const missing = missingRequired(form)
  const credsMissing = !state.simulate && security.some((s) => !s.set)

  const send = async () => {
    if (sending) return
    setSending(true)
    controller.current = new AbortController()
    try {
      await onSend(controller.current.signal)
    } finally {
      setSending(false)
    }
  }
  const setParam = (i: number, value: string) => onState({ ...state, form: { ...form, params: form.params.map((p, n) => (n === i ? { ...p, value } : p)) } })
  const byLocation = ['path', 'query', 'header', 'cookie'].map((loc) => ({ loc, items: form.params.map((p, i) => ({ p, i })).filter(({ p }) => p.in === loc) })).filter((g) => g.items.length)

  return (
    <div
      className={`try-op ${compact ? 'compact' : ''}`}
      onKeyDown={(e) => {
        // ⌘/Ctrl + Enter envía esta operación (y no ejecuta el journey de fondo).
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          e.stopPropagation()
          void send()
        }
      }}
    >
      <div className="ws-runbar">
        {!compact && (
          <div className="ws-runbar-title">
            <h2 className="try-title">
              <MethodBadge method={op.method} /> <code>{op.path}</code>
            </h2>
            <span className="muted small clamp-1">{[op.operationId, op.operation?.summary].filter(Boolean).join(' · ')}</span>
          </div>
        )}
        <span className="spacer" />
        <Segmented
          options={[
            { id: 'real', label: t('common.realApi') },
            { id: 'sim', label: t('common.simulated') },
          ]}
          value={state.simulate ? 'sim' : 'real'}
          onChange={(v) => onState({ ...state, simulate: v === 'sim' })}
        />
        <button className="ws-env-pill" onClick={onOpenEnv} title={t('ws.tree.configure')}>
          <EnvDot color={env.color} /> {env.name}
        </button>
        {sending ? (
          <button onClick={() => controller.current?.abort()}>{t('common.cancel')}</button>
        ) : (
          <button className="primary" onClick={() => void send()} title={`${t('try.send')} (⌘/Ctrl + Enter)`}>
            <Icon d={PLAY_ICON} size={13} /> {t('try.send')}
          </button>
        )}
      </div>

      <div className="try-body">
        <div className="try-form">
          <div className="try-url">
            <span className="muted small">{t('try.url')}</span>
            <code className="clamp-1" title={`${server}${op.path}`}>
              {server || `{${op.sourceName}}`}
              {op.path}
            </code>
          </div>
          {!server && !state.simulate && <div className="callout warn small">{t('try.noServer', { source: op.sourceName })}</div>}

          {security.length > 0 && (
            <div className={`callout small ${credsMissing ? 'warn' : 'info'}`}>
              {credsMissing ? t('try.credsMissing', { env: env.name }) : t('try.credsOk', { names: security.map((s) => s.schemeName).join(', ') })}{' '}
              {credsMissing && (
                <button className="link" onClick={onOpenEnv}>
                  {t('ws.tree.configure')}
                </button>
              )}
            </div>
          )}

          {byLocation.map(({ loc, items }) => (
            <section key={loc} className="try-section">
              <h4>{t(`try.in.${loc}` as 'try.in.path')}</h4>
              <div className="try-params">
                {items.map(({ p, i }) => (
                  <label key={`${p.in}:${p.name}`} className={`try-param ${p.required && !p.value.trim() ? 'missing' : ''}`}>
                    <span className="try-param-name">
                      <code>{p.name}</code>
                      {p.required && <span className="err" title={t('try.required')}>*</span>}
                      {p.schema?.type && <span className="muted small">{p.schema.type}</span>}
                    </span>
                    <TemplateInput value={p.value} onChange={(v) => setParam(i, v)} placeholder={p.description ?? ''} spellCheck={false} />
                  </label>
                ))}
              </div>
            </section>
          ))}

          {form.body !== undefined && (
            <section className="try-section">
              <h4>
                {t('try.body')} <span className="muted small">{form.contentType}</span>
                <span className="spacer" />
                <button className="link small" onClick={() => onState({ ...state, form: { ...form, ...exampleRequestBody(op) } })} title={t('try.resetBodyHint')}>
                  <Icon d={RESET_ICON} size={12} /> {t('try.resetBody')}
                </button>
              </h4>
              <textarea
                className="try-textarea"
                value={form.body}
                spellCheck={false}
                rows={Math.min(18, Math.max(6, form.body.split('\n').length + 1))}
                onChange={(e) => onState({ ...state, form: { ...form, body: e.target.value } })}
              />
              <span className="muted small">{t('try.bodyHint')}</span>
            </section>
          )}

          {!form.params.length && form.body === undefined && <p className="muted small">{t('try.noInputs')}</p>}
          {missing.length > 0 && <p className="muted small">{t('try.missing', { names: missing.join(', ') })}</p>}
        </div>

        <aside className="try-result">
          <h4>{t('try.response')}</h4>
          {state.error ? (
            <div className="callout err small">{state.error}</div>
          ) : state.result ? (
            <>
              <div className={`try-verdict ${state.result.contractIssues.length ? 'warn' : state.result.response && state.result.response.status < 400 ? 'ok' : 'err'}`}>
                {state.result.response ? (
                  <>
                    <strong>{state.result.response.status}</strong> {state.result.response.statusText} · {state.result.response.durationMs} ms
                  </>
                ) : (
                  <strong>{t('try.noResponse')}</strong>
                )}
                <span className="spacer" />
                {state.result.response &&
                  (state.result.contractIssues.length ? <span>⚠ {t('try.contractIssues', { n: state.result.contractIssues.length })}</span> : <span>✓ {t('try.contractOk')}</span>)}
              </div>
              <StepCard key={state.runId} s={state.result} index={0} defaultOpen />
            </>
          ) : (
            <div className="dev-empty try-empty">
              <Icon d={PLAY_ICON} size={22} />
              <strong>{t('try.empty')}</strong>
              <span className="muted small">{t('try.emptyHint')}</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
