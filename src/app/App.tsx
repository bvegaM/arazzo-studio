import { Workspace } from './Workspace'
import { useStudio } from './useStudio'

export default function App() {
  const studio = useStudio()
  return <Workspace studio={studio} />
}
