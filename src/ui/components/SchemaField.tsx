/* eslint-disable @typescript-eslint/no-explicit-any */
// Campo de formulario que sigue el JSON Schema: los objetos se abren en sus propiedades y las listas en elementos.
import { useState } from 'react'
import { exampleValue, fieldKind, isEmptyValue, normalizeSchema, schemaType, setKey } from '../../core/schemaForm'
import { t } from '../../i18n'

interface Props {
  name: string
  schema: any
  required: boolean
  value: any
  onChange: (v: any) => void
  /** Si se marcan los obligatorios vacíos (no dentro de un objeto opcional que nadie empezó a llenar). */
  checkRequired?: boolean
}

export function SchemaField(p: Props) {
  const s = normalizeSchema(p.schema)
  const kind = fieldKind(s)
  if (kind === 'object') return <ObjectField {...p} schema={s} />
  if (kind === 'array') return <ArrayField {...p} schema={s} />
  return <LeafField {...p} schema={s} />
}

function Label({ name, required, type }: { name: string; required: boolean; type: string }) {
  return (
    <>
      <span>
        {name} {required && <span className="req">*</span>}
      </span>
      <span className="type">{type}</span>
    </>
  )
}

function ObjectField({ name, schema, required, value, onChange, checkRequired = true }: Props) {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  // Dentro de un objeto opcional vacío no se marcan sus obligatorios.
  const check = checkRequired && (required || obj !== undefined)
  const childRequired: string[] = schema.required ?? []
  return (
    <fieldset className={`field-group ${check && required && !obj ? 'missing' : ''}`}>
      <legend>
        <Label name={name} required={required} type="object" />
      </legend>
      {schema.description && <div className="hint">{schema.description}</div>}
      <div className="field-grid">
        {Object.entries<any>(schema.properties).map(([k, child]) => (
          <SchemaField
            key={k}
            name={k}
            schema={child}
            required={childRequired.includes(k)}
            value={obj?.[k]}
            checkRequired={check}
            onChange={(v) => onChange(setKey(obj, k, v))}
          />
        ))}
      </div>
    </fieldset>
  )
}

function ArrayField({ name, schema, required, value, onChange, checkRequired = true }: Props) {
  const list: any[] = Array.isArray(value) ? value : []
  const itemKind = fieldKind(schema.items)
  const update = (next: any[]) => onChange(next.length ? next : undefined)
  const add = () => update([...list, exampleValue(schema.items) ?? (itemKind === 'object' ? {} : '')])
  return (
    <fieldset className={`field-group ${checkRequired && required && !list.length ? 'missing' : ''}`}>
      <legend>
        <Label name={name} required={required} type={`array · ${list.length}`} />
      </legend>
      {schema.description && <div className="hint">{schema.description}</div>}
      <div className="array-items">
        {list.map((item, i) => (
          <div className="array-item" key={i}>
            <SchemaField
              name={t('params.item', { n: i + 1 })}
              schema={schema.items}
              required={false}
              value={item}
              checkRequired={checkRequired}
              onChange={(v) => update(list.map((x, n) => (n === i ? v : x)))}
            />
            <button className="link small muted-link" onClick={() => update(list.filter((_, n) => n !== i))}>
              {t('params.removeItem')}
            </button>
          </div>
        ))}
      </div>
      <button className="link small" onClick={add}>
        {t('params.addItem')}
      </button>
    </fieldset>
  )
}

function LeafField({ name, schema, required, value, onChange, checkRequired = true }: Props) {
  const kind = fieldKind(schema)
  const [raw, setRaw] = useState(() => (value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : ''))
  const [jsonError, setJsonError] = useState<string>()

  let control
  if (kind === 'enum') {
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
  } else if (kind === 'boolean') {
    control = (
      <select value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
        <option value="">{t('params.noValue')}</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  } else if (kind === 'number') {
    control = <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  } else if (kind === 'json') {
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
    <div className={`field ${checkRequired && required && isEmptyValue(value) ? 'missing' : ''}`}>
      <label>
        <Label name={name} required={required} type={kind === 'enum' ? 'enum' : (schemaType(schema) ?? 'any')} />
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
