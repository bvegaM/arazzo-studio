// Terminal integrada (solo escritorio): xterm.js dibuja y node-pty, en el proceso principal, corre
// la shell del sistema en la carpeta del workspace. xterm se carga al abrir la pestaña.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { t } from '../../i18n'
import { desktop } from '../../lib/desktop'

// Si hay una Nerd Font instalada se usa primero: los prompts como Powerlevel10k u Oh My Posh
// dibujan íconos que las fuentes normales no tienen.
const NERD_FONTS = ["'MesloLGS NF'", "'MesloLGS Nerd Font'", "'JetBrainsMono Nerd Font'", "'Hack Nerd Font'", "'FiraCode Nerd Font'", "'CaskaydiaCove Nerd Font'"].join(', ')

export interface TerminalHandle {
  clear: () => void
  restart: () => void
}

/** Colores de la terminal a partir de los del tema de la app. */
function themeFromCss() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    background: v('--surface'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--surface'),
    selectionBackground: v('--accent-soft'),
    green: v('--ok'),
    red: v('--err'),
    yellow: v('--warn'),
    blue: v('--info'),
    magenta: v('--sim'),
    cyan: v('--send'),
  }
}

export interface TerminalInfo {
  shell: string
  cwd: string
}

interface Props {
  cwd?: string
  visible: boolean
  onInfo?: (info: TerminalInfo) => void
  /** La shell terminó (p. ej. con `exit`). Sin esto, la vista ofrece abrir una nueva. */
  onExit?: (code: number) => void
}

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView({ cwd, visible, onInfo, onExit }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal>(null)
  const fit = useRef<FitAddon>(null)
  const session = useRef<string>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'exited' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [generation, setGeneration] = useState(0)

  useImperativeHandle(ref, () => ({
    clear: () => term.current?.clear(),
    restart: () => setGeneration((g) => g + 1),
  }))

  // Crea xterm y la sesión de la shell; al reiniciar (generation) se abre una nueva.
  useEffect(() => {
    const bridge = desktop
    if (!bridge || !box.current) return
    let disposed = false
    const cleanups: (() => void)[] = []
    setState('loading')
    setError(undefined)
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
      if (disposed || !box.current) return
      const css = getComputedStyle(document.documentElement)
      const xterm = new Terminal({
        fontFamily: `${NERD_FONTS}, ${css.getPropertyValue('--mono').trim() || 'Menlo, monospace'}`,
        fontSize: 12.5,
        cursorBlink: true,
        allowProposedApi: false,
        scrollback: 5000,
        theme: themeFromCss(),
      })
      const fitter = new FitAddon()
      xterm.loadAddon(fitter)
      box.current.innerHTML = ''
      xterm.open(box.current)
      fitter.fit()
      term.current = xterm
      fit.current = fitter
      cleanups.push(() => xterm.dispose())

      try {
        const created = await bridge.termCreate({ cols: xterm.cols, rows: xterm.rows, cwd })
        if (disposed) {
          void bridge.termKill(created.id)
          return
        }
        session.current = created.id
        onInfo?.({ shell: created.shell, cwd: created.cwd })
        cleanups.push(() => void bridge.termKill(created.id))
        cleanups.push(bridge.onTermData(({ id, data }) => id === created.id && xterm.write(data)))
        cleanups.push(
          bridge.onTermExit(({ id, exitCode }) => {
            if (id !== created.id) return
            xterm.write(`\r\n\x1b[2m${t('dev.term.exited', { code: exitCode })}\x1b[0m\r\n`)
            session.current = undefined
            setState('exited')
            onExit?.(exitCode)
          }),
        )
        const input = xterm.onData((data) => session.current && bridge.termWrite(session.current, data))
        const resize = xterm.onResize(({ cols, rows }) => session.current && bridge.termResize(session.current, cols, rows))
        cleanups.push(() => input.dispose(), () => resize.dispose())
        setState('ready')
        xterm.focus()
      } catch (e) {
        setError((e as Error).message)
        setState('error')
      }
    })()
    return () => {
      disposed = true
      session.current = undefined
      for (const c of cleanups.reverse()) c()
    }
    // cwd solo cuenta al abrir una sesión nueva; cambiarlo no reinicia la terminal abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  // Ajusta filas y columnas al tamaño del panel.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth && el.offsetHeight) fit.current?.fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Al volver a la pestaña: reajusta y devuelve el foco.
  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      fit.current?.fit()
      term.current?.focus()
    })
  }, [visible])

  // Sigue el tema de la app (Preferencias o el del sistema).
  useEffect(() => {
    const update = () => term.current && (term.current.options.theme = themeFromCss())
    const media = matchMedia('(prefers-color-scheme: dark)')
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    media.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  return (
    <div className="dev-terminal">
      <div className="dev-terminal-box" ref={box} />
      {state === 'error' && (
        <div className="dev-terminal-msg">
          <strong>{t('dev.term.failed')}</strong>
          <span className="muted small">{error}</span>
          <button className="small" onClick={() => setGeneration((g) => g + 1)}>
            {t('dev.term.retry')}
          </button>
        </div>
      )}
      {state === 'exited' && !onExit && (
        <div className="dev-terminal-bar">
          <button className="small primary" onClick={() => setGeneration((g) => g + 1)}>
            {t('dev.term.new')}
          </button>
        </div>
      )}
    </div>
  )
})
