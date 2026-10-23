import { LoadScreen } from '../ui/screens/LoadScreen'
import { ContractsScreen } from '../ui/screens/ContractsScreen'
import { ParamsScreen } from '../ui/screens/ParamsScreen'
import { CasesScreen } from '../ui/screens/CasesScreen'
import { ResultsScreen } from '../ui/screens/ResultsScreen'
import { Sidebar } from './Sidebar'
import { Screen, useStudio } from './useStudio'

export default function App() {
  const studio = useStudio()
  const { screen, goTo, project, analysis, testAnalysis } = studio

  return (
    <div className="shell">
      <Sidebar studio={studio} />

      <div className="content">
        <main className="main">
          {screen === Screen.Load && (
            <LoadScreen
              files={studio.files}
              project={project}
              errors={studio.errors}
              onFiles={studio.addFiles}
              onAttach={studio.attachFile}
              onFetchRemote={studio.fetchRemote}
              onExample={studio.loadExample}
              onReset={studio.reset}
              onNext={() => goTo(Screen.Contracts)}
            />
          )}
          {screen === Screen.Contracts && analysis && (
            <ContractsScreen
              analysis={analysis}
              selected={studio.selected}
              onSelect={studio.setSelected}
              skipped={studio.skipped}
              onToggleWorkflow={studio.toggleWorkflow}
              onAllWorkflows={studio.setAllWorkflows}
              onBack={() => goTo(Screen.Load)}
              onNext={() => goTo(Screen.Params)}
            />
          )}
          {screen === Screen.Params && testAnalysis && project && (
            <ParamsScreen
              project={project}
              analysis={testAnalysis}
              selected={studio.selected}
              onSelect={studio.setSelected}
              inputs={studio.inputs}
              setInput={studio.setInput}
              credentials={studio.credentials}
              setCredential={studio.setCredential}
              servers={studio.servers}
              setServer={studio.setServer}
              onBack={() => goTo(Screen.Contracts)}
              onNext={() => goTo(Screen.Cases)}
            />
          )}
          {screen === Screen.Cases && testAnalysis && (
            <CasesScreen
              analysis={testAnalysis}
              cases={studio.testCases}
              {...studio.caseActions}
              mode={studio.mode}
              setMode={studio.setMode}
              onExportScenarios={studio.exportScenariosFile}
              onImportScenarios={studio.importScenariosFile}
              inputs={studio.inputs}
              servers={studio.servers}
              confirmed={studio.confirmed}
              setConfirmed={studio.setConfirmed}
              running={studio.running}
              onRun={studio.runAll}
              onBack={() => goTo(Screen.Params)}
            />
          )}
          {screen === Screen.Results && (
            <ResultsScreen
              runs={studio.runs}
              running={studio.running}
              onCancel={studio.cancelRun}
              onRerun={studio.runAll}
              onExport={studio.exportReport}
              onBack={() => goTo(Screen.Cases)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
