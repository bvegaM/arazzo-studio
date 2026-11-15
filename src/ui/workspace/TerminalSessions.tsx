// Varias terminales a la vez, con la lista de sesiones a la derecha (como VS Code): cambiar entre
// ellas, renombrarlas con doble clic y cerrarlas. Cada sesión sigue viva aunque no se esté viendo.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Icon } from '../components/kit'
import { TerminalView, type TerminalHandle, type TerminalInfo } from './TerminalView'

export interface SessionsHandle {
  add: () => void
  clear: () => void
}

/** Pedido de abrir una terminal (p. ej. "Abrir en terminal" de una colección). */
export interface TerminalRequest {
  n: number
  cwd?: string
}

interface Session {
  key: number
  /** Carpeta propia (si se abrió desde una colección); si no, la del workspace. */
  cwd?: string
  /** Nombre puesto por el usuario (si no, el de la shell). */
  name?: string
  info?: TerminalInfo
}

const TERMINAL_ICON = 'M4 17l6-6-6-6M12 19h8'
const TRASH_ICON = 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14'

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export const TerminalSessions = forwardRef<
  SessionsHandle,
  { cwd?: string; visible: boolean; onActiveInfo: (info?: TerminalInfo) => void; request?: TerminalRequest }
>(function TerminalSessions({ cwd, visible, onActiveInfo, request }, ref) {
  const next = useRef(2)
  // Si el panel se abrió por un pedido, la primera sesión ya nace en esa carpeta.
  const [sessions, setSessions] = useState<Session[]>([{ key: 1, cwd: request?.cwd }])
  const handled = useRef(request?.n ?? 0)
  const [active, setActive] = useState(1)
  const [renaming, setRenaming] = useState<number>()
  const views = useRef(new Map<number, TerminalHandle>())
  // Cada terminal avisa (info, salida) con lo que tenía al abrirse: estas referencias dan lo actual.
  const latest = useRef({ sessions, active })
  useLayoutEffect(() => {
    latest.current = { sessions, active }
  })

  const select = (key: number, list = sessions) => {
    setActive(key)
    onActiveInfo(list.find((s) => s.key === key)?.info)
  }
  const add = (dir?: string) => {
    const key = next.current++
    setSessions((prev) => [...prev, { key, cwd: dir }])
    setActive(key)
    onActiveInfo(undefined)
  }
  const close = (key: number) => {
    const { sessions: current, active: shown } = latest.current
    const rest = current.filter((s) => s.key !== key)
    latest.current = { sessions: rest, active: shown }
    setSessions(rest)
    views.current.delete(key)
    if (key === shown) {
      const fallback = rest[rest.length - 1]
      if (fallback) select(fallback.key, rest)
      else onActiveInfo(undefined)
    }
  }
  useImperativeHandle(ref, () => ({ add: () => add(), clear: () => views.current.get(active)?.clear() }))
  // Un pedido nuevo abre otra sesión en su carpeta.
  useEffect(() => {
    if (!request || request.n <= handled.current) return
    handled.current = request.n
    add(request.cwd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n])

  const label = (s: Session, i: number) => s.name ?? `${s.info?.shell ?? t('dev.term.shell')} ${i + 1}`

  if (!sessions.length) {
    return (
      <div className="dev-empty">
        <Icon d={TERMINAL_ICON} size={26} />
        <strong>{t('dev.term.none')}</strong>
        <button className="small primary" onClick={() => add()}>
          {t('dev.term.new')}
        </button>
      </div>
    )
  }

  return (
    <div className="term-sessions">
      <div className="term-views">
        {sessions.map((s) => (
          <div key={s.key} className="term-view" hidden={s.key !== active}>
            <TerminalView
              ref={(h) => {
                if (h) views.current.set(s.key, h)
              }}
              cwd={s.cwd ?? cwd}
              visible={visible && s.key === active}
              onInfo={(info) => {
                setSessions((prev) => prev.map((x) => (x.key === s.key ? { ...x, info } : x)))
                if (s.key === latest.current.active) onActiveInfo(info)
              }}
              onExit={() => close(s.key)}
            />
          </div>
        ))}
      </div>
      <ul className="term-list" aria-label={t('dev.term.sessions')}>
        {sessions.map((s, i) => (
          <li key={s.key} className={s.key === active ? 'active' : ''}>
            {renaming === s.key ? (
              <input
                autoFocus
                defaultValue={label(s, i)}
                aria-label={t('studio.rename')}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  const name = e.target.value.trim()
                  setSessions((prev) => prev.map((x) => (x.key === s.key ? { ...x, name: name || undefined } : x)))
                  setRenaming(undefined)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(undefined)
                }}
              />
            ) : (
              <button
                className="term-item"
                onClick={() => select(s.key)}
                onDoubleClick={() => setRenaming(s.key)}
                title={`${s.info ? `${s.info.shell} · ${s.info.cwd}` : ''}\n${t('dev.term.renameHint')}`}
              >
                <Icon d={TERMINAL_ICON} size={12} />
                <span className="grow clamp-1">{label(s, i)}</span>
                {s.info && <span className="muted clamp-1 term-folder">{folderName(s.info.cwd)}</span>}
              </button>
            )}
            <button className="icon-btn danger term-kill" onClick={() => close(s.key)} title={t('dev.term.kill')} aria-label={t('dev.term.kill')}>
              <Icon d={TRASH_ICON} size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
})
