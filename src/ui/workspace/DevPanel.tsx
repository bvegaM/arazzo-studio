// Panel de desarrollo (como el de Bruno): Console, Network y Performance de la sesión.
// Todo lo que muestra ya viene con los secretos tapados.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { toCurl } from '../../core/curl'
import { t } from '../../i18n'
import { desktop, type AppMetrics } from '../../lib/desktop'
import { clearLogs, clearNetwork, useDevLog, type LogEntry, type LogLevel, type NetworkEntry } from '../../lib/devlog'
import { Icon } from '../components/kit'
import { TerminalSessions, type SessionsHandle } from './TerminalSessions'
import type { TerminalInfo } from './TerminalView'

export type DevTab = 'console' | 'network' | 'performance' | 'terminal'

const ICONS = {
  console: 'M4 17l6-6-6-6M12 19h8',
  network: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  performance: 'M12 14l4-4M3.5 18a10 10 0 1 1 17 0',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  close: 'M6 6l12 12M18 6L6 18',
  inspect: 'M4 4h16v12H4zM8 20h8',
  terminal: 'M3 5h18v14H3zM7 10l3 2-3 2M12 15h5',
  plus: 'M12 5v14M5 12h14',
}

const HEIGHT_KEY = 'dev.height'

function savedHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY))
    return n >= 140 ? n : 280
  } catch {
    return 280
  }
}

const clock = (time: number) => {
  const d = new Date(time)
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function formatBytes(n?: number): string {
  if (n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function formatUptime(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

const pretty = (v: unknown) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2))

// --- Console ---

function ConsoleTab({ logs, level }: { logs: LogEntry[]; level: LogLevel | 'all' }) {
  const shown = level === 'all' ? logs : logs.filter((l) => l.level === level)
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const box = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  // Sigue al final mientras llegan líneas, salvo que el usuario haya subido a leer.
  useLayoutEffect(() => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown.length])
  if (!shown.length) {
    return (
      <div className="dev-empty">
        <Icon d={ICONS.console} size={26} />
        <strong>{t('dev.console.empty')}</strong>
        <span className="muted small">{t('dev.console.emptyHint')}</span>
      </div>
    )
  }
  return (
    <div
      className="dev-scroll dev-console"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {shown.map((l) => (
        <div key={l.id} className={`dev-log lvl-${l.level}`}>
          <span className="dev-time">{clock(l.time)}</span>
          <span className={`dev-src src-${l.source}`}>{t(`dev.source.${l.source}`)}</span>
          <span className="dev-msg">
            {l.detail ? (
              <button className="link" onClick={() => setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))} aria-expanded={!!open[l.id]}>
                {open[l.id] ? '▾' : '▸'} {l.message}
              </button>
            ) : (
              l.message
            )}
            {l.detail && open[l.id] && <pre>{l.detail}</pre>}
          </span>
        </div>
      ))}
    </div>
  )
}

// --- Network ---

