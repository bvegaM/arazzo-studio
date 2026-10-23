/* eslint-disable @typescript-eslint/no-explicit-any */
// Campo de formulario que sigue el JSON Schema: los objetos se abren en sus propiedades y las listas en elementos.
import { useState, type ReactNode } from 'react'
import { exampleValue, fieldKind, isEmptyValue, leavesFirst, missingPaths, normalizeSchema, schemaType, setKey, valueSummary } from '../../core/schemaForm'
import { t, type MessageKey } from '../../i18n'
import { Chevron, Segmented } from './kit'

interface Props {
  name: string
  schema: any
  required: boolean
  value: any
  onChange: (v: any) => void
  /** Si se marcan los obligatorios vacíos (no dentro de un objeto opcional que nadie empezó a llenar). */
  checkRequired?: boolean
  /** Profundidad en el árbol: los grupos de primer nivel son tarjetas, los internos ramas. */
  depth?: number
}

export function SchemaField(p: Props) {
  const s = normalizeSchema(p.schema)
  const kind = fieldKind(s)
  if (kind === 'object') return <ObjectField {...p} schema={s} />
  if (kind === 'array') return <ArrayField {...p} schema={s} />
  return <LeafField {...p} schema={s} />
}

/** Nombre del tipo en lenguaje normal; el tipo técnico queda en el tooltip. */
function typeLabel(schema: any): string {
  const kind = fieldKind(schema)
  const raw = schemaType(schema)
  const key = kind === 'enum' || kind === 'json' ? kind : (raw ?? 'any')
  const label = t(`params.type.${key}` as MessageKey)
  return schema?.format ? `${label} · ${schema.format}` : label
}

