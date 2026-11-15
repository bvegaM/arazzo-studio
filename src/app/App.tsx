import { useState } from 'react'
import { DevPanel, type DevTab } from '../ui/workspace/DevPanel'
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
  const toggle = () => {
    setDevMounted(true)
    setDevOpen((o) => !o)
  }
  return (
    <div className="app-frame">
      <AppBar workspace={workspace} />
      <Workspace studio={studio} workspace={workspace} dev={{ open: devOpen, toggle }} />
      {devMounted && (
        <DevPanel
          tab={devTab}
          onTab={setDevTab}
          onClose={() => setDevOpen(false)}
          hidden={!devOpen}
          cwd={workspace.kind === 'desktop' ? workspace.location : undefined}
        />
      )}
    </div>
  )
}
