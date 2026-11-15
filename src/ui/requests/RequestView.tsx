/* eslint-disable @typescript-eslint/no-explicit-any */
// Un request suelto de la colección, como en Postman: HTTP (REST), GraphQL, gRPC o WebSocket. Arriba
// la barra (método, URL y enviar), en el medio lo que se envía y abajo la respuesta.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { HTTP_METHODS, buildHttpRequest, requestBadge, splitQuery, type BodyMode, type KeyValue, type SavedRequest } from '../../core/requests'
import { AuthPanel } from './AuthPanel'
import { CurlParseError, parseCurl } from '../../core/curlImport'
import { toCurl } from '../../core/curl'
import type { RequestResult, RequestsApi } from '../../app/useRequests'
import type { GrpcService } from '../../lib/desktop'
import { useWsConnection, wsClear, wsConnect, wsDisconnect, wsSend } from '../../lib/wsClient'
import { copyText, readTextFiles } from '../../lib/browser'
import { JsonView } from '../components/Diff'
import { EnvDot, Icon, Segmented, Tabs } from '../components/kit'
import { TemplateInput } from '../components/TemplateInput'
import { t } from '../../i18n'

const CodeField = lazy(() => import('./CodeField'))

interface Props {
  request: SavedRequest
  api: RequestsApi
  result?: RequestResult
  sending: boolean
  isDesktop: boolean
  env: { name: string; color?: string }
  onOpenEnv: () => void
  /** Al terminar de editar el nombre: renombra también el archivo. */
  onRename?: (name: string) => void
  /** Abre la autorización de la colección (la que se hereda). */
  onOpenCollectionAuth?: () => void
}

const SEND_ICON = 'M5 12h14M13 6l6 6-6 6'

function Code(props: Parameters<typeof CodeField>[0]) {
  return (
    <Suspense fallback={<div className="code-field loading" style={{ minHeight: props.minHeight ?? 140 }} />}>
      <CodeField {...props} />
    </Suspense>
  )
}