function TypeTag({ schema }: { schema: any }) {
  return (
    <span className="type plain" title={schema?.format ? `${schemaType(schema)} (${schema.format})` : schemaType(schema)}>
      {typeLabel(schema)}
    </span>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn" onClick={onClick} title={t('params.removeItem')} aria-label={t('params.removeItem')}>
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/** Grupo plegable: encabezado con estado (falta, listo, vacío) y resumen cuando está cerrado. */
function Group({
  name,
  required,
  schema,
  typeText,
  missing,
  empty,
  summary,
  depth,
  extra,
  markRequired = true,
  children,
}: {
  name: string
  required: boolean
  schema: any
  typeText: string
  missing: number
  empty: boolean
  summary: string
  depth: number
  extra?: ReactNode
  markRequired?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(depth === 0 || missing > 0)
  const status =
    missing > 0 ? (
      <span className="badge b-err">{t('params.missingN', { n: missing })}</span>
    ) : empty ? (
      !required && <span className="badge b-skip">{t('params.groupEmpty')}</span>
    ) : (
      <span className="badge b-ok">✓ {t('params.groupDone')}</span>
    )
  return (
    <div className={`fg ${depth === 0 ? 'fg-root' : 'fg-branch'} ${missing > 0 ? 'fg-missing' : ''}`}>
      <div className="fg-head">
        <button className="fg-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Chevron open={open} />
          <span className="fg-name">
            {name}
            {required && markRequired && <span className="req"> *</span>}
          </span>
          <span className="fg-type" title={schemaType(schema)}>
            {typeText}
          </span>
          {!open && summary && <span className="fg-summary">{summary}</span>}
          <span className="fg-status">{status}</span>
        </button>
        {extra}
      </div>
      {open && (
        <div className="fg-body">
          {schema.description && <p className="fg-desc">{schema.description}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

function ObjectField({ name, schema, required, value, onChange, checkRequired = true, depth = 0, extra, markRequired }: Props & { extra?: ReactNode; markRequired?: boolean }) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  // Dentro de un objeto opcional vacío no se marcan sus obligatorios.
  const check = checkRequired && (required || obj !== undefined)
  const missing = check ? (obj ? missingPaths(schema, obj).length : required ? 1 : 0) : 0
  const childRequired: string[] = schema.required ?? []
  return (
    <Group
      name={name}
      required={required}
      schema={schema}
      typeText={t('params.type.object')}
      missing={missing}
      empty={!obj}
      summary={valueSummary(obj)}
      depth={depth}
      extra={extra}
      markRequired={markRequired}
    >
      <div className="field-grid">
        {leavesFirst(Object.entries<any>(schema.properties)).map(([k, child]) => (
          <SchemaField
            key={k}
            name={k}
            schema={child}
            required={childRequired.includes(k)}
            value={obj?.[k]}
            checkRequired={check}
            depth={depth + 1}
            onChange={(v) => onChange(setKey(obj, k, v))}
          />
        ))}
      </div>
    </Group>
  )
}

function ArrayField({ name, schema, required, value, onChange, checkRequired = true, depth = 0 }: Props) {
  const list: any[] = Array.isArray(value) ? value : []
  const itemSchema = normalizeSchema(schema.items)
  const itemKind = fieldKind(itemSchema)
  const update = (next: any[]) => onChange(next.length ? next : undefined)
  const add = () => update([...list, exampleValue(itemSchema) ?? (itemKind === 'object' ? {} : '')])
  const remove = (i: number) => update(list.filter((_, n) => n !== i))
  const setItem = (i: number, v: any) => update(list.map((x, n) => (n === i ? v : x)))
  const missing = checkRequired ? (list.length ? missingPaths({ type: 'object', properties: { x: schema } }, { x: list }).length : required ? 1 : 0) : 0
  const groupItems = itemKind === 'object' || itemKind === 'array'

  return (
    <Group
      name={name}
      required={required}
      schema={schema}
      typeText={`${t('params.type.array')} · ${t('params.itemCount', { n: list.length })}`}
      missing={missing}
      empty={!list.length}
      summary={valueSummary(list)}
      depth={depth}
    >
      {list.length === 0 && <p className="fg-empty">{t('params.noItems')}</p>}
      <div className="arr-items">
        {list.map((item, i) =>
          groupItems ? (
            itemKind === 'object' ? (
              <ObjectField
                key={i}
                name={t('params.item', { n: i + 1 })}
                schema={itemSchema}
                required
                value={item}
                checkRequired={checkRequired}
                depth={depth + 1}
                onChange={(v) => setItem(i, v)}
                extra={<RemoveButton onClick={() => remove(i)} />}
                markRequired={false}
              />
            ) : (
              <div className="arr-row" key={i}>
                <SchemaField name={t('params.item', { n: i + 1 })} schema={itemSchema} required={false} value={item} checkRequired={checkRequired} depth={depth + 1} onChange={(v) => setItem(i, v)} />
                <RemoveButton onClick={() => remove(i)} />
              </div>
            )
          ) : (
            <div className="arr-row" key={i}>
              <span className="arr-index">{i + 1}</span>
              <LeafControl schema={itemSchema} value={item} onChange={(v) => setItem(i, v)} label={t('params.item', { n: i + 1 })} />
              <RemoveButton onClick={() => remove(i)} />
            </div>
          ),
        )}
      </div>
      <button className="add-btn" onClick={add}>
        + {t('params.addTo', { name })}
      </button>
    </Group>
  )
}

/** El control de entrada según el tipo, sin etiqueta ni mensajes. */
function LeafControl({ schema, value, onChange, label, invalid }: { schema: any; value: any; onChange: (v: any) => void; label: string; invalid?: boolean }) {
  const kind = fieldKind(schema)
  const example = schema?.example ?? schema?.examples?.[0]
  const placeholder = example !== undefined && typeof example !== 'object' ? t('params.example', { value: String(example) }) : undefined
  const common = { 'aria-label': label, 'aria-invalid': invalid || undefined }

  if (kind === 'enum') {
    return (
      <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : schema.enum.find((v: any) => String(v) === e.target.value))}>
        <option value="">{t('params.noValue')}</option>
        {schema.enum.map((v: any) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    )
  }
  if (kind === 'boolean') {
    return (
      <Segmented
        options={[
          { id: '', label: '—', hint: t('params.noValue') },
          { id: 'true', label: t('params.yes'), hint: 'true' },
          { id: 'false', label: t('params.no'), hint: 'false' },
        ]}
        value={value === undefined ? '' : String(value)}
        onChange={(v) => onChange(v === '' ? undefined : v === 'true')}
      />
    )
  }
  if (kind === 'number') {
    return (
      <input
        {...common}
        type="number"
        step={schemaType(schema) === 'integer' ? 1 : 'any'}
        min={schema.minimum}
        max={schema.maximum}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  }
  const inputType = schema?.format === 'email' ? 'email' : schema?.format === 'uri' ? 'url' : 'text'
  return <input {...common} type={inputType} placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)} />
}

function JsonControl({ value, onChange, label, onError }: { value: any; onChange: (v: any) => void; label: string; onError: (e?: string) => void }) {
  const [raw, setRaw] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  return (
    <textarea
      aria-label={label}
      rows={3}
      placeholder={t('params.jsonPlaceholder')}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => {
        if (raw.trim() === '') {
          onError(undefined)
          return onChange(undefined)
        }
        try {
          onChange(JSON.parse(raw))
          onError(undefined)
        } catch {
          onError(t('params.invalidJson'))
        }
      }}
    />
  )
}

function LeafField({ name, schema, required, value, onChange, checkRequired = true }: Props) {
  const [jsonError, setJsonError] = useState<string>()
  const missing = checkRequired && required && isEmptyValue(value)
  const hint = [schema?.description, schema?.pattern && t('params.pattern', { pattern: schema.pattern })].filter(Boolean).join(' · ')
  const error = jsonError ?? (missing ? t('params.requiredMsg') : undefined)

  return (
    <div className={`field ${missing || jsonError ? 'missing' : ''}`}>
      <label>
        <span>
          {name} {required && <span className="req">*</span>}
        </span>
        <TypeTag schema={schema} />
      </label>
      {fieldKind(schema) === 'json' ? (
        <JsonControl value={value} onChange={onChange} label={name} onError={setJsonError} />
      ) : (
        <LeafControl schema={schema} value={value} onChange={onChange} label={name} invalid={!!error} />
      )}
      {error && <div className="field-error">{error}</div>}
      {hint && (
        <div className="hint clamp" title={hint}>
          {hint}
        </div>
      )}
    </div>
  )
}
