// Selector de workflow: lista ordenada en columnas iguales, estado como ícono y buscador si son muchos.
import { Fragment, useState, type ReactNode } from 'react'
import { t } from '../../i18n'

export type PickerTone = 'ok' | 'warn' | 'err'

export interface PickerItem {
  id: string
  tone: PickerTone
  /** Detalle corto a la derecha (ej. "Faltan 2" o "3 pasos"). */
  meta?: ReactNode
}

const FILTER_FROM = 7

/** Corta los nombres camelCase en sus palabras para que salten de línea sin romper una palabra. */
function breakable(id: string): ReactNode {
  return id.split(/(?=[A-Z])|(?<=[_-])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ))
}

function StatusIcon({ tone }: { tone: PickerTone }) {
  return (
    <span className={`wp-icon wp-${tone}`} aria-hidden="true">
      {tone === 'ok' ? '✓' : '!'}
    </span>
  )
}

export function WorkflowPicker({ items, value, onChange, summary }: { items: PickerItem[]; value: string; onChange: (id: string) => void; summary: ReactNode }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter((i) => i.id.toLowerCase().includes(q)) : items

  return (
    <div className="wp">
      <div className="wp-head">
        <span className="wp-heading">{t('picker.count', { n: items.length })}</span>
        <span className="wp-summary">{summary}</span>
        {items.length >= FILTER_FROM && (
          <input className="wp-filter" type="search" value={query} placeholder={t('picker.filter')} aria-label={t('picker.filter')} onChange={(e) => setQuery(e.target.value)} />
        )}
      </div>
      <div className="wp-list">
        {shown.map((item) => (
          <button key={item.id} className={`wp-item ${item.id === value ? 'active' : ''}`} aria-current={item.id === value || undefined} title={item.id} onClick={() => onChange(item.id)}>
            <StatusIcon tone={item.tone} />
            <span className="wp-name">{breakable(item.id)}</span>
            {item.meta && <span className={`wp-meta wp-meta-${item.tone}`}>{item.meta}</span>}
          </button>
        ))}
        {shown.length === 0 && <p className="wp-empty">{t('picker.noMatch')}</p>}
      </div>
    </div>
  )
}
