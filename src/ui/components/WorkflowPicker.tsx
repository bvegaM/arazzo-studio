// Selector de workflow: nombres legibles en columnas iguales, estado como ícono y buscador si son muchos.
import { useState, type ReactNode } from 'react'
import { humanizeId } from '../../core/format'
import { t } from '../../i18n'

export type PickerTone = 'ok' | 'warn' | 'err'

export interface PickerItem {
  id: string
  /** Descripción corta del workflow (summary del Arazzo), en una segunda línea. */
  summary?: string
  tone: PickerTone
  /** Detalle corto a la derecha (ej. "Faltan 2" o "3 pasos"). */
  meta?: ReactNode
}

const FILTER_FROM = 7

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
  const shown = q ? items.filter((i) => [i.id, humanizeId(i.id), i.summary ?? ''].some((x) => x.toLowerCase().includes(q))) : items

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
          <button key={item.id} className={`wp-item ${item.id === value ? 'active' : ''}`} aria-current={item.id === value || undefined} title={item.summary ? `${item.id} — ${item.summary}` : item.id} onClick={() => onChange(item.id)}>
            <StatusIcon tone={item.tone} />
            <span className="wp-text">
              <span className="wp-name">{humanizeId(item.id)}</span>
              {item.summary && <span className="wp-sub">{item.summary}</span>}
            </span>
            {item.meta && <span className={`wp-meta wp-meta-${item.tone}`}>{item.meta}</span>}
          </button>
        ))}
        {shown.length === 0 && <p className="wp-empty">{t('picker.noMatch')}</p>}
      </div>
    </div>
  )
}
