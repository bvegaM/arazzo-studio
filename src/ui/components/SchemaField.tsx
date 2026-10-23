/* eslint-disable @typescript-eslint/no-explicit-any */
// Campo de formulario que sigue el JSON Schema: los objetos se abren en sus propiedades y las listas en elementos.
import { useState, type ReactNode } from 'react'
import { exampleValue, fieldKind, invalidPaths, isEmptyValue, leavesFirst, missingPaths, normalizeSchema, schemaType, setKey, typeLabel, validateValue, valueSummary } from '../../core/schemaForm'
import { t } from '../../i18n'
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
  invalid,
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
  /** Valores dentro del grupo que no cumplen el esquema. */
  invalid: number
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
    ) : invalid > 0 ? (
      <span className="badge b-warn">{t('params.invalidN', { n: invalid })}</span>
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
  return (
    <Group
      name={name}
      required={required}
      schema={schema}
      typeText={t('params.type.object')}
      missing={missing}
      invalid={obj ? invalidPaths(schema, obj).length : 0}
      empty={!obj}
      summary={valueSummary(obj)}
      depth={depth}
      extra={extra}
      markRequired={markRequired}
    >
      <ObjectFields schema={schema} value={obj} onChange={onChange} checkRequired={check} depth={depth + 1} />
    </Group>
  )
}

/** Las propiedades de un objeto como campos: simples en grilla y grupos a lo ancho. */
export function ObjectFields({ schema, value, onChange, checkRequired = true, depth = 1 }: { schema: any; value: any; onChange: (v: any) => void; checkRequired?: boolean; depth?: number }) {
  const s = normalizeSchema(schema)
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  const required: string[] = s.required ?? []
  return (
    <div className="field-grid">
      {leavesFirst(Object.entries<any>(s.properties ?? {})).map(([k, child]) => (
        <SchemaField
          key={k}
          name={k}
          schema={child}
          required={required.includes(k)}
          value={obj?.[k]}
          checkRequired={checkRequired}
          depth={depth}
          onChange={(v) => onChange(setKey(obj, k, v))}
        />
      ))}
    </div>
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
      invalid={invalidPaths(schema, list).length}
      empty={!list.length}
      summary={valueSummary(list)}
      depth={depth}
    >
      {list.length === 0 && <p className="fg-empty">{t('params.noItems')}</p>}
      {validateValue(schema, list) && <p className="field-warning">{validateValue(schema, list)}</p>}
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
              <div className={`arr-value ${validateValue(itemSchema, item) ? 'invalid' : ''}`}>
                <LeafControl schema={itemSchema} value={item} onChange={(v) => setItem(i, v)} label={t('params.item', { n: i + 1 })} invalid={!!validateValue(itemSchema, item)} />
                {validateValue(itemSchema, item) && <div className="field-warning">{validateValue(itemSchema, item)}</div>}
              </div>
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
  const error = jsonError ?? (missing ? t('params.requiredMsg') : undefined)
  const warning = error ? undefined : validateValue(schema, value)
  // Si el aviso ya nombra el patrón, no se repite en la ayuda.
  const showPattern = schema?.pattern && !warning?.includes(schema.pattern)
  const hint = [schema?.description, showPattern && t('params.pattern', { pattern: schema.pattern })].filter(Boolean).join(' · ')

  return (
    <div className={`field ${missing || jsonError ? 'missing' : warning ? 'invalid' : ''}`}>
      <label>
        <span>
          {name} {required && <span className="req">*</span>}
        </span>
        <TypeTag schema={schema} />
      </label>
      {fieldKind(schema) === 'json' ? (
        <JsonControl value={value} onChange={onChange} label={name} onError={setJsonError} />
      ) : (
        <LeafControl schema={schema} value={value} onChange={onChange} label={name} invalid={!!(error || warning)} />
      )}
      {error && <div className="field-error">{error}</div>}
      {warning && <div className="field-warning">{warning}</div>}
      {hint && (
        <div className="hint clamp" title={hint}>
          {hint}
        </div>
      )}
    </div>
  )
}
