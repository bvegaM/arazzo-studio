import { AppBar } from './AppBar'
import { Workspace } from './Workspace'
import { useStudio } from './useStudio'
import { useWorkspace } from './useWorkspace'

export default function App() {
  const studio = useStudio()
  const workspace = useWorkspace(studio)
  return (
    <div className="app-frame">
      <AppBar workspace={workspace} />
      <Workspace studio={studio} workspace={workspace} />
    </div>
  )
}