/** Tabla clave/valor como la de Postman: casilla para activar, clave, valor y una fila vacía al final. */
export function KeyValueTable({ rows, onChange, keyPlaceholder, valuePlaceholder }: { rows: KeyValue[]; onChange: (rows: KeyValue[]) => void; keyPlaceholder?: string; valuePlaceholder?: string }) {
  const list = [...rows, { key: '', value: '', enabled: true }]
  const set = (i: number, patch: Partial<KeyValue>) => {
    const next = list.map((r, n) => (n === i ? { ...r, ...patch } : r)).filter((r, n) => n < list.length - 1 || r.key || r.value)
    onChange(next)
  }
  return (
    <table className="kv-table">
      <thead>
        <tr>
          <th className="kv-check" />
          <th>{t('request.kv.key')}</th>
          <th>{t('request.kv.value')}</th>
          <th className="kv-actions" />
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => {
          const isNew = i === list.length - 1
          return (
            <tr key={i} className={!r.enabled && !isNew ? 'off' : undefined}>
              <td className="kv-check">{!isNew && <input type="checkbox" className="check" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} aria-label={t('request.kv.enabled')} />}</td>
              <td>
                <input value={r.key} placeholder={keyPlaceholder ?? t('request.kv.key')} onChange={(e) => set(i, { key: e.target.value })} spellCheck={false} />
              </td>
              <td>
                <TemplateInput value={r.value} placeholder={valuePlaceholder ?? t('request.kv.value')} onChange={(v) => set(i, { value: v })} spellCheck={false} />
              </td>
              <td className="kv-actions">
                {!isNew && (
                  <button className="icon-btn" onClick={() => onChange(rows.filter((_, n) => n !== i))} aria-label={t('request.kv.remove')} title={t('request.kv.remove')}>
                    <Icon d="M6 6l12 12M18 6L6 18" size={12} />
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function BodyPanel({ request, onChange, onSubmit }: { request: SavedRequest; onChange: (p: Partial<SavedRequest>) => void; onSubmit: () => void }) {
  const body = request.body ?? { mode: 'none' as BodyMode }
  const modes: BodyMode[] = ['none', 'json', 'text', 'xml', 'urlencoded', 'formdata']
  return (
    <div className="rq-body">
      <div className="rq-body-modes" role="radiogroup" aria-label="Body">
        {modes.map((m) => (
          <label key={m} className={`rq-radio ${body.mode === m ? 'on' : ''}`}>
            <input type="radio" name="body-mode" checked={body.mode === m} onChange={() => onChange({ body: { ...body, mode: m } })} />
            {t(`request.body.${m}`)}
          </label>
        ))}
        {body.mode === 'json' && (
          <button
            className="link small rq-beautify"
            onClick={() => {
              try {
                onChange({ body: { ...body, text: JSON.stringify(JSON.parse(body.text ?? ''), null, 2) } })
              } catch {
                /* no es JSON válido: se deja como está */
              }
            }}
          >
            {t('request.body.beautify')}
          </button>
        )}
      </div>
      {body.mode === 'none' ? (
        <p className="muted small rq-empty">{t('request.body.noneHint')}</p>
      ) : body.mode === 'urlencoded' || body.mode === 'formdata' ? (
        <KeyValueTable rows={body.form ?? []} onChange={(form) => onChange({ body: { ...body, form } })} />
      ) : (
        <Code value={body.text ?? ''} language={body.mode === 'json' ? 'json' : 'text'} onChange={(text) => onChange({ body: { ...body, text } })} onSubmit={onSubmit} ariaLabel="Body" />
      )}
    </div>
  )
}

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

// El navegador no siempre da el texto del estado (HTTP/2 no lo envía): se usa el estándar.
const REASONS: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict',
  415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
}

function statusClass(status: number): string {
  return status >= 500 ? 's5' : status >= 400 ? 's4' : status >= 300 ? 's3' : 's2'
}

function parseJson(text: string): { ok: true; value: any } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

function CopyBtn({ text, label }: { text: () => string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="small ghost"
      onClick={async () => {
        if (await copyText(text())) {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        }
      }}
    >
      {done ? `✓ ${t('results.copied')}` : label}
    </button>
  )
}

function ResponseEmpty({ icon, title, text }: { icon?: string; title: string; text: string }) {
  return (
    <div className="rq-res-empty">
      <span className="rq-res-empty-icon" aria-hidden="true">
        <Icon d={icon ?? SEND_ICON} size={20} />
      </span>
      <strong>{title}</strong>
      <span className="muted small">{text}</span>
    </div>
  )
}

/** La respuesta HTTP (también GraphQL): estado, tiempo, tamaño, body y headers. */
function HttpResponseView({ result, sending, isDesktop }: { result?: Extract<RequestResult, { kind: 'http' }>; sending: boolean; isDesktop: boolean }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body')
  const [raw, setRaw] = useState(false)
  if (sending) return <div className="rq-res-empty"><span className="spinner" /> <span className="muted">{t('request.sending')}</span></div>
  if (!result) return <ResponseEmpty title={t('request.res.emptyTitle')} text={t('request.res.emptyText')} />
  if (result.error || !result.response) {
    return (
      <div className="rq-res-error">
        <strong>{t('request.res.failed')}</strong>
        <p>{result.error}</p>
        {!isDesktop && !result.authError && <p className="muted small">{t('request.res.corsHint')}</p>}
      </div>
    )
  }
  const res = result.response
  const parsed = parseJson(res.bodyText)
  const headers = Object.entries(res.headers)
  return (
    <div className="rq-res-body">
      <div className="rq-res-meta">
        <span className={`rq-status ${statusClass(res.status)}`}>
          {res.status} {res.statusText || REASONS[res.status] || ''}
        </span>
        <span className="muted small">{res.durationMs} ms</span>
        <span className="muted small">{formatBytes(new TextEncoder().encode(res.bodyText).length)}</span>
        <span className="spacer" />
        <CopyBtn text={() => res.bodyText} label={t('request.res.copyBody')} />
      </div>
      <div className="rq-res-tabs">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'body', label: 'Body' },
            { id: 'headers', label: 'Headers', count: headers.length },
          ]}
        />
        {tab === 'body' && parsed.ok && (
          <Segmented
            options={[
              { id: 'pretty', label: 'Pretty' },
              { id: 'raw', label: 'Raw' },
            ]}
            value={raw ? 'raw' : 'pretty'}
            onChange={(v) => setRaw(v === 'raw')}
          />
        )}
      </div>
      <div className="rq-res-content">
        {tab === 'headers' ? (
          <table className="rq-headers">
            <tbody>
              {headers.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <code>{k}</code>
                  </td>
                  <td>
                    <code>{v}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !res.bodyText ? (
          <p className="muted small">{t('request.res.noBody')}</p>
        ) : parsed.ok && !raw ? (
          <JsonView value={parsed.value} />
        ) : (
          <Code value={parsed.ok ? JSON.stringify(parsed.value, null, 2) : res.bodyText} readOnly language={parsed.ok ? 'json' : 'text'} minHeight={120} />
        )}
      </div>
    </div>
  )
}

/** Barra superior: tipo/método, URL y el botón principal. */
function UrlBar({ left, url, onUrl, onPaste, action, placeholder }: { left: ReactNode; url: string; onUrl: (v: string) => void; onPaste?: (text: string) => boolean; action: ReactNode; placeholder: string }) {
  return (
    <div className="rq-bar">
      {left}
      <TemplateInput
        className="rq-url"
        value={url}
        placeholder={placeholder}
        spellCheck={false}
        onChange={onUrl}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text')
          if (onPaste?.(text)) e.preventDefault()
        }}
        aria-label="URL"
      />
      {action}
    </div>
  )
}

function HttpRequestEditor(p: Props) {
  const { request, api, result, sending, isDesktop } = p
  const isGraphql = request.kind === 'graphql'
  type Tab = 'params' | 'auth' | 'headers' | 'body' | 'query' | 'variables'
  const [tab, setTab] = useState<Tab>(isGraphql ? 'query' : 'params')
  const [pasteError, setPasteError] = useState<string>()
  const update = (patch: Partial<SavedRequest>) => api.update(request.path, patch)
  const send = () => void api.send(request.path)
  const count = (rows?: KeyValue[]) => (rows ?? []).filter((r) => r.enabled && r.key).length
  const method = (request.method ?? 'GET').toUpperCase()

  const onUrl = (v: string) => {
    // Como Postman: si la URL trae ?a=1, los params pasan a la tabla.
    if (!isGraphql && v.includes('?')) {
      const { base, params } = splitQuery(v)
      update({ url: base, params: [...(request.params ?? []), ...params] })
    } else update({ url: v })
  }
  const onPaste = (text: string) => {
    if (isGraphql || !/^\s*curl\s/i.test(text)) return false
    try {
      const { kind: _kind, ...parsed } = parseCurl(text)
      update(parsed)
      setPasteError(undefined)
      return true
    } catch (e) {
      setPasteError(e instanceof CurlParseError ? t('request.curl.invalid') : String(e))
      return true
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = isGraphql
    ? [
        { id: 'query', label: t('request.tab.query') },
        { id: 'variables', label: t('request.tab.variables') },
        { id: 'headers', label: 'Headers', count: count(request.headers) },
        { id: 'auth', label: t('request.tab.auth') },
      ]
    : [
        { id: 'params', label: 'Params', count: count(request.params) },
        { id: 'auth', label: t('request.tab.auth') },
        { id: 'headers', label: 'Headers', count: count(request.headers) },
        { id: 'body', label: 'Body' },
      ]
  const curl = () => {
    try {
      const req = buildHttpRequest(request)
      return toCurl({ ...req, body: req.body })
    } catch {
      return ''
    }
  }
  return (
    <>
      <UrlBar
        left={
          isGraphql ? (
            <span className="rq-kind m-gql">GraphQL</span>
          ) : (
            <select className={`rq-method m-${method.toLowerCase()}`} value={method} onChange={(e) => update({ method: e.target.value })} aria-label={t('request.method')}>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )
        }
        url={request.url}
        onUrl={onUrl}
        onPaste={onPaste}
        placeholder={isGraphql ? 'https://api.example.com/graphql' : t('request.urlPlaceholder')}
        action={
          sending ? (
            <button onClick={() => api.cancel(request.path)}>{t('common.cancel')}</button>
          ) : (
            <button className="primary rq-send" onClick={send} disabled={!request.url.trim()} title={t('request.sendHint')}>
              {t('request.send')}
            </button>
          )
        }
      />
      {pasteError && <div className="callout err small rq-callout">{pasteError}</div>}
      <div className="rq-split">
        <section className="rq-req">
          <div className="rq-req-tabs">
            <Tabs value={tab} onChange={setTab} tabs={tabs} />
            <span className="spacer" />
            <CopyBtn text={curl} label={t('request.copyCurl')} />
          </div>
          <div className="rq-req-body">
            {tab === 'params' && (
              <>
                <KeyValueTable rows={request.params ?? []} onChange={(params) => update({ params })} />
                <p className="muted small">{t('request.paramsHint')}</p>
              </>
            )}
            {tab === 'headers' && <KeyValueTable rows={request.headers ?? []} onChange={(headers) => update({ headers })} keyPlaceholder="Header" />}
            {tab === 'auth' && (
              <AuthPanel
                auth={request.auth ?? { type: 'none' }}
                onChange={(auth) => update({ auth })}
                allowInherit
                inherited={api.collectionAuth}
                onOpenCollectionAuth={p.onOpenCollectionAuth}
                isDesktop={isDesktop}
                oauth2={{
                  token: api.tokens[api.tokenKey(request)],
                  onObtain: () => api.obtainToken(request.path),
                  onClear: () => api.clearToken(api.tokenKey(request)),
                }}
              />
            )}
            {tab === 'body' && <BodyPanel request={request} onChange={update} onSubmit={send} />}
            {tab === 'query' && <Code value={request.query ?? ''} onChange={(query) => update({ query })} onSubmit={send} minHeight={180} ariaLabel="GraphQL" />}
            {tab === 'variables' && <Code value={request.variables ?? '{}'} language="json" onChange={(variables) => update({ variables })} onSubmit={send} ariaLabel={t('request.tab.variables')} />}
          </div>
        </section>
        <section className="rq-res">
          <HttpResponseView result={result?.kind === 'http' ? result : undefined} sending={sending} isDesktop={isDesktop} />
        </section>
      </div>
    </>
  )
}

function GrpcEditor({ request, api, result, sending, isDesktop }: Props) {
  const [tab, setTab] = useState<'message' | 'metadata'>('message')
  const [resTab, setResTab] = useState<'response' | 'headers' | 'trailers'>('response')
  const [services, setServices] = useState<GrpcService[]>()
  const [describeError, setDescribeError] = useState<string>()
  const file = useRef<HTMLInputElement>(null)
  const update = (patch: Partial<SavedRequest>) => api.update(request.path, patch)
  const protoText = request.proto ? api.protos[request.proto] : undefined

  // Al elegir (o cambiar) el .proto se leen sus servicios y métodos.
  useEffect(() => {
    let cancelled = false
    if (!request.proto || !protoText || !isDesktop) return
    void api.describeProto(request.proto).then((r) => {
      if (cancelled) return
      if ('error' in r) {
        setServices(undefined)
        setDescribeError(r.error)
      } else {
        setServices(r.services)
        setDescribeError(undefined)
      }
    })
    return () => {
      cancelled = true
    }
    // Se vuelve a leer si cambia cualquier .proto (un import puede llegar después).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.proto, protoText, api.protos, isDesktop])

  const methods = services?.find((s) => s.name === request.service)?.methods ?? []
  const method = methods.find((m) => m.name === request.rpc)
  const grpc = result?.kind === 'grpc' ? result.result : undefined

  if (!isDesktop) {
    return <ResponseEmpty icon="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" title={t('request.grpc.desktopTitle')} text={t('request.grpc.desktopOnly')} />
  }
  return (
    <>
      <UrlBar
        left={<span className="rq-kind m-grpc">gRPC</span>}
        url={request.url}
        onUrl={(url) => update({ url })}
        placeholder="localhost:50051"
        action={
          <>
            <label className="rq-tls" title={t('request.grpc.tlsHint')}>
              <input type="checkbox" className="check" checked={!!request.tls} onChange={(e) => update({ tls: e.target.checked })} /> TLS
            </label>
            {sending ? (
              <button onClick={() => api.cancel(request.path)}>{t('common.cancel')}</button>
            ) : (
              <button className="primary rq-send" onClick={() => void api.send(request.path)} disabled={!request.url.trim() || !request.rpc}>
                {t('request.grpc.invoke')}
              </button>
            )}
          </>
        }
      />
      <div className="rq-grpc-pick">
        <label className="rq-field">
          <span>.proto</span>
          <select
            value={request.proto ?? ''}
            onChange={(e) => {
              if (e.target.value === '__import') file.current?.click()
              else update({ proto: e.target.value || undefined, service: undefined, rpc: undefined })
            }}
          >
            <option value="">{t('request.grpc.pickProto')}</option>
            {Object.keys(api.protos).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="__import">{t('request.grpc.importProto')}</option>
          </select>
        </label>
        <label className="rq-field">
          <span>{t('request.grpc.method')}</span>
          <select
            value={request.service && request.rpc ? `${request.service}/${request.rpc}` : ''}
            disabled={!services?.length}
            onChange={(e) => {
              const [service, rpc] = e.target.value.split('/')
              const m = services?.find((s) => s.name === service)?.methods.find((x) => x.name === rpc)
              const empty = !request.message?.trim() || request.message.trim() === '{}'
              update({ service, rpc, ...(m && empty ? { message: JSON.stringify(m.sample, null, 2) } : {}) })
            }}
          >
            <option value="">{services ? t('request.grpc.pickMethod') : '—'}</option>
            {services?.map((s) => (
              <optgroup key={s.name} label={s.name}>
                {s.methods.map((m) => (
                  <option key={m.name} value={`${s.name}/${m.name}`}>
                    {m.name}
                    {m.requestStream || m.responseStream ? ` (${[m.requestStream && 'client stream', m.responseStream && 'server stream'].filter(Boolean).join(', ')})` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <input
          ref={file}
          type="file"
          accept=".proto"
          multiple
          hidden
          onChange={async (e) => {
            const files = await readTextFiles([...(e.target.files ?? [])])
            e.target.value = ''
            // Se agregan todos (también los que importa el primero); se elige el primero.
            const added = files.map((f) => api.addProto(f.name, f.text))
            if (added.length) update({ proto: added[0], service: undefined, rpc: undefined })
          }}
        />
      </div>
      {describeError && <div className="callout err small rq-callout">{describeError}</div>}
      {method && (method.requestStream || method.responseStream) && <p className="muted small rq-note">{t('request.grpc.streamNote')}</p>}
      <div className="rq-split">
        <section className="rq-req">
          <div className="rq-req-tabs">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'message', label: t('request.grpc.message') },
                { id: 'metadata', label: 'Metadata', count: (request.headers ?? []).filter((r) => r.enabled && r.key).length },
              ]}
            />
            <span className="spacer" />
            {method && (
              <button className="small ghost" onClick={() => update({ message: JSON.stringify(method.sample, null, 2) })}>
                {t('request.grpc.useSample')}
              </button>
            )}
          </div>
          <div className="rq-req-body">
            {tab === 'message' ? (
              <Code value={request.message ?? '{}'} language="json" onChange={(message) => update({ message })} onSubmit={() => void api.send(request.path)} ariaLabel={t('request.grpc.message')} />
            ) : (
              <KeyValueTable rows={request.headers ?? []} onChange={(headers) => update({ headers })} keyPlaceholder="authorization" />
            )}
          </div>
        </section>
        <section className="rq-res">
          {sending ? (
            <div className="rq-res-empty">
              <span className="spinner" /> <span className="muted">{t('request.sending')}</span>
            </div>
          ) : !grpc ? (
            <ResponseEmpty title={t('request.res.emptyTitle')} text={t('request.grpc.emptyText')} />
          ) : !grpc.ok ? (
            <div className="rq-res-error">
              <strong>{t('request.res.failed')}</strong>
              <p>{grpc.error}</p>
            </div>
          ) : (
            <div className="rq-res-body">
              <div className="rq-res-meta">
                <span className={`rq-status ${grpc.code === 0 ? 's2' : 's4'}`}>
                  {grpc.code} {grpc.codeName}
                </span>
                <span className="muted small">{grpc.durationMs} ms</span>
                {grpc.messages.length > 1 && <span className="muted small">{t('request.grpc.messages', { n: grpc.messages.length })}</span>}
                <span className="spacer" />
                <CopyBtn text={() => JSON.stringify(grpc.messages.length === 1 ? grpc.messages[0] : grpc.messages, null, 2)} label={t('request.res.copyBody')} />
              </div>
              {grpc.code !== 0 && grpc.details && <p className="rq-grpc-details">{grpc.details}</p>}
              <div className="rq-res-tabs">
                <Tabs
                  value={resTab}
                  onChange={setResTab}
                  tabs={[
                    { id: 'response', label: t('request.grpc.response') },
                    { id: 'headers', label: 'Metadata', count: Object.keys(grpc.headers).length },
                    { id: 'trailers', label: 'Trailers', count: Object.keys(grpc.trailers).length },
                  ]}
                />
              </div>
              <div className="rq-res-content">
                {resTab === 'response' ? (
                  grpc.messages.length ? (
                    grpc.messages.map((m, i) => (
                      <div key={i} className="rq-grpc-msg">
                        {grpc.messages.length > 1 && <span className="muted small">#{i + 1}</span>}
                        <JsonView value={m} />
                      </div>
                    ))
                  ) : (
                    <p className="muted small">{t('request.grpc.noMessages')}</p>
                  )
                ) : (
                  <table className="rq-headers">
                    <tbody>
                      {Object.entries(resTab === 'headers' ? grpc.headers : grpc.trailers).map(([k, v]) => (
                        <tr key={k}>
                          <td>
                            <code>{k}</code>
                          </td>
                          <td>
                            <code>{v}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function WebSocketEditor({ request, api }: Props) {
  const conn = useWsConnection(request.path)
  const [selected, setSelected] = useState(0)
  const [filter, setFilter] = useState('')
  const update = (patch: Partial<SavedRequest>) => api.update(request.path, patch)
  const messages = request.messages?.length ? request.messages : [{ name: t('request.ws.message', { n: 1 }), text: '' }]
  const current = messages[Math.min(selected, messages.length - 1)]
  const open = conn.state === 'open'
  const connect = () => {
    // Las {{variables}} se resuelven al conectar; los params van en la URL.
    const vars = api.variables()
    const url = api.resolveUrl(request, vars)
    wsConnect(request.path, url)
  }
  const send = () => current.text && wsSend(request.path, api.resolveText(current.text))
  const setMessage = (patch: Partial<{ name: string; text: string }>) => update({ messages: messages.map((m, i) => (i === selected ? { ...m, ...patch } : m)) })
  const shown = conn.log.filter((e) => !filter || e.text.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <UrlBar
        left={
          <span className={`rq-kind m-ws ws-${conn.state}`}>
            <span className="ws-dot" /> WS
          </span>
        }
        url={request.url}
        onUrl={(url) => update({ url })}
        placeholder="wss://echo.websocket.org"
        action={
          conn.state === 'open' || conn.state === 'connecting' ? (
            <button className="rq-send danger-outline" onClick={() => wsDisconnect(request.path)}>
              {t('request.ws.disconnect')}
            </button>
          ) : (
            <button className="primary rq-send" onClick={connect} disabled={!/^wss?:\/\/.+/i.test(request.url.trim()) && !request.url.includes('{{')}>
              {t('request.ws.connect')}
            </button>
          )
        }
      />
      <div className="rq-split rq-ws">
        <section className="rq-req">
          <div className="rq-ws-messages">
            <div className="rq-ws-list">
              {messages.map((m, i) => (
                <button key={i} className={`rq-ws-item ${i === selected ? 'active' : ''}`} onClick={() => setSelected(i)}>
                  {m.name}
                </button>
              ))}
              <button
                className="rq-ws-item add"
                onClick={() => {
                  update({ messages: [...messages, { name: t('request.ws.message', { n: messages.length + 1 }), text: '' }] })
                  setSelected(messages.length)
                }}
              >
                + {t('request.ws.newMessage')}
              </button>
            </div>
            <div className="rq-ws-compose">
              <div className="rq-ws-compose-head">
                <input className="rq-ws-name" value={current.name} onChange={(e) => setMessage({ name: e.target.value })} aria-label={t('request.ws.messageName')} />
                {messages.length > 1 && (
                  <button
                    className="link small"
                    onClick={() => {
                      update({ messages: messages.filter((_, i) => i !== selected) })
                      setSelected(0)
                    }}
                  >
                    {t('studio.delete')}
                  </button>
                )}
                <span className="spacer" />
                <button className="primary small" disabled={!open || !current.text} onClick={send} title={open ? t('request.sendHint') : t('request.ws.connectFirst')}>
                  <Icon d={SEND_ICON} size={13} /> {t('request.send')}
                </button>
              </div>
              <Code value={current.text} language={/^\s*[[{]/.test(current.text) ? 'json' : 'text'} onChange={(text) => setMessage({ text })} onSubmit={send} minHeight={120} ariaLabel={t('request.ws.message', { n: selected + 1 })} />
              <p className="muted small">{t('request.ws.headersNote')}</p>
            </div>
          </div>
        </section>
        <section className="rq-res">
          <div className="rq-res-meta">
            <span className={`rq-status ${open ? 's2' : conn.state === 'connecting' ? 's3' : 's0'}`}>{t(`request.ws.state.${conn.state}`)}</span>
            {open && conn.openedAt && <span className="muted small">{t('request.ws.since', { time: timeOf(conn.openedAt) })}</span>}
            <span className="spacer" />
            <input className="rq-ws-filter" value={filter} placeholder={t('request.ws.filter')} onChange={(e) => setFilter(e.target.value)} />
            <button className="small ghost" onClick={() => wsClear(request.path)} disabled={!conn.log.length}>
              {t('request.ws.clear')}
            </button>
          </div>
          {conn.log.length === 0 ? (
            <ResponseEmpty title={t('request.ws.emptyTitle')} text={t('request.ws.emptyText')} />
          ) : (
            <ol className="rq-ws-log">
              {shown
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.id} className={`ws-${e.dir}`}>
                    <span className="ws-arrow" aria-hidden="true">
                      {e.dir === 'out' ? '↑' : e.dir === 'in' ? '↓' : e.dir === 'error' ? '!' : '•'}
                    </span>
                    <WsText text={e.text} />
                    <span className="muted small ws-time">{timeOf(e.at)}</span>
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>
    </>
  )
}

function WsText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const parsed = /^\s*[[{]/.test(text) ? parseJson(text) : { ok: false as const }
  if (parsed.ok && open) {
    return (
      <div className="ws-text grow" onClick={() => setOpen(false)}>
        <JsonView value={parsed.value} />
      </div>
    )
  }
  return (
    <code className={`ws-text grow ${parsed.ok ? 'expandable' : ''}`} onClick={() => parsed.ok && setOpen(true)} title={parsed.ok ? t('request.ws.expand') : undefined}>
      {text}
    </code>
  )
}

export function RequestView(p: Props) {
  const { request, api } = p
  const badge = requestBadge(request)
  return (
    <div className="rq" data-request={request.path}>
      <div className="rq-head">
        <span className={`method ${badge.cls}`}>{badge.text}</span>
        <input
          className="rq-name"
          value={request.name}
          onChange={(e) => api.update(request.path, { name: e.target.value })}
          onBlur={(e) => p.onRename?.(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={t('request.name')}
          spellCheck={false}
        />
        <span className="muted small rq-path" title={request.path}>
          {request.path}
        </span>
        <span className="spacer" />
        <button className="status-btn status-text rq-env" onClick={p.onOpenEnv} title={t('request.envHint')}>
          <EnvDot color={p.env.color} /> {p.env.name}
        </button>
      </div>
      {request.kind === 'grpc' ? <GrpcEditor {...p} /> : request.kind === 'websocket' ? <WebSocketEditor {...p} /> : <HttpRequestEditor {...p} />}
    </div>
  )
}
