// Menú "⋯" de una fila de la barra lateral: acciones como renombrar, mostrar en Finder o eliminar.
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'

export interface RowAction {
  label: string
  onSelect: () => void
  danger?: boolean
}

export function RowMenu({ actions, label = t('studio.more') }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`row-menu ${open ? 'open' : ''}`} ref={root}>
      <button
        type="button"
        className="icon-btn row-menu-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="19" cy="12" r="1.8" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="row-menu-list" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={a.danger ? 'danger' : ''}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                a.onSelect()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
