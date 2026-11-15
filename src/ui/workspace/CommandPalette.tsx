// Buscador (⌘K / Ctrl+K): salta a un journey, un paso, un ambiente o una colección.
import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { EnvDot } from '../components/kit'

export interface PaletteItem {
  id: string
  /** Grupo en el que se muestra (Journeys, Pasos, Ambientes, Colecciones). */
  group: string
  label: string
  detail?: string
  /** Etiqueta a la izquierda (método HTTP, SEND/RECEIVE…). */
  badge?: { text: string; cls: string }
  envColor?: string
  run: () => void
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Coincide si todas las palabras buscadas aparecen en el texto (en cualquier orden). */
function matches(item: PaletteItem, query: string): boolean {
  const text = norm(`${item.label} ${item.detail ?? ''} ${item.badge?.text ?? ''} ${item.group}`)
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => text.includes(w))
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => items.filter((i) => matches(i, query)).slice(0, 60), [items, query])
  const current = Math.min(index, Math.max(shown.length - 1, 0))

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const choose = (item?: PaletteItem) => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={t('status.search')}>
        <input
          autoFocus
          value={query}
          placeholder={t('palette.placeholder')}
          aria-label={t('status.search')}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, shown.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(shown[current])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <div className="palette-list" ref={list} role="listbox">
          {shown.map((item, i) => (
            <div key={item.id}>
              {(i === 0 || shown[i - 1].group !== item.group) && <div className="palette-group">{item.group}</div>}
              <button
                role="option"
                aria-selected={i === current}
                className={i === current ? 'active' : ''}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(item)}
              >
                {item.badge && <span className={`method ${item.badge.cls}`}>{item.badge.text}</span>}
                {item.envColor !== undefined && <EnvDot color={item.envColor || undefined} />}
                <span className="grow clamp-1">{item.label}</span>
                {item.detail && <span className="muted small clamp-1 palette-detail">{item.detail}</span>}
              </button>
            </div>
          ))}
          {!shown.length && <p className="muted small palette-empty">{t('palette.empty')}</p>}
        </div>
        <div className="palette-foot muted small">{t('palette.keys')}</div>
      </div>
    </div>
  )
}
