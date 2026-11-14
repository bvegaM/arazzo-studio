import { useState, type ReactNode } from 'react'
import { t } from '../../i18n'

/** Tarjeta plegable: el encabezado siempre visible, el contenido se muestra con un clic. */
export function Section({
  title,
  subtitle,
  badges,
  actions,
  defaultOpen = false,
  tone,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  defaultOpen?: boolean
  tone?: 'err' | 'warn'
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`section ${open ? 'open' : ''} ${tone ? `tone-${tone}` : ''}`}>
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Chevron open={open} />
          <span className="section-title">{title}</span>
          {badges && <span className="section-badges">{badges}</span>}
          {subtitle && !open && <span className="section-subtitle">{subtitle}</span>}
        </button>
        {actions && <div className="section-actions">{actions}</div>}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chevron ${open ? 'open' : ''}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: ReactNode; count?: number; tone?: 'err' | 'warn' | 'ok' }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className={`count ${t.tone ? `c-${t.tone}` : ''}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: ReactNode; hint?: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? 'active' : ''} onClick={() => onChange(o.id)} title={o.hint}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`pill ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  )
}

/** Ícono de línea (path SVG de 24×24) que toma el color del texto. */
export function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export const PENCIL_ICON = 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4'

/** Punto con el color de la etiqueta de un ambiente (vacío si no tiene). */
export function EnvDot({ color, title }: { color?: string; title?: string }) {
  return <span className={`env-dot ${color ? `c-${color}` : ''}`} title={title} aria-hidden={title ? undefined : true} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

/** Texto largo recortado a dos líneas, con botón para ver el resto. */
export function MoreText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 160
  return (
    <p className="more-text">
      <span className={!open && long ? 'clamp-2' : ''}>{text}</span>
      {long && (
        <button className="link small" onClick={() => setOpen(!open)}>
          {open ? t('kit.less') : t('kit.more')}
        </button>
      )}
    </p>
  )
}