function Headers({ headers }: { headers: Record<string, unknown> }) {
  const entries = Object.entries(headers)
  if (!entries.length) return <p className="muted small">{t('dev.net.noHeaders')}</p>
  return (
    <dl className="dev-headers">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function NetworkDetail({ entry, onClose }: { entry: NetworkEntry; onClose: () => void }) {
  const [tab, setTab] = useState<'request' | 'response'>(entry.response ? 'response' : 'request')
  const [copied, setCopied] = useState(false)
  const copyCurl = async () => {
    const headers = Object.fromEntries(Object.entries(entry.request.headers).map(([k, v]) => [k, String(v)]))
    await navigator.clipboard.writeText(toCurl({ method: entry.method, url: entry.url, headers, body: entry.request.body }))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const part = tab === 'request' ? entry.request : entry.response
  return (
    <div className="dev-detail">
      <div className="dev-detail-head">
        <span className={`method m-${entry.method.toLowerCase()}`}>{entry.method}</span>
        <span className="grow clamp-1 dev-url" title={entry.url}>
          {entry.url}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
          <Icon d={ICONS.close} size={13} />
        </button>
      </div>
      <dl className="dev-general">
        <div>
          <dt>{t('dev.net.status')}</dt>
          <dd className={entry.failed ? 'err' : 'ok'}>{entry.status ? `${entry.status} ${entry.statusText ?? ''}` : entry.kind === 'message' ? (entry.failed ? '✕' : '✓') : t('dev.net.noResponse')}</dd>
        </div>
        <div>
          <dt>{t('dev.net.time')}</dt>
          <dd>{entry.durationMs !== undefined ? `${Math.round(entry.durationMs)} ms` : '—'}</dd>
        </div>
        <div>
          <dt>{t('dev.net.size')}</dt>
          <dd>{formatBytes(entry.size)}</dd>
        </div>
        <div>
          <dt>{t('dev.net.step')}</dt>
          <dd>
            {entry.step} · {entry.journey}
          </dd>
        </div>
        <div>
          <dt>{t('dev.net.case')}</dt>
          <dd>
            {entry.caseName}
            {entry.simulated && <span className="dev-sim">{t('common.simulated')}</span>}
          </dd>
        </div>
      </dl>
      <div className="dev-detail-tabs">
        <button className={tab === 'request' ? 'active' : ''} onClick={() => setTab('request')}>
          {t(entry.kind === 'message' ? 'dev.net.sent' : 'dev.net.request')}
        </button>
        <button className={tab === 'response' ? 'active' : ''} onClick={() => setTab('response')} disabled={!entry.response}>
          {t(entry.kind === 'message' ? 'dev.net.received' : 'dev.net.response')}
        </button>
        <span className="spacer" />
        {entry.kind === 'http' && (
          <button className="small" onClick={() => void copyCurl()}>
            {copied ? `✓ ${t('dev.net.copied')}` : t('dev.net.copyCurl')}
          </button>
        )}
      </div>
      {part ? (
        <>
          <h4>{t('dev.net.headers')}</h4>
          <Headers headers={part.headers} />
          <h4>{t('dev.net.body')}</h4>
          {part.body === undefined || part.body === '' ? <p className="muted small">{t('dev.net.noBody')}</p> : <pre className="dev-body-pre">{pretty(part.body)}</pre>}
        </>
      ) : (
        <p className="muted small">{t('dev.net.noResponse')}</p>
      )}
    </div>
  )
}

function NetworkTab({ entries, filter }: { entries: NetworkEntry[]; filter: string }) {
  const [selected, setSelected] = useState<number>()
  const q = filter.trim().toLowerCase()
  const shown = q ? entries.filter((e) => `${e.method} ${e.url} ${e.status ?? ''} ${e.step} ${e.journey} ${e.caseName}`.toLowerCase().includes(q)) : entries
  const current = entries.find((e) => e.id === selected)
  if (!entries.length) {
    return (
      <div className="dev-empty">
        <Icon d={ICONS.network} size={26} />
        <strong>{t('dev.net.empty')}</strong>
        <span className="muted small">{t('dev.net.emptyHint')}</span>
      </div>
    )
  }
  return (
    <div className={`dev-network ${current ? 'with-detail' : ''}`}>
      <div className="dev-scroll">
        <table className="dev-table">
          <thead>
            <tr>
              <th>{t('dev.net.status')}</th>
              <th>{t('dev.net.method')}</th>
              <th>URL</th>
              <th>{t('dev.net.step')}</th>
              <th className="num">{t('dev.net.time')}</th>
              <th className="num">{t('dev.net.size')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className={`${e.id === selected ? 'active' : ''} ${e.failed ? 'failed' : ''}`} onClick={() => setSelected(e.id === selected ? undefined : e.id)}>
                <td className={e.failed ? 'err' : 'ok'}>{e.status ?? (e.kind === 'message' ? (e.failed ? '✕' : '✓') : '—')}</td>
                <td>
                  <span className={`method m-${e.method.toLowerCase()}`}>{e.method}</span>
                </td>
                <td className="dev-url" title={e.url}>
                  {e.url}
                  {e.simulated && <span className="dev-sim">{t('common.simulated')}</span>}
                </td>
                <td className="muted">{e.step}</td>
                <td className="num">{e.durationMs !== undefined ? `${Math.round(e.durationMs)} ms` : '—'}</td>
                <td className="num muted">{formatBytes(e.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="muted small dev-pad">{t('dev.net.noMatch')}</p>}
      </div>
      {current && <NetworkDetail key={current.id} entry={current} onClose={() => setSelected(undefined)} />}
    </div>
  )
}

// --- Performance ---

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="dev-card">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      <span className="muted small">{hint}</span>
    </div>
  )
}

function PerformanceTab({ entries }: { entries: NetworkEntry[] }) {
  const [metrics, setMetrics] = useState<AppMetrics>()
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const tick = () => {
      setNow(performance.now())
      if (desktop) void desktop.appMetrics().then(setMetrics)
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => clearInterval(timer)
  }, [])
  // Tiempos de la sesión por paso: cuántas veces se llamó, promedio y máximo (sin los simulados).
  const timing = useMemo(() => {
    const groups = new Map<string, { journey: string; step: string; method: string; times: number[]; failed: number }>()
    for (const e of entries) {
      if (e.simulated || e.durationMs === undefined) continue
      const key = `${e.journey}\u0000${e.step}`
      const g = groups.get(key) ?? { journey: e.journey, step: e.step, method: e.method, times: [], failed: 0 }
      g.times.push(e.durationMs)
      if (e.failed) g.failed++
      groups.set(key, g)
    }
    return [...groups.values()].map((g) => ({ ...g, avg: g.times.reduce((a, b) => a + b, 0) / g.times.length, max: Math.max(...g.times) })).sort((a, b) => b.avg - a.avg)
  }, [entries])
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
  return (
    <div className="dev-scroll dev-perf">
      <h4>{t('dev.perf.resources')}</h4>
      <div className="dev-cards">
        {metrics ? (
          <>
            <Card label={t('dev.perf.cpu')} value={`${metrics.cpu.toFixed(1)}%`} hint={t('dev.perf.cpuHint')} />
            <Card label={t('dev.perf.memory')} value={formatBytes(metrics.memory)} hint={t('dev.perf.memoryHint', { n: metrics.processes.length })} />
            <Card label={t('dev.perf.uptime')} value={formatUptime(metrics.uptime)} hint={t('dev.perf.uptimeHint')} />
            <Card label="PID" value={String(metrics.pid)} hint={t('dev.perf.pidHint')} />
          </>
        ) : (
          <>
            {heap !== undefined && <Card label={t('dev.perf.heap')} value={formatBytes(heap)} hint={t('dev.perf.heapHint')} />}
            <Card label={t('dev.perf.uptime')} value={formatUptime(now / 1000)} hint={t('dev.perf.pageHint')} />
            <p className="muted small dev-web-note">{t('dev.perf.webNote')}</p>
          </>
        )}
      </div>
      <h4>{t('dev.perf.timing')}</h4>
      {timing.length ? (
        <table className="dev-table">
          <thead>
            <tr>
              <th>{t('dev.net.step')}</th>
              <th>Journey</th>
              <th className="num">{t('dev.perf.calls')}</th>
              <th className="num">{t('dev.perf.avg')}</th>
              <th className="num">{t('dev.perf.max')}</th>
              <th className="num">{t('dev.perf.failed')}</th>
            </tr>
          </thead>
          <tbody>
            {timing.map((g) => (
              <tr key={`${g.journey}-${g.step}`}>
                <td>
                  <span className={`method m-${g.method.toLowerCase()}`}>{g.method}</span> {g.step}
                </td>
                <td className="muted">{g.journey}</td>
                <td className="num">{g.times.length}</td>
                <td className="num">{Math.round(g.avg)} ms</td>
                <td className="num">{Math.round(g.max)} ms</td>
                <td className={`num ${g.failed ? 'err' : 'muted'}`}>{g.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">{t('dev.perf.noTiming')}</p>
      )}
    </div>
  )
}

// --- Panel ---

export function DevPanel({ tab, onTab, onClose, hidden, cwd }: { tab: DevTab; onTab: (t: DevTab) => void; onClose: () => void; hidden: boolean; cwd?: string }) {
  const { logs, network } = useDevLog()
  // La terminal, una vez abierta, sigue viva aunque se cambie de pestaña o se oculte el panel.
  const [termOpened, setTermOpened] = useState(false)
  const [termInfo, setTermInfo] = useState<TerminalInfo>()
  const termRef = useRef<SessionsHandle>(null)
  if (tab === 'terminal' && !termOpened) setTermOpened(true)
  const [height, setHeight] = useState(savedHeight)
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [filter, setFilter] = useState('')
  const errors = logs.filter((l) => l.level === 'error').length

  const resize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const y0 = e.clientY
    const h0 = height
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    let last = h0
    const move = (ev: PointerEvent) => {
      last = Math.min(Math.max(h0 + y0 - ev.clientY, 140), window.innerHeight * 0.75)
      setHeight(last)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(last)))
      } catch {
        /* sin almacenamiento: el alto no se recuerda */
      }
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const tabs: { id: DevTab; label: string; count?: number; alert?: boolean }[] = [
    { id: 'console', label: 'Console', count: errors || undefined, alert: errors > 0 },
    { id: 'network', label: 'Network', count: network.length || undefined },
    { id: 'performance', label: 'Performance' },
    ...(desktop ? [{ id: 'terminal' as const, label: 'Terminal' }] : []),
  ]

  return (
    <section className="dev-panel" style={{ height }} hidden={hidden} aria-label={t('status.devTools')}>
      <div className="dev-resize" role="separator" aria-orientation="horizontal" aria-label={t('ws.resize')} onPointerDown={resize} />
      <div className="dev-head">
        <div className="dev-tabs" role="tablist">
          {tabs.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => onTab(x.id)}>
              <Icon d={ICONS[x.id]} size={13} /> {x.label}
              {x.count !== undefined && <span className={`dev-count ${x.alert ? 'alert' : ''}`}>{x.count}</span>}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {tab === 'console' && (
          <select className="dev-select" value={level} onChange={(e) => setLevel(e.target.value as LogLevel | 'all')} aria-label={t('dev.console.level')}>
            <option value="all">{t('dev.level.all')}</option>
            <option value="info">{t('dev.level.info')}</option>
            <option value="warn">{t('dev.level.warn')}</option>
            <option value="error">{t('dev.level.error')}</option>
          </select>
        )}
        {tab === 'network' && <input className="dev-filter" value={filter} placeholder={t('dev.net.filter')} onChange={(e) => setFilter(e.target.value)} aria-label={t('dev.net.filter')} />}
        {tab === 'terminal' && termInfo && (
          <span className="muted small clamp-start dev-term-info" title={termInfo.cwd}>
            <bdi>{termInfo.cwd}</bdi>
          </span>
        )}
        {tab === 'terminal' && (
          <button className="icon-btn" onClick={() => termRef.current?.add()} title={t('dev.term.new')} aria-label={t('dev.term.new')}>
            <Icon d={ICONS.plus} size={14} />
          </button>
        )}
        {tab !== 'performance' && (
          <button
            className="icon-btn"
            onClick={tab === 'console' ? clearLogs : tab === 'network' ? clearNetwork : () => termRef.current?.clear()}
            title={t('dev.clear')}
            aria-label={t('dev.clear')}
          >
            <Icon d={ICONS.trash} size={14} />
          </button>
        )}
        {desktop && (
          <button className="icon-btn" onClick={() => void desktop?.appToggleDevTools()} title={t('dev.inspect')} aria-label={t('dev.inspect')}>
            <Icon d={ICONS.inspect} size={14} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          <Icon d={ICONS.close} size={14} />
        </button>
      </div>
      <div className="dev-content">
        {tab === 'console' && <ConsoleTab logs={logs} level={level} />}
        {tab === 'network' && <NetworkTab entries={network} filter={filter} />}
        {tab === 'performance' && <PerformanceTab entries={network} />}
        {termOpened && (
          <div className="dev-term-wrap" hidden={tab !== 'terminal'}>
            <TerminalSessions ref={termRef} cwd={cwd} visible={!hidden && tab === 'terminal'} onActiveInfo={setTermInfo} />
          </div>
        )}
      </div>
    </section>
  )
}
