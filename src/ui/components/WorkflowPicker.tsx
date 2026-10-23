// Selector de workflow: nombres legibles en columnas iguales, estado como ícono, buscador si son muchos
// y, opcionalmente, casillas para elegir cuáles se prueban.
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

/** Casillas para elegir qué workflows se prueban. */
export interface PickerSelection {
  isIncluded: (id: string) => boolean
  onToggle: (id: string, include: boolean) => void
  onAll: (include: boolean) => void
}

const FILTER_FROM = 7

function StatusIcon({ tone }: { tone: PickerTone }) {
  return (
    <span className={`wp-icon wp-${tone}`} aria-hidden="true">
      {tone === 'ok' ? '✓' : '!'}
    </span>
  )
}

export function WorkflowPicker({
  items,
  value,
  onChange,
  summary,
  selection,
}: {
  items: PickerItem[]
  value: string
  onChange: (id: string) => void
  summary: ReactNode
  selection?: PickerSelection
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const includedCount = selection ? items.filter((i) => selection.isIncluded(i.id)).length : items.length
  const shown = q ? items.filter((i) => [i.id, humanizeId(i.id), i.summary ?? ''].some((x) => x.toLowerCase().includes(q))) : items

  return (
    <div className="wp">
      <div className="wp-head">
        <span className="wp-heading">{t('picker.count', { n: items.length })}</span>
        <span className="wp-summary">{summary}</span>
        {selection && (
          <span className="wp-select">
            <span className={includedCount ? '' : 'wp-none'}>{t('picker.testing', { n: includedCount, total: items.length })}</span>
            <button className="link small" disabled={includedCount === items.length} onClick={() => selection.onAll(true)}>
              {t('picker.all')}
            </button>
            <button className="link small" disabled={includedCount === 0} onClick={() => selection.onAll(false)}>
              {t('picker.none')}
            </button>
          </span>
        )}
        {items.length >= FILTER_FROM && (
          <input className="wp-filter" type="search" value={query} placeholder={t('picker.filter')} aria-label={t('picker.filter')} onChange={(e) => setQuery(e.target.value)} />
        )}
      </div>
      <div className="wp-list">
        {shown.map((item) => {
          const included = selection ? selection.isIncluded(item.id) : true
          return (
            <div key={item.id} className={`wp-row ${item.id === value ? 'active' : ''} ${included ? '' : 'excluded'}`}>
              {selection && (
                <input
                  type="checkbox"
                  className="wp-check"
                  checked={included}
                  aria-label={t('picker.include', { name: humanizeId(item.id) })}
                  title={t('picker.include', { name: humanizeId(item.id) })}
                  onChange={(e) => selection.onToggle(item.id, e.target.checked)}
                />
              )}
              <button className="wp-item" aria-current={item.id === value || undefined} title={item.summary ? `${item.id} — ${item.summary}` : item.id} onClick={() => onChange(item.id)}>
                <StatusIcon tone={item.tone} />
                <span className="wp-text">
                  <span className="wp-name">{humanizeId(item.id)}</span>
                  {item.summary && <span className="wp-sub">{item.summary}</span>}
                </span>
                {item.meta && <span className={`wp-meta wp-meta-${item.tone}`}>{item.meta}</span>}
              </button>
            </div>
          )
        })}
        {shown.length === 0 && <p className="wp-empty">{t('picker.noMatch')}</p>}
      </div>
    </div>
  )
}
