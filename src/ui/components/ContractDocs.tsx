/* eslint-disable @typescript-eslint/no-explicit-any */
// Documentación del contrato renderizada en vivo, al estilo de Swagger Editor / Swagger UI: info,
// servidores, seguridad, operaciones agrupadas por tag (con parámetros, body, respuestas y
// "Try it out") y los schemas. Para AsyncAPI: canales y operaciones send/receive con su mensaje.
import { useState, type ReactNode } from 'react'
import { getByPointer } from '../../core/jsonPointer'
import { exampleFromSchema } from '../../core/simulator'
import type { DocPath } from '../../core/contractLint'
import { t } from '../../i18n'
import { Chevron, Icon } from './kit'
import { Markdown as Md } from './Markdown'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Resuelve un $ref interno un solo nivel, conservando su nombre ("Member") para mostrarlo. */
function resolve(doc: any, node: any): { value: any; name?: string } {
  if (isObj(node) && typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
    const found = getByPointer(doc, node.$ref.slice(1))
    return { value: found.found ? found.value : node, name: node.$ref.split('/').pop() }
  }
  return { value: node }
}

/** Resuelve $ref internos en profundidad (para generar ejemplos). */
function deepResolve(doc: any, node: any, seen: string[] = []): any {
  if (Array.isArray(node)) return node.map((n) => deepResolve(doc, n, seen))
  if (!isObj(node)) return node
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
    if (seen.includes(node.$ref)) return {}
    return deepResolve(doc, resolve(doc, node).value, [...seen, node.$ref])
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deepResolve(doc, v, seen)]))
}

// --- Schemas ---

function typeOf(s: any): string {
  if (!isObj(s)) return ''
  const type = Array.isArray(s.type) ? s.type.join(' | ') : s.type
  if (type === 'array') return `array`
  if (s.oneOf) return 'oneOf'
  if (s.anyOf) return 'anyOf'
  if (s.allOf) return 'allOf'
  return [type ?? (s.properties ? 'object' : ''), s.format ? `(${s.format})` : ''].filter(Boolean).join(' ')
}

