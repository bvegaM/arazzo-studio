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

export function PageHeader({ step, title, description, actions }: { step: number; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{t('kit.stepOf', { step, total: 5 })}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function ActionBar({ left, right, info }: { left?: ReactNode; right?: ReactNode; info?: ReactNode }) {
  return (
    <div className="action-bar">
      <div className="action-bar-inner">
        <div>{left}</div>
        <div className="action-bar-info">{info}</div>
        <div className="row">{right}</div>
      </div>
    </div>
  )
}

export function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'err' | 'warn' }) {
  return (
    <div className={`metric ${tone ? `m-${tone}` : ''}`}>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
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
