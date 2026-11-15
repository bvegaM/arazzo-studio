import { useLayoutEffect, useRef, useState } from 'react'
import { Tour, type TourStep } from '../ui/tour/Tour'
import { buildTourSteps } from './tour'
import { t } from '../i18n'
import { desktop } from '../lib/desktop'
import { useUiMode } from '../lib/uiMode'
import { DevPanel, type DevTab } from '../ui/workspace/DevPanel'
import type { TerminalRequest } from '../ui/workspace/TerminalSessions'
import { AppBar } from './AppBar'
import { Workspace } from './Workspace'
import { useStudio } from './useStudio'
import { useWorkspace } from './useWorkspace'

export default function App() {
  const studio = useStudio()
  const workspace = useWorkspace(studio)
  // Panel de desarrollo: una vez abierto queda montado (oculto al cerrarlo) para no cortar la terminal.
  const [devTab, setDevTab] = useState<DevTab>('console')
  const [devOpen, setDevOpen] = useState(false)
  const [devMounted, setDevMounted] = useState(false)
  const [homeRequest, setHomeRequest] = useState(0)
  // Tour guiado: sus pasos leen lo más reciente de la app (corre a lo largo de muchos renders).
  const latest = useRef({ studio, workspace })
  useLayoutEffect(() => {
    latest.current = { studio, workspace }
  })
  const [tour, setTour] = useState<TourStep[]>()
  const startTour = () =>
    setTour([
      ...buildTourSteps({ latest }),
      {
        id: 'end',
        title: t('tour.end.title'),
        body: t('tour.end.body'),
        actions: (
          <>
            <button
              className="danger"
              onClick={async () => {
                setTour(undefined)
                await latest.current.workspace.deleteWorkspace()
              }}
            >
              {t('tour.end.delete')}
            </button>
            <span className="spacer" />
            <button className="primary" onClick={() => setTour(undefined)}>
              {t('tour.end.keep')}
            </button>
          </>
        ),
      },
    ])
  // Interfaz simple: sin Dev Tools ni terminal (el panel no se muestra aunque estuviera abierto).
  const simple = useUiMode() === 'simple'
  const [terminalRequest, setTerminalRequest] = useState<TerminalRequest>()
  /** "Abrir en terminal": muestra la terminal de Dev Tools en esa carpeta. */
  const openTerminal = (cwd?: string) => {
    setDevMounted(true)
    setDevOpen(true)
    setDevTab('terminal')
    setTerminalRequest((prev) => ({ n: (prev?.n ?? 0) + 1, cwd }))
  }
  const toggle = () => {
    setDevMounted(true)
    setDevOpen((o) => !o)
  }
  return (
    <div className="app-frame">
      <AppBar workspace={workspace} onHome={() => setHomeRequest((n) => n + 1)} />
      <Workspace studio={studio} workspace={workspace} dev={{ open: devOpen, toggle }} homeRequest={homeRequest} onOpenTerminal={desktop && !simple ? openTerminal : undefined} onTour={startTour} />
      {devMounted && (
        <DevPanel
          tab={devTab}
          onTab={setDevTab}
          onClose={() => setDevOpen(false)}
          hidden={!devOpen || simple}
          cwd={workspace.kind === 'desktop' ? workspace.location : undefined}
          terminalRequest={terminalRequest}
        />
      )}
      {tour && <Tour steps={tour} onClose={() => setTour(undefined)} />}
    </div>
  )
}