/** Un schema como árbol desplegable (como "Schema" en Swagger UI). */
export function SchemaTree({ doc, schema, depth = 0, name }: { doc: any; schema: any; depth?: number; name?: string }) {
  const { value: s, name: refName } = resolve(doc, schema)
  const [open, setOpen] = useState(depth < 1)
  if (!isObj(s)) return <span className="docs-type">{String(s ?? '')}</span>
  const label = name ?? refName
  const props = isObj(s.properties) ? Object.entries<any>(s.properties) : []
  const items = s.type === 'array' ? s.items : undefined
  const variants: any[] = s.oneOf ?? s.anyOf ?? s.allOf ?? []
  const nested = props.length > 0 || items || variants.length > 0
  if (depth > 6) return <span className="docs-type">{label ?? typeOf(s)}</span>
  return (
    <div className="docs-schema">
      <button className="docs-schema-head" onClick={() => nested && setOpen(!open)} disabled={!nested}>
        {nested && <Chevron open={open} />}
        {label && <strong>{label}</strong>}
        <span className="docs-type">
          {typeOf(s)}
          {items ? ` [${resolve(doc, items).name ?? typeOf(resolve(doc, items).value)}]` : ''}
        </span>
        {s.nullable && <span className="docs-flag">nullable</span>}
        {s.deprecated && <span className="docs-flag warn">deprecated</span>}
      </button>
      {s.description && depth === 0 && <Md text={s.description} />}
      {open && nested && (
        <div className="docs-schema-body">
          {props.map(([key, sub]) => {
            const r = resolve(doc, sub)
            const v = r.value
            const required = Array.isArray(s.required) && s.required.includes(key)
            const deep = isObj(v) && (isObj(v.properties) || v.type === 'array' || v.oneOf || v.anyOf || v.allOf)
            return (
              <div key={key} className="docs-prop">
                <div className="docs-prop-name">
                  <code>{key}</code>
                  {required && <span className="docs-req">*</span>}
                </div>
                <div className="docs-prop-info">
                  {deep ? (
                    <SchemaTree doc={doc} schema={sub} depth={depth + 1} />
                  ) : (
                    <span className="docs-type">
                      {r.name ? <strong>{r.name}</strong> : null} {typeOf(v)}
                    </span>
                  )}
                  {isObj(v) && v.description && <span className="muted small">{v.description}</span>}
                  {isObj(v) && Array.isArray(v.enum) && (
                    <span className="small">
                      <span className="muted">enum:</span> {v.enum.map((e: unknown) => <code key={String(e)}>{String(e)}</code>)}
                    </span>
                  )}
                  {isObj(v) && v.example !== undefined && (
                    <span className="small">
                      <span className="muted">{t('docs.example')}:</span> <code>{typeof v.example === 'object' ? JSON.stringify(v.example) : String(v.example)}</code>
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          {items && !props.length && <SchemaTree doc={doc} schema={items} depth={depth + 1} />}
          {variants.map((v, i) => (
            <div key={i} className="docs-variant">
              <span className="muted small">{s.oneOf ? 'oneOf' : s.anyOf ? 'anyOf' : 'allOf'} #{i + 1}</span>
              <SchemaTree doc={doc} schema={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Contenido de un body (petición o respuesta): pestañas "Ejemplo" y "Schema", como Swagger UI. */
function MediaView({ doc, content }: { doc: any; content: any }) {
  const types = isObj(content) ? Object.keys(content) : []
  const [type, setType] = useState(types[0])
  const [tab, setTab] = useState<'example' | 'schema'>('example')
  if (!types.length) return null
  const media = content[type ?? types[0]] ?? {}
  const first = media.example ?? Object.values<any>(media.examples ?? {})[0]?.value
  const example = first !== undefined ? first : media.schema ? exampleFromSchema(deepResolve(doc, media.schema)) : undefined
  return (
    <div className="docs-media">
      <div className="docs-media-bar">
        <button className={tab === 'example' ? 'active' : ''} onClick={() => setTab('example')}>
          {t('docs.exampleValue')}
        </button>
        <button className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')} disabled={!media.schema}>
          Schema
        </button>
        <span className="spacer" />
        {types.length > 1 ? (
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Content-Type">
            {types.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        ) : (
          <code className="muted small">{types[0]}</code>
        )}
      </div>
      {tab === 'example' ? (
        example !== undefined ? (
          <pre className="docs-pre">{typeof example === 'string' ? example : JSON.stringify(example, null, 2)}</pre>
        ) : (
          <p className="muted small">{t('docs.noExample')}</p>
        )
      ) : (
        <SchemaTree doc={doc} schema={media.schema} />
      )}
    </div>
  )
}

// --- Operaciones OpenAPI ---

interface OpProps {
  doc: any
  method: string
  route: string
  op: any
  pathItem: any
  onGoTo: (path: DocPath) => void
  renderTry?: (method: string, route: string) => ReactNode
}

function Operation({ doc, method, route, op, pathItem, onGoTo, renderTry }: OpProps) {
  const [open, setOpen] = useState(false)
  const [trying, setTrying] = useState(false)
  const params = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map((p: any) => resolve(doc, p).value).filter(isObj)
  const body = op.requestBody ? resolve(doc, op.requestBody).value : undefined
  const responses = isObj(op.responses) ? Object.entries<any>(op.responses) : []
  const secured = (op.security ?? doc.security ?? []).some((r: any) => isObj(r) && Object.keys(r).length)
  const tryNode = trying && renderTry ? renderTry(method, route) : null
  return (
    <div className={`docs-op op-${method} ${open ? 'open' : ''} ${op.deprecated ? 'deprecated' : ''}`}>
      <button className="docs-op-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`docs-verb m-${method}`}>{method.toUpperCase()}</span>
        <code className="docs-op-path">{route}</code>
        <span className="grow clamp-1 docs-op-summary">{op.summary}</span>
        {secured && (
          <span className="docs-lock" title={t('docs.secured')}>
            <Icon d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" size={13} />
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div className="docs-op-body">
          <div className="docs-op-tools">
            {op.operationId && (
              <span className="muted small">
                operationId: <code>{op.operationId}</code>
              </span>
            )}
            <span className="spacer" />
            <button className="link small" onClick={() => onGoTo(['paths', route, method])}>
              {t('docs.goToYaml')}
            </button>
            {renderTry && (
              <button className={`small ${trying ? '' : 'primary'}`} onClick={() => setTrying(!trying)}>
                {trying ? t('common.cancel') : t('docs.tryItOut')}
              </button>
            )}
          </div>
          {op.description && <Md text={op.description} />}
          {tryNode ? (
            <div className="docs-try">{tryNode}</div>
          ) : (
            <>
              <h5>{t('docs.parameters')}</h5>
              {params.length ? (
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>{t('docs.name')}</th>
                      <th>{t('docs.description')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {params.map((p) => {
                      const schema = resolve(doc, p.schema).value
                      return (
                        <tr key={`${p.in}:${p.name}`}>
                          <td className="docs-param-name">
                            <code>{p.name}</code>
                            {(p.required || p.in === 'path') && <span className="docs-req">* {t('docs.required')}</span>}
                            <span className="docs-type">{typeOf(schema)}</span>
                            <span className="muted small">({p.in})</span>
                          </td>
                          <td>
                            <Md text={p.description} />
                            {(p.example ?? schema?.example) !== undefined && (
                              <span className="small">
                                <span className="muted">{t('docs.example')}:</span> <code>{String(p.example ?? schema.example)}</code>
                              </span>
                            )}
                            {Array.isArray(schema?.enum) && (
                              <span className="small">
                                <span className="muted">enum:</span> {schema.enum.map((e: unknown) => <code key={String(e)}>{String(e)}</code>)}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">{t('docs.noParameters')}</p>
              )}
              {body && (
                <>
                  <h5>
                    {t('docs.requestBody')} {body.required && <span className="docs-req">* {t('docs.required')}</span>}
                  </h5>
                  <Md text={body.description} />
                  <MediaView doc={doc} content={body.content} />
                </>
              )}
            </>
          )}
          <h5>{t('docs.responses')}</h5>
          <table className="docs-table docs-responses">
            <thead>
              <tr>
                <th>{t('docs.code')}</th>
                <th>{t('docs.description')}</th>
              </tr>
            </thead>
            <tbody>
              {responses.map(([code, raw]) => {
                const r = resolve(doc, raw).value
                return (
                  <tr key={code}>
                    <td>
                      <strong className={`docs-code c${String(code)[0]}`}>{code}</strong>
                    </td>
                    <td>
                      <Md text={r?.description} />
                      {isObj(r?.content) && <MediaView doc={doc} content={r.content} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Section({ title, description, children, defaultOpen = true }: { title: ReactNode; description?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="docs-section">
      <button className="docs-section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="docs-section-title">{title}</span>
        {description && <span className="muted small clamp-1 grow">{description}</span>}
        <span className="spacer" />
        <Chevron open={open} />
      </button>
      {open && <div className="docs-section-body">{children}</div>}
    </section>
  )
}

function InfoHeader({ doc, version }: { doc: any; version: string }) {
  return (
    <header className="docs-info">
      <h2>
        {doc.info?.title ?? t('docs.untitled')} {doc.info?.version && <span className="docs-pill">{doc.info.version}</span>}{' '}
        <span className="docs-pill alt">{version}</span>
      </h2>
      <Md text={doc.info?.description} />
      <div className="docs-info-links small">
        {doc.info?.contact?.email && <span>{doc.info.contact.email}</span>}
        {doc.info?.license?.name && <span>{doc.info.license.name}</span>}
        {doc.externalDocs?.url && (
          <a href={doc.externalDocs.url} target="_blank" rel="noreferrer">
            {doc.externalDocs.description ?? doc.externalDocs.url}
          </a>
        )}
      </div>
    </header>
  )
}

function OpenApiDocs({ doc, onGoTo, renderTry, envServer, onOpenEnv }: Omit<Props, 'doc'> & { doc: any }) {
  // Operaciones agrupadas por tag, en el orden de "tags" y luego el de aparición; sin tag → "default".
  const groups = new Map<string, { method: string; route: string; op: any; pathItem: any }[]>()
  for (const tag of Array.isArray(doc.tags) ? doc.tags : []) if (tag?.name) groups.set(tag.name, [])
  for (const [route, rawItem] of Object.entries<any>(isObj(doc.paths) ? doc.paths : {})) {
    const pathItem = resolve(doc, rawItem).value
    if (!isObj(pathItem)) continue
    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!isObj(op)) continue
      const tags: string[] = Array.isArray(op.tags) && op.tags.length ? op.tags : ['default']
      for (const tag of tags) groups.set(tag, [...(groups.get(tag) ?? []), { method, route, op, pathItem }])
    }
  }
  const tagInfo = new Map<string, any>((Array.isArray(doc.tags) ? doc.tags : []).map((x: any) => [x?.name, x]))
  const schemes = isObj(doc.components?.securitySchemes) ? Object.entries<any>(doc.components.securitySchemes) : []
  const schemas = isObj(doc.components?.schemas) ? Object.entries<any>(doc.components.schemas) : []
  const servers: any[] = Array.isArray(doc.servers) ? doc.servers : []

  return (
    <>
      <InfoHeader doc={doc} version={doc.openapi ? `OAS ${doc.openapi}` : `Swagger ${doc.swagger}`} />
      <div className="docs-bar">
        <div className="docs-servers">
          <span className="muted small">{t('docs.servers')}</span>
          {servers.length ? (
            <select aria-label={t('docs.servers')}>
              {servers.map((s, i) => (
                <option key={i}>
                  {s.url}
                  {s.description ? ` — ${s.description}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted small">{t('docs.noServers')}</span>
          )}
          {envServer && (
            <span className="muted small">
              {t('docs.envServer')} <code>{envServer}</code>
            </span>
          )}
        </div>
        {schemes.length > 0 && (
          <button className="docs-authorize" onClick={onOpenEnv} title={t('docs.authorizeHint')}>
            <Icon d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" size={14} /> {t('docs.authorize')}
          </button>
        )}
      </div>
      {[...groups].filter(([, ops]) => ops.length).map(([tag, ops]) => (
        <Section key={tag} title={tag} description={tagInfo.get(tag)?.description}>
          {ops.map((o) => (
            <Operation key={`${o.method} ${o.route}`} doc={doc} {...o} onGoTo={onGoTo} renderTry={renderTry} />
          ))}
        </Section>
      ))}
      {!groups.size && <p className="muted">{t('docs.noOperations')}</p>}
      {schemas.length > 0 && (
        <Section title="Schemas" defaultOpen={false}>
          {schemas.map(([name, schema]) => (
            <div key={name} className="docs-model">
              <SchemaTree doc={doc} schema={schema} name={name} depth={1} />
            </div>
          ))}
        </Section>
      )}
    </>
  )
}

// --- AsyncAPI ---

function AsyncApiDocs({ doc, onGoTo }: { doc: any; onGoTo: (path: DocPath) => void }) {
  const v3 = /^3\./.test(String(doc.asyncapi))
  const ops: { id: string; action: string; channel: string; op: any; messages: any[]; path: DocPath }[] = []
  if (v3 && isObj(doc.operations)) {
    for (const [id, raw] of Object.entries<any>(doc.operations)) {
      const op = resolve(doc, raw).value
      const channel = resolve(doc, op?.channel).value
      const messages = (Array.isArray(op?.messages) && op.messages.length ? op.messages : Object.values(channel?.messages ?? {})).map((m: any) => resolve(doc, m))
      ops.push({ id, action: String(op?.action ?? '?'), channel: channel?.address ?? '', op, messages, path: ['operations', id] })
    }
  } else if (isObj(doc.channels)) {
    for (const [name, raw] of Object.entries<any>(doc.channels))
      for (const [kind, action] of [
        ['publish', 'send'],
        ['subscribe', 'receive'],
      ] as const)
        if (isObj(raw?.[kind])) {
          const msg = raw[kind].message
          const list = isObj(msg) && Array.isArray(msg.oneOf) ? msg.oneOf : msg ? [msg] : []
          ops.push({ id: raw[kind].operationId ?? `${kind} ${name}`, action, channel: name, op: raw[kind], messages: list.map((m: any) => resolve(doc, m)), path: ['channels', name, kind] })
        }
  }
  const servers = isObj(doc.servers) ? Object.entries<any>(doc.servers) : []
  return (
    <>
      <InfoHeader doc={doc} version={`AsyncAPI ${doc.asyncapi}`} />
      {servers.length > 0 && (
        <div className="docs-bar">
          <div className="docs-servers">
            <span className="muted small">{t('docs.servers')}</span>
            {servers.map(([name, s]) => (
              <code key={name} className="small">
                {name}: {s.host ?? s.url} ({s.protocol})
              </code>
            ))}
          </div>
        </div>
      )}
      <Section title={t('docs.operations')}>
        {ops.map((o) => (
          <AsyncOperation key={o.id} doc={doc} {...o} onGoTo={onGoTo} />
        ))}
        {!ops.length && <p className="muted">{t('docs.noOperations')}</p>}
      </Section>
    </>
  )
}

function AsyncOperation({ doc, id, action, channel, op, messages, path, onGoTo }: { doc: any; id: string; action: string; channel: string; op: any; messages: { value: any; name?: string }[]; path: DocPath; onGoTo: (p: DocPath) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`docs-op op-${action} ${open ? 'open' : ''}`}>
      <button className="docs-op-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`docs-verb m-${action}`}>{action.toUpperCase()}</span>
        <code className="docs-op-path">{channel}</code>
        <span className="grow clamp-1 docs-op-summary">{op?.summary ?? id}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className="docs-op-body">
          <div className="docs-op-tools">
            <span className="muted small">
              operation: <code>{id}</code>
            </span>
            <span className="spacer" />
            <button className="link small" onClick={() => onGoTo(path)}>
              {t('docs.goToYaml')}
            </button>
          </div>
          {op?.description && <Md text={op.description} />}
          {messages.map((m, i) => (
            <div key={i}>
              <h5>
                {t('docs.message')} {m.name && <code>{m.value?.name ?? m.name}</code>}
              </h5>
              <Md text={m.value?.summary ?? m.value?.description} />
              {m.value?.payload && <MediaView doc={doc} content={{ [m.value.contentType ?? doc.defaultContentType ?? 'application/json']: { schema: m.value.payload, examples: m.value.examples?.length ? Object.fromEntries(m.value.examples.map((e: any, n: number) => [n, { value: e.payload }])) : undefined } }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Componente público ---

interface Props {
  doc: any
  onGoTo: (path: DocPath) => void
  /** "Try it out" de una operación HTTP (lo arma quien conoce el ambiente). */
  renderTry?: (method: string, route: string) => ReactNode
  /** URL base de este contrato en el ambiente activo. */
  envServer?: string
  onOpenEnv: () => void
}

export function ContractDocs(p: Props) {
  const doc = p.doc
  if (!isObj(doc)) return <p className="muted docs-empty">{t('docs.unreadable')}</p>
  return (
    <div className="docs">
      {doc.openapi || doc.swagger ? (
        <OpenApiDocs {...p} doc={doc} />
      ) : doc.asyncapi ? (
        <AsyncApiDocs doc={doc} onGoTo={p.onGoTo} />
      ) : (
        // Archivo de schemas referenciado con $ref: cada clave de primer nivel es un schema.
        <Section title="Schemas">
          {Object.entries<any>(doc).map(([name, schema]) => (
            <div key={name} className="docs-model">
              <SchemaTree doc={doc} schema={schema} name={name} depth={1} />
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}
