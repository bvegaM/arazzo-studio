import { useState } from 'react'
import { desktop } from '../lib/desktop'
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
      <Workspace studio={studio} workspace={workspace} dev={{ open: devOpen, toggle }} homeRequest={homeRequest} onOpenTerminal={desktop ? openTerminal : undefined} />
      {devMounted && (
        <DevPanel
          tab={devTab}
          onTab={setDevTab}
          onClose={() => setDevOpen(false)}
          hidden={!devOpen}
          cwd={workspace.kind === 'desktop' ? workspace.location : undefined}
          terminalRequest={terminalRequest}
        />
      )}
    </div>
  )
}
