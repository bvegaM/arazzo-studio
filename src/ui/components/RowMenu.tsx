// Menú "⋯" de una fila de la barra lateral: acciones como renombrar, mostrar en Finder o eliminar.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'
import { Icon } from './kit'

export interface RowAction {
  label: string
  onSelect: () => void
  danger?: boolean
  /** Trazo SVG del ícono (opcional), como en los menús de Bruno. */
  icon?: string
  /** Visible pero no disponible; `hint` explica por qué (p. ej. "solo en la app de escritorio"). */
  disabled?: boolean
  hint?: string
  /** Línea divisoria antes de esta opción. */
  separatorBefore?: boolean
}

export function RowMenu({
  actions,
  label = t('studio.more'),
  trigger,
  inline,
}: {
  actions: RowAction[]
  label?: string
  /** Contenido del botón (por defecto, los tres puntos). */
  trigger?: ReactNode
  /** En un encabezado (siempre visible), no flotando sobre una fila. */
  inline?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  // La lista va en un portal (fuera de la barra lateral) y se ubica junto al botón, siempre dentro
  // de la ventana: si no cabe abajo se abre hacia arriba.
  useLayoutEffect(() => {
    const el = list.current
    const btn = root.current?.querySelector('.row-menu-btn')?.getBoundingClientRect()
    if (!open || !el || !btn) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(btn.right - w, window.innerWidth - w - 8))
    const below = btn.bottom + 4
    const top = below + h > window.innerHeight - 8 ? Math.max(8, btn.top - 4 - h) : below
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node) && setOpen(false)
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`row-menu ${open ? 'open' : ''} ${inline ? 'inline' : ''}`} ref={root}>
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
        {trigger ?? (
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="19" cy="12" r="1.8" fill="currentColor" />
          </svg>
        )}
      </button>
      {open &&
        createPortal(
        <div className="row-menu-list portal" role="menu" ref={list} style={{ visibility: 'hidden' }}>
          {actions.map((a) => [
            a.separatorBefore ? <hr key={`${a.label}-sep`} /> : null,
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={a.danger ? 'danger' : ''}
              disabled={a.disabled}
              title={a.hint}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                a.onSelect()
              }}
            >
              {a.icon && <Icon d={a.icon} size={14} />}
              <span className="grow">{a.label}</span>
              {a.hint && a.disabled && <span className="row-menu-hint">{a.hint}</span>}
            </button>,
          ])}
        </div>,
          document.body,
        )}
    </div>
  )
}
