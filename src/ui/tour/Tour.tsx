// Tour guiado: oscurece la pantalla, ilumina el elemento de cada paso y lo explica en una tarjeta.
// Cada paso prepara la pantalla antes de mostrarse (abrir un journey, una pestaña…). La app sigue
// usable debajo: el tour no bloquea los clics.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../../i18n'
import { Markdown } from '../components/Markdown'

export interface TourStep {
  id: string
  /** Elemento a iluminar (selector CSS); sin él, la tarjeta va al centro. */
  target?: string
  title: string
  body: string
  /** Prepara la pantalla antes de mostrar el paso. */
  before?: () => Promise<void>
  /** Botones propios (p. ej. en el último paso). */
  actions?: ReactNode
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const CARD_W = 360
const GAP = 14

/** Posición de la tarjeta junto al elemento: a la derecha, a la izquierda, abajo o arriba, dentro de la pantalla. */
function cardPosition(rect: Rect | undefined, cardH: number): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampTop = (y: number) => Math.min(Math.max(12, y), vh - cardH - 12)
  const clampLeft = (x: number) => Math.min(Math.max(12, x), vw - CARD_W - 12)
  if (!rect) return { top: clampTop((vh - cardH) / 2), left: clampLeft((vw - CARD_W) / 2) }
  if (rect.left + rect.width + GAP + CARD_W < vw) return { top: clampTop(rect.top), left: rect.left + rect.width + GAP }
  if (rect.left - GAP - CARD_W > 0) return { top: clampTop(rect.top), left: rect.left - GAP - CARD_W }
  if (rect.top + rect.height + GAP + cardH < vh) return { top: rect.top + rect.height + GAP, left: clampLeft(rect.left) }
  if (rect.top - GAP - cardH > 0) return { top: rect.top - GAP - cardH, left: clampLeft(rect.left) }
  // El elemento ocupa casi toda la pantalla: la tarjeta va en su esquina inferior derecha.
  return { top: clampTop(vh - cardH - 24), left: clampLeft(vw - CARD_W - 24) }
}

export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  // Cada visita a un paso tiene su número: su preparación corre una sola vez (también si React monta
  // el efecto dos veces en desarrollo) y se repite al volver al paso.
  const [visit, setVisit] = useState(0)
  const preparations = useRef(new Map<number, Promise<void>>())
  // Paso cuya preparación ya terminó: mientras no sea el actual, se muestra "Preparando…".
  const [readyStep, setReadyStep] = useState<string>()
  const [rect, setRect] = useState<Rect>()
  const card = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)
  const step = steps[index]
  const busy = readyStep !== step.id

  // Prepara el paso (una vez por paso).
  useEffect(() => {
    let cancelled = false
    let preparing = preparations.current.get(visit)
    if (!preparing) {
      // Si no se pudo preparar, igual se muestra la explicación.
      preparing = (step.before?.() ?? Promise.resolve()).catch(() => {})
      preparations.current.set(visit, preparing)
    }
    void preparing.then(() => {
      if (!cancelled) setReadyStep(step.id)
    })
    return () => {
      cancelled = true
    }
  }, [step, visit])

  // Sigue al elemento mientras la pantalla cambia (animaciones, paneles que se abren…).
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const el = step.target ? document.querySelector(step.target) : null
      const r = el?.getBoundingClientRect()
      setRect((prev) => {
        if (!r || r.width === 0) return undefined
        const next = { top: r.top, left: r.left, width: r.width, height: r.height }
        return prev && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5 ? prev : next
      })
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [step])

  // El alto de la tarjeta cambia con cada paso: se mide para ubicarla bien.
  useEffect(() => {
    const el = card.current
    if (!el) return
    const observer = new ResizeObserver(() => setCardH(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const go = (n: number) => {
    if (n < 0) return
    if (n >= steps.length) onClose()
    else {
      setIndex(n)
      setVisit((v) => v + 1)
    }
  }
  const goRef = useRef(go)
  useLayoutEffect(() => {
    goRef.current = go
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goRef.current(index + 1)
      if (e.key === 'ArrowLeft') goRef.current(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index])

  const shown = busy ? undefined : rect
  const pos = cardPosition(shown, cardH)
  const last = index === steps.length - 1

  return (
    <div className="tour-layer" aria-live="polite">
      {shown ? (
        <div className="tour-spot" style={{ top: shown.top - 6, left: shown.left - 6, width: shown.width + 12, height: shown.height + 12 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" ref={card} role="dialog" aria-label={step.title} style={{ top: pos.top, left: pos.left, width: CARD_W }}>
        <div className="tour-progress">
          <span>{t('tour.progress', { n: index + 1, total: steps.length })}</span>
          <span className="tour-bar">
            <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </span>
        </div>
        <h3>{step.title}</h3>
        {busy ? <p className="muted small">{t('tour.preparing')}</p> : <Markdown text={step.body} className="docs-md tour-body" />}
        {step.actions && !busy ? (
          <div className="tour-actions">{step.actions}</div>
        ) : (
          <div className="tour-actions">
            <button className="link small" onClick={onClose}>
              {t('tour.exit')}
            </button>
            <span className="spacer" />
            {index > 0 && <button onClick={() => go(index - 1)}>{t('tour.back')}</button>}
            <button className="primary" disabled={busy} onClick={() => go(index + 1)}>
              {last ? t('tour.finish') : t('tour.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
